import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executerCli } from "../src/cli.js";
import type { ClientRpc } from "../src/rpc.js";

const A1 = "0x00000000000000000000000000000000000000a1";

function noeud(usdc: bigint): ClientRpc {
  return {
    async appeler(methode) {
      return methode === "eth_getBalance" ? `0x${(10n ** 18n).toString(16)}` : `0x${usdc.toString(16).padStart(64, "0")}`;
    },
  };
}

async function dossierAvecConfig(contenu: string): Promise<{ dir: string; config: string }> {
  const dir = await mkdtemp(join(tmpdir(), "suivi-"));
  const config = join(dir, "config.json");
  await writeFile(config, contenu);
  return { dir, config };
}

const horloge = () => new Date("2026-10-21T03:00:00Z");

describe("executerCli", () => {
  it("affiche l'aide sans argument (code 2)", async () => {
    const r = await executerCli([], { client: noeud(0n), horloge });
    expect(r.code).toBe(2);
    expect(r.sortie).toMatch(/Usage/);
  });

  it("code 0 et JSON sur la sortie quand aucun solde n'est bas", async () => {
    const { config } = await dossierAvecConfig(JSON.stringify({ adresses: [{ adresse: A1 }] }));
    const r = await executerCli([config], { client: noeud(9_000_000n), horloge });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.sortie).nbAlertes).toBe(0);
  });

  it("code 1 quand une alerte existe", async () => {
    const { config } = await dossierAvecConfig(JSON.stringify({ adresses: [{ adresse: A1 }] }));
    const r = await executerCli([config], { client: noeud(1n), horloge });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.sortie).adresses[0].alertes[0].type).toBe("usdc_bas");
  });

  it("exporte vers un fichier avec --sortie", async () => {
    const { dir, config } = await dossierAvecConfig(JSON.stringify({ adresses: [{ adresse: A1 }] }));
    const cible = join(dir, "rapport.json");
    const r = await executerCli([config, "--sortie", cible], { client: noeud(9_000_000n), horloge });
    expect(r.code).toBe(0);
    expect(JSON.parse(await readFile(cible, "utf8")).reseau).toBe("base");
  });

  it("code 2 pour une config illisible, du JSON invalide ou une option inconnue", async () => {
    expect((await executerCli(["/inexistant.json"], { client: noeud(0n), horloge })).code).toBe(2);
    const { config } = await dossierAvecConfig("pas du json");
    expect((await executerCli([config], { client: noeud(0n), horloge })).code).toBe(2);
    expect((await executerCli([config, "--zzz", "x"], { client: noeud(0n), horloge })).code).toBe(2);
  });

  it("code 2 si le nœud échoue", async () => {
    const { config } = await dossierAvecConfig(JSON.stringify({ adresses: [{ adresse: A1 }] }));
    const casse: ClientRpc = { appeler: async () => { throw new Error("panne"); } };
    const r = await executerCli([config], { client: casse, horloge });
    expect(r.code).toBe(2);
    expect(r.sortie).toMatch(/panne/);
  });
});
