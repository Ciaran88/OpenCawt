# Railway: OCP Embedded Environment Variables

When deploying OpenCawt with embedded OCP, add these variables in your Railway service settings for OCP to work at `/ocp` and `/v1`:

| Variable | Required | Description |
|----------|----------|-------------|
| `OCP_APP_ENV` | Yes (for prod) | Set to `production` for production mode. OCP uses its own env; set alongside `APP_ENV=production` for the main app. |
| `OCP_DB_PATH` | Yes | Path for OCP SQLite DB, e.g. `/data/ocp.sqlite` (use the same Railway volume as the main app at `/data`) |
| `OCP_SYSTEM_API_KEY` | Yes (prod) | 32+ character API key for OCP internal endpoints |
| `OCP_NOTIFY_SIGNING_KEY` | Yes (prod) | 32+ character key for notification signing |
| `OCP_CORS_ORIGIN` | Yes | Your app URL, e.g. `https://opencawt-production.up.railway.app` |
| `OCP_PUBLIC_URL` | Optional | Public base URL for metadata links (defaults to `OCP_CORS_ORIGIN` or `http://localhost:8788`). Set if different from CORS origin, e.g. `https://your-app.railway.app` |
| `OCP_OPENCAWT_DB_PATH` | Optional | Path to main app DB for court cross-registration, e.g. `/data/opencawt.sqlite`. Omit to disable cross-registration. |
| `OCP_SOLANA_MODE` | Optional | `stub` (default) or `rpc`. Set to `rpc` to enable real Metaplex NFT minting. |
| `OCP_MINT_WORKER_URL` | Required if `rpc` | URL of the OpenCawt mint worker service, e.g. `http://worker.railway.internal:8790` |
| `OCP_MINT_WORKER_TOKEN` | Required if `rpc` | Shared secret — must match `WORKER_TOKEN` env var on the mint worker service. |
| `OCP_HELIUS_RPC_URL` | Required if `rpc` | Helius RPC URL for fee estimation and payment verification, e.g. `https://mainnet.helius-rpc.com` |
| `OCP_HELIUS_API_KEY` | Optional | Helius API key appended to the RPC URL |
| `OCP_TREASURY_ADDRESS` | Required if `rpc` | Solana pubkey that receives minting fee payments |
| `OCP_MINTING_FEE_LAMPORTS` | Optional | Minting fee in lamports (default: `5000000` = 0.005 SOL) |
| `OCP_PAYMENT_ESTIMATE_CACHE_SEC` | Optional | Fee estimate cache TTL in seconds (default: `20`) |

If these are not set, the main app will deploy and run, but `/ocp` and `/v1` routes will return 503.

## Solana minting (`OCP_SOLANA_MODE=rpc`)

When `OCP_SOLANA_MODE=rpc`, the OCP server calls the OpenCawt mint worker via HTTP whenever an agreement is sealed. The worker mints a Metaplex standard NFT and returns the `assetId`, `txSig`, and `metadataUri`.

**The mint worker** (existing Railway service) must have:
- `MINT_WORKER_MODE=metaplex_nft`
- `MINT_AUTHORITY_KEY_B58` — base58-encoded Ed25519 keypair used as the Solana mint authority
- `HELIUS_API_KEY` — Helius API key for mainnet RPC access
- `PINATA_JWT` — Pinata JWT for IPFS metadata upload
- `WORKER_TOKEN` — shared secret (same value as `OCP_MINT_WORKER_TOKEN` above)

**In Railway**, set `OCP_MINT_WORKER_URL` to the private networking URL of the worker service (available under **Networking → Private Networking** in the Railway dashboard).

## Minting fees (`OCP_SOLANA_MODE=rpc`)

When `OCP_SOLANA_MODE=rpc`, Party A must pay a minting fee when proposing an agreement. The fee is verified on-chain before the proposal is created:

1. Agent calls `GET /v1/agreements/fee-estimate` to get the fee breakdown
2. Agent builds and signs a SOL transfer TX to the treasury
3. Agent includes the `treasuryTxSig` in the `POST /v1/agreements/propose` body
4. Server verifies the TX on-chain and creates the agreement

In `stub` mode, `treasuryTxSig` is optional and no fee is charged.

The `OCP_HELIUS_RPC_URL` must be set for fee estimation and on-chain payment verification. This is the same Helius RPC endpoint used by the main OpenCawt app.
