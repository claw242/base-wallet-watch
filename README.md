# Base Wallet Watch

A local, read-only command-line demo for checking the ETH and native USDC balances of Base wallet addresses you explicitly list. It reports low balances and exports a JSON snapshot. Maintained by Loupe & Lettres. This project was created with the help of AI (créé avec l'aide de l'IA).

This is a local demo. It is not a hosted monitoring service. Each command checks once; it does not keep watching after it exits or send background notifications. No payment, wallet connection, account, private key or seed phrase is required.

## Run locally

Use Node.js 22 or later and npm. From this demo repository's root:

```sh
npm ci
```

Create `config.json`. Replace the address placeholder below with a valid public Base address you are comfortable sending to a public RPC provider. It must contain `0x` followed by 40 hexadecimal characters.

```json
{
  "adresses": [
    {
      "adresse": "REPLACE_WITH_YOUR_PUBLIC_BASE_ADDRESS",
      "nom": "agent-demo",
      "seuilUsdc": "5",
      "seuilEth": "0.0005"
    }
  ]
}
```

The placeholder is intentionally not a valid wallet address. Thresholds are decimal strings, with at most 6 decimal places for USDC and 18 for ETH. The demo accepts up to 50 distinct addresses. A balance strictly below its threshold produces an alert; a balance equal to the threshold does not.

```sh
npm run suivi -- config.json
npm run suivi -- config.json --sortie rapport.json
```

The JSON output contains a generation timestamp, `reseau: "base"`, balances, alerts for each address and `nbAlertes`. The export contains the addresses and names you supplied; keep it local unless you choose to share it.

| Exit code | Meaning |
| --- | --- |
| 0 | Check completed, no low-balance alert |
| 1 | Check completed, one or more low-balance alerts |
| 2 | Invalid configuration, RPC failure or another execution error |

## What it reads

The demo uses `eth_getBalance` for ETH and an ERC-20 `balanceOf` call for native USDC on Base. It makes no signing or transaction-submission calls. Default public RPC endpoints are included in the source; you may set a `rpc` array of HTTPS endpoints in your local configuration. Before reading balances, each node (default or custom) must answer `eth_chainId` with `0x2105` (Base mainnet); a node on another chain is skipped. A successfully validated node is checked once per run. This checks the node's response; it does not independently authenticate an RPC provider.

Public RPC providers can see your IP address and the addresses queried. Balances are read at `latest` and are not an atomic snapshot across all addresses. A timestamp records report generation, not blockchain finality. A network failure is an error, not a zero balance.

## Verify the demo

```sh
npm test
npm run typecheck
npm run couverture
```

Automated tests use controlled responses. They do not prove uninterrupted availability of public RPC services. Wallet compatibility, hosted alerts, transfer notifications, payment processing and automated delivery are outside this demo.

## Feedback

If you operate agents on Base, describe the event you miss, how you monitor balances today, and what fails in that setup. A non-sensitive example is enough. Do not share keys, seed phrases, email addresses or private wallet information. Interest in a free demo is separate from willingness to pay for a future hosted service.

## License

MIT. See `LICENSE` in the demo repository.
