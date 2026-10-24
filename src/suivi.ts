import type { ClientRpc } from "./rpc.js";

export class ErreurSuivi extends Error {}

/** Contrat USDC natif sur Base (adresse publique). */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DECIMALES_USDC = 6;
const DECIMALES_ETH = 18;
const MAX_ADRESSES = 50;
const MAX_NOM = 64;
const SELECTEUR_BALANCE_OF = "0x70a08231";
const SEUIL_USDC_DEFAUT = "5";
const SEUIL_ETH_DEFAUT = "0.0005";
const ADRESSE = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x[0-9a-fA-F]+$/;

export interface AdresseSuivie {
  adresse: string;
  nom: string;
  seuilUsdc: bigint;
  seuilEth: bigint;
}

export interface ConfigSuivi {
  adresses: AdresseSuivie[];
  rpc?: string[];
}

export interface Solde {
  adresse: string;
  usdcUnites: bigint;
  ethWei: bigint;
}

export interface Alerte {
  type: "usdc_bas" | "eth_bas";
  seuil: string;
  valeur: string;
}

export interface LigneRapport {
  adresse: string;
  nom: string;
  usdc: string;
  eth: string;
  alertes: Alerte[];
}

export interface Rapport {
  genereLe: string;
  reseau: "base";
  adresses: LigneRapport[];
  nbAlertes: number;
}

export function unitesDepuisDecimal(texte: string, decimales: number): bigint {
  const motif = new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${decimales}})?$`);
  if (typeof texte !== "string" || !motif.test(texte)) {
    throw new ErreurSuivi(`montant invalide « ${String(texte)} » : décimal positif, ${decimales} décimales au plus`);
  }
  const [entier = "0", fraction = ""] = texte.split(".");
  return BigInt(entier) * 10n ** BigInt(decimales) + BigInt(fraction.padEnd(decimales, "0"));
}

export function formaterUnites(unites: bigint, decimales: number): string {
  const base = 10n ** BigInt(decimales);
  const fraction = (unites % base).toString().padStart(decimales, "0").replace(/0+$/, "");
  return fraction === "" ? (unites / base).toString() : `${unites / base}.${fraction}`;
}

function objet(valeur: unknown, quoi: string): Record<string, unknown> {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) throw new ErreurSuivi(`${quoi} : objet attendu`);
  return valeur as Record<string, unknown>;
}

function lireAdresse(brut: unknown, vues: Set<string>): AdresseSuivie {
  const entree = objet(brut, "adresse suivie");
  const adresse = entree["adresse"];
  if (typeof adresse !== "string" || !ADRESSE.test(adresse)) throw new ErreurSuivi(`adresse invalide : ${String(adresse)}`);
  const normalisee = adresse.toLowerCase();
  if (vues.has(normalisee)) throw new ErreurSuivi(`adresse en double : ${normalisee}`);
  vues.add(normalisee);
  const nom = entree["nom"] ?? normalisee;
  if (typeof nom !== "string" || nom.length === 0 || nom.length > MAX_NOM) throw new ErreurSuivi(`nom invalide pour ${normalisee}`);
  return {
    adresse: normalisee,
    nom,
    seuilUsdc: unitesDepuisDecimal(String(entree["seuilUsdc"] ?? SEUIL_USDC_DEFAUT), DECIMALES_USDC),
    seuilEth: unitesDepuisDecimal(String(entree["seuilEth"] ?? SEUIL_ETH_DEFAUT), DECIMALES_ETH),
  };
}

/** Valide la configuration lue (JSON non fiable) et la ramène à des types sûrs. */
export function analyserConfig(brut: unknown): ConfigSuivi {
  const config = objet(brut, "configuration");
  const liste = config["adresses"];
  if (!Array.isArray(liste) || liste.length === 0) throw new ErreurSuivi("« adresses » doit être une liste non vide");
  if (liste.length > MAX_ADRESSES) throw new ErreurSuivi(`${MAX_ADRESSES} adresses au maximum`);
  const vues = new Set<string>();
  const adresses = liste.map((a) => lireAdresse(a, vues));
  const rpc = config["rpc"];
  if (rpc === undefined) return { adresses };
  if (!Array.isArray(rpc) || rpc.some((u) => typeof u !== "string")) throw new ErreurSuivi("« rpc » doit être une liste d'URL");
  return { adresses, rpc: rpc as string[] };
}

function enBigint(reponse: unknown, quoi: string): bigint {
  if (typeof reponse !== "string" || !HEX.test(reponse)) throw new ErreurSuivi(`réponse invalide du nœud pour ${quoi}`);
  return BigInt(reponse);
}

export async function lireSoldes(config: ConfigSuivi, client: ClientRpc): Promise<Solde[]> {
  return Promise.all(
    config.adresses.map(async ({ adresse }) => {
      const donnees = `${SELECTEUR_BALANCE_OF}${adresse.slice(2).padStart(64, "0")}`;
      const [eth, usdc] = await Promise.all([
        client.appeler("eth_getBalance", [adresse, "latest"]),
        client.appeler("eth_call", [{ to: USDC_BASE, data: donnees }, "latest"]),
      ]);
      return { adresse, usdcUnites: enBigint(usdc, `USDC de ${adresse}`), ethWei: enBigint(eth, `ETH de ${adresse}`) };
    }),
  );
}

export function evaluerAlertes(suivie: AdresseSuivie, solde: Solde): Alerte[] {
  const alertes: Alerte[] = [];
  if (solde.usdcUnites < suivie.seuilUsdc) {
    alertes.push({ type: "usdc_bas", seuil: formaterUnites(suivie.seuilUsdc, DECIMALES_USDC), valeur: formaterUnites(solde.usdcUnites, DECIMALES_USDC) });
  }
  if (solde.ethWei < suivie.seuilEth) {
    alertes.push({ type: "eth_bas", seuil: formaterUnites(suivie.seuilEth, DECIMALES_ETH), valeur: formaterUnites(solde.ethWei, DECIMALES_ETH) });
  }
  return alertes;
}

export async function creerRapport(config: ConfigSuivi, client: ClientRpc, maintenant: () => Date = () => new Date()): Promise<Rapport> {
  const soldes = await lireSoldes(config, client);
  const adresses = config.adresses.map((suivie, i): LigneRapport => {
    const solde = soldes[i]!;
    return {
      adresse: suivie.adresse,
      nom: suivie.nom,
      usdc: formaterUnites(solde.usdcUnites, DECIMALES_USDC),
      eth: formaterUnites(solde.ethWei, DECIMALES_ETH),
      alertes: evaluerAlertes(suivie, solde),
    };
  });
  return { genereLe: maintenant().toISOString(), reseau: "base", adresses, nbAlertes: adresses.reduce((n, a) => n + a.alertes.length, 0) };
}
