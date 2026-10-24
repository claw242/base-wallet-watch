import { describe, expect, it } from "vitest";
import { analyserConfig, creerRapport, evaluerAlertes, formaterUnites, lireSoldes, unitesDepuisDecimal, ErreurSuivi } from "../src/suivi.js";
import type { ClientRpc } from "../src/rpc.js";

const A1 = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000A2";

/** Faux nœud : ETH via eth_getBalance, USDC via eth_call (balanceOf). */
function fauxNoeud(soldes: Record<string, { eth: bigint; usdc: bigint }>): ClientRpc & { appels: string[] } {
  const appels: string[] = [];
  return {
    appels,
    async appeler(methode, params) {
      appels.push(methode);
      if (methode === "eth_getBalance") {
        const s = soldes[String(params[0]).toLowerCase()];
        if (!s) throw new Error("adresse inconnue");
        return `0x${s.eth.toString(16)}`;
      }
      if (methode === "eth_call") {
        const donnees = String((params[0] as { data: string }).data);
        const adresse = `0x${donnees.slice(-40)}`;
        const s = soldes[adresse.toLowerCase()];
        if (!s) throw new Error("adresse inconnue");
        return `0x${s.usdc.toString(16).padStart(64, "0")}`;
      }
      throw new Error(`méthode refusée : ${methode}`);
    },
  };
}

describe("unitesDepuisDecimal / formaterUnites", () => {
  it("convertit sans flottant", () => {
    expect(unitesDepuisDecimal("5", 6)).toBe(5_000_000n);
    expect(unitesDepuisDecimal("0.001", 18)).toBe(1_000_000_000_000_000n);
    expect(formaterUnites(5_500_000n, 6)).toBe("5.5");
    expect(formaterUnites(0n, 6)).toBe("0");
    expect(formaterUnites(1n, 18)).toBe("0.000000000000000001");
  });

  it.each(["", "-1", "1e3", "abc", "1.2.3", "0x1"])("refuse %j", (mauvais) => {
    expect(() => unitesDepuisDecimal(mauvais, 6)).toThrow(ErreurSuivi);
  });

  it("refuse trop de décimales", () => {
    expect(() => unitesDepuisDecimal("0.0000001", 6)).toThrow(ErreurSuivi);
  });
});

describe("analyserConfig", () => {
  it("normalise les adresses et applique les valeurs par défaut", () => {
    const c = analyserConfig({ adresses: [{ adresse: A2, nom: "agent-2" }, { adresse: A1 }] });
    expect(c.adresses[0]).toMatchObject({ adresse: A2.toLowerCase(), nom: "agent-2" });
    expect(c.adresses[1]?.nom).toBe(A1.toLowerCase());
    expect(c.adresses[0]?.seuilUsdc).toBe(5_000_000n);
  });

  it.each([
    [null],
    [{}],
    [{ adresses: [] }],
    [{ adresses: [{ adresse: "0x123" }] }],
    [{ adresses: [{ adresse: A1 }, { adresse: A1.toUpperCase().replace("0X", "0x") }] }],
    [{ adresses: [{ adresse: A1, seuilUsdc: "-3" }] }],
    [{ adresses: [{ adresse: A1, nom: 5 }] }],
    [{ adresses: [{ adresse: A1, nom: "x".repeat(65) }] }],
    [{ adresses: Array.from({ length: 51 }, (_, i) => ({ adresse: `0x${i.toString(16).padStart(40, "0")}` })) }],
  ])("rejette une config invalide %#", (brut) => {
    expect(() => analyserConfig(brut)).toThrow(ErreurSuivi);
  });
});

describe("lireSoldes", () => {
  it("lit ETH et USDC de chaque adresse en lecture seule", async () => {
    const noeud = fauxNoeud({ [A1.toLowerCase()]: { eth: 10n ** 16n, usdc: 12_500_000n }, [A2.toLowerCase()]: { eth: 0n, usdc: 0n } });
    const config = analyserConfig({ adresses: [{ adresse: A1 }, { adresse: A2 }] });
    const soldes = await lireSoldes(config, noeud);
    expect(soldes).toEqual([
      { adresse: A1.toLowerCase(), usdcUnites: 12_500_000n, ethWei: 10n ** 16n },
      { adresse: A2.toLowerCase(), usdcUnites: 0n, ethWei: 0n },
    ]);
    expect(new Set(noeud.appels)).toEqual(new Set(["eth_getBalance", "eth_call"]));
  });

  it("signale clairement une réponse invalide du nœud", async () => {
    const mauvais: ClientRpc = { appeler: async () => "pas-un-hex" };
    await expect(lireSoldes(analyserConfig({ adresses: [{ adresse: A1 }] }), mauvais)).rejects.toThrow(ErreurSuivi);
  });
});

describe("evaluerAlertes", () => {
  it("alerte quand un solde passe sous son seuil, pas quand il l'égale", () => {
    const config = analyserConfig({ adresses: [{ adresse: A1, seuilUsdc: "5", seuilEth: "0.001" }] });
    const sous = evaluerAlertes(config.adresses[0]!, { adresse: A1.toLowerCase(), usdcUnites: 4_999_999n, ethWei: 10n ** 15n - 1n });
    expect(sous.map((a) => a.type)).toEqual(["usdc_bas", "eth_bas"]);
    const egal = evaluerAlertes(config.adresses[0]!, { adresse: A1.toLowerCase(), usdcUnites: 5_000_000n, ethWei: 10n ** 15n });
    expect(egal).toEqual([]);
  });
});

describe("creerRapport", () => {
  it("produit un export JSON sérialisable avec les alertes", async () => {
    const noeud = fauxNoeud({ [A1.toLowerCase()]: { eth: 0n, usdc: 1_000_000n }, [A2.toLowerCase()]: { eth: 10n ** 18n, usdc: 9_000_000n } });
    const config = analyserConfig({ adresses: [{ adresse: A1, nom: "bas" }, { adresse: A2, nom: "ok" }] });
    const rapport = await creerRapport(config, noeud, () => new Date("2026-10-21T03:00:00Z"));
    expect(rapport.genereLe).toBe("2026-10-21T03:00:00.000Z");
    expect(rapport.reseau).toBe("base");
    expect(rapport.nbAlertes).toBe(2);
    expect(rapport.adresses[0]).toMatchObject({ nom: "bas", usdc: "1", eth: "0" });
    expect(rapport.adresses[1]?.alertes).toEqual([]);
    expect(() => JSON.stringify(rapport)).not.toThrow();
  });
});
