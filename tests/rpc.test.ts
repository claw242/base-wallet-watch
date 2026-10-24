import { describe, expect, it } from "vitest";
import { ID_CHAINE_BASE, rpcHttp, type Fetch } from "../src/rpc.js";

function reponse(corps: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => corps } as unknown as Response;
}

/** Faux nœud : répond à eth_chainId avec `chaine`, et à tout le reste avec `resultat`. */
function noeud(chaine: string, resultat: unknown, appels: string[] = []): Fetch {
  return async (url, init) => {
    const { method } = JSON.parse(String(init?.body)) as { method: string };
    appels.push(`${String(url)} ${method}`);
    return reponse({ result: method === "eth_chainId" ? chaine : resultat });
  };
}

describe("rpcHttp", () => {
  it("renvoie le résultat JSON-RPC d'un nœud sur Base", async () => {
    const client = rpcHttp(["https://a"], noeud(ID_CHAINE_BASE, "0x10"));
    await expect(client.appeler("eth_blockNumber", [])).resolves.toBe("0x10");
  });

  it("bascule sur le nœud suivant après une erreur", async () => {
    const vus: string[] = [];
    const client = rpcHttp(["https://a", "https://b"], async (url, init) => {
      vus.push(String(url));
      if (String(url) === "https://a") return reponse({}, false);
      return noeud(ID_CHAINE_BASE, "0x2")(url, init);
    });
    await expect(client.appeler("eth_blockNumber", [])).resolves.toBe("0x2");
    expect(vus[0]).toBe("https://a");
    expect(vus.every((v) => v === "https://a" || v === "https://b")).toBe(true);
  });

  it("échoue si tous les nœuds échouent ou renvoient une erreur JSON-RPC", async () => {
    const client = rpcHttp(["https://a", "https://b"], async () => reponse({ error: { message: "boom" } }));
    await expect(client.appeler("eth_blockNumber", [])).rejects.toThrow(/nœud/);
  });

  it("refuse une méthode d'écriture", async () => {
    const client = rpcHttp(["https://a"], noeud(ID_CHAINE_BASE, "0x"));
    await expect(client.appeler("eth_sendRawTransaction", ["0x00"])).rejects.toThrow(/lecture seule/);
  });

  it("exige au moins une URL https", () => {
    expect(() => rpcHttp([], fetch)).toThrow();
    expect(() => rpcHttp(["http://a"], fetch)).toThrow();
  });

  it("écarte un nœud qui n'est pas sur Base et lit le suivant", async () => {
    const appels: string[] = [];
    const client = rpcHttp(["https://eth", "https://base"], async (url, init) =>
      noeud(String(url) === "https://eth" ? "0x1" : ID_CHAINE_BASE, "0x99", appels)(url, init),
    );
    await expect(client.appeler("eth_getBalance", ["0xabc", "latest"])).resolves.toBe("0x99");
    expect(appels).not.toContain("https://eth eth_getBalance");
  });

  it("refuse tout si aucun nœud n'est sur Base, en nommant la chaîne reçue", async () => {
    const client = rpcHttp(["https://eth"], noeud("0x1", "0x99"));
    await expect(client.appeler("eth_getBalance", ["0xabc", "latest"])).rejects.toThrow(/pas Base.*0x1/);
  });

  it("ne vérifie la chaîne d'un nœud qu'une fois", async () => {
    const appels: string[] = [];
    const client = rpcHttp(["https://a"], noeud(ID_CHAINE_BASE, "0x1", appels));
    await client.appeler("eth_blockNumber", []);
    await client.appeler("eth_blockNumber", []);
    expect(appels.filter((a) => a.endsWith("eth_chainId"))).toHaveLength(1);
  });

  it("mutualise le contrôle de chaîne entre appels concurrents", async () => {
    const appels: string[] = [];
    const client = rpcHttp(["https://a"], noeud(ID_CHAINE_BASE, "0x1", appels));
    await Promise.all(Array.from({ length: 50 }, () => client.appeler("eth_blockNumber", [])));
    expect(appels.filter((a) => a.endsWith("eth_chainId"))).toHaveLength(1);
  });

  it("partage l'échec d'un contrôle concurrent puis réessaie ensuite", async () => {
    let controles = 0;
    const client = rpcHttp(["https://a"], async (url, init) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      if (method === "eth_chainId") {
        controles += 1;
        if (controles === 1) return reponse({}, false);
      }
      return noeud(ID_CHAINE_BASE, "0x7")(url, init);
    });
    const lot = await Promise.allSettled(Array.from({ length: 5 }, () => client.appeler("eth_blockNumber", [])));
    expect(lot.every((r) => r.status === "rejected")).toBe(true);
    expect(controles).toBe(1);
    await expect(client.appeler("eth_blockNumber", [])).resolves.toBe("0x7");
    expect(controles).toBe(2);
  });

  it("revérifie un nœud dont le contrôle de chaîne a échoué", async () => {
    let n = 0;
    const client = rpcHttp(["https://a"], async (url, init) => {
      n += 1;
      if (n === 1) return reponse({}, false);
      return noeud(ID_CHAINE_BASE, "0x5")(url, init);
    });
    await expect(client.appeler("eth_blockNumber", [])).rejects.toThrow(/nœud/);
    await expect(client.appeler("eth_blockNumber", [])).resolves.toBe("0x5");
  });
});
