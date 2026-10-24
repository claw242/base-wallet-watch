import { readFile, writeFile } from "node:fs/promises";
import { RPC_BASE_PAR_DEFAUT, rpcHttp, type ClientRpc } from "./rpc.js";
import { analyserConfig, creerRapport } from "./suivi.js";

export interface DepsCli {
  client?: ClientRpc;
  horloge?: () => Date;
}

export interface SortieCli {
  code: number;
  sortie: string;
}

const AIDE = `Usage : suivi <config.json> [--sortie rapport.json]
  Lit les soldes (ETH et USDC) des adresses Base déclarées, en lecture seule.
  Code 0 : aucun solde bas · 1 : au moins une alerte · 2 : erreur`;

export async function executerCli(args: readonly string[], deps: DepsCli = {}): Promise<SortieCli> {
  const [chemin, ...options] = args;
  if (chemin === undefined || chemin.startsWith("--")) return { code: 2, sortie: AIDE };
  if (options.length !== 0 && !(options.length === 2 && options[0] === "--sortie")) return { code: 2, sortie: AIDE };
  try {
    const config = analyserConfig(JSON.parse(await readFile(chemin, "utf8")));
    const client = deps.client ?? rpcHttp(config.rpc ?? RPC_BASE_PAR_DEFAUT);
    const rapport = await creerRapport(config, client, deps.horloge);
    const texte = JSON.stringify(rapport, null, 2);
    if (options[0] === "--sortie") await writeFile(options[1]!, `${texte}\n`);
    return { code: rapport.nbAlertes > 0 ? 1 : 0, sortie: texte };
  } catch (e) {
    return { code: 2, sortie: `ERREUR : ${e instanceof Error ? e.message : String(e)}` };
  }
}
