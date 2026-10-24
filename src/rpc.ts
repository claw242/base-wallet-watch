/** Client JSON-RPC minimal. Seules des méthodes de lecture sont autorisées. */
export interface ClientRpc {
  appeler(methode: string, params: readonly unknown[]): Promise<unknown>;
}

export type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const METHODES_LECTURE: ReadonlySet<string> = new Set(["eth_getBalance", "eth_call", "eth_chainId", "eth_blockNumber"]);
const DELAI_MS = 10_000;

/** Identifiant de chaîne de Base (8453). Tout nœud qui répond autre chose est écarté. */
export const ID_CHAINE_BASE = "0x2105";

/** Nœuds publics de Base, sans clé. Essayés dans l'ordre. */
export const RPC_BASE_PAR_DEFAUT: readonly string[] = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
];

async function essayer(url: string, methode: string, params: readonly unknown[], fetchImpl: Fetch): Promise<unknown> {
  const corps = JSON.stringify({ jsonrpc: "2.0", id: 1, method: methode, params });
  const reponse = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: corps,
    signal: AbortSignal.timeout(DELAI_MS),
  });
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
  const json = (await reponse.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "erreur JSON-RPC");
  if (json.result === undefined) throw new Error("réponse sans résultat");
  return json.result;
}

export function rpcHttp(urls: readonly string[], fetchImpl: Fetch = fetch): ClientRpc {
  if (urls.length === 0 || urls.some((u) => !u.startsWith("https://"))) {
    throw new Error("au moins un nœud RPC, en https uniquement");
  }
  // Une seule validation par nœud, partagée entre appels concurrents ; un échec n'est pas mémorisé.
  const controles = new Map<string, Promise<void>>();
  function verifierChaine(url: string): Promise<void> {
    const existant = controles.get(url);
    if (existant) return existant;
    const controle = (async () => {
      const id = await essayer(url, "eth_chainId", [], fetchImpl);
      if (typeof id !== "string" || id.toLowerCase() !== ID_CHAINE_BASE) {
        throw new Error(`ce nœud n'est pas Base (chaîne ${String(id)})`);
      }
    })();
    controles.set(url, controle);
    controle.catch(() => controles.delete(url));
    return controle;
  }
  return {
    async appeler(methode, params) {
      if (!METHODES_LECTURE.has(methode)) throw new Error(`lecture seule : méthode refusée (${methode})`);
      const erreurs: string[] = [];
      for (const url of urls) {
        try {
          await verifierChaine(url);
          return await essayer(url, methode, params, fetchImpl);
        } catch (e) {
          erreurs.push(`${new URL(url).host} : ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw new Error(`aucun nœud n'a répondu (${erreurs.join(" ; ")})`);
    },
  };
}
