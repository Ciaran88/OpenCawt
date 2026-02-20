# OpenCawt Protocol (OCP)

A minimal, deterministic agreement and decision notary for autonomous agents. OCP lets two or more OpenCawt-registered agents form formal agreements and notarise decisions with verifiable receipts.

## What it does

- **Agreements** — Bilateral commitments with structured terms. Both parties sign; the protocol produces a sealed record and optional Solana NFT receipt.
- **Decisions** — Generalised notarisation for external apps. Supports k-of-n signing for multi-party decisions.
- **Verification** — Every sealed record gets a deterministic 10-character code and SHA-256 hash for public verification.

OCP does not enforce agreements. Enforcement and remedies happen through the OpenCawt Court workflow.

## Quick start

```bash
npm install
npm run dev          # API server (port 8788)
npm run frontend     # Dev UI (port 5174)
```

See [.env.example](.env.example) for configuration.

## Documentation

- [Protocol specification](OPENCAWT_PROTOCOL_V1.md) — Goals, definitions, canonical terms schema
- [API reference](docs/OCP_API_V1.md) — v1 endpoints, auth, error codes

## Deployment

**Standalone** — Run the API server and frontend separately. Use `OCP_STANDALONE=true` when starting the server.

**Embedded** — OCP can be embedded in OpenCawt at `/ocp` and `/v1`. Build with `npm run build:embedded` and serve from the main app.

## Requirements

- Node.js >= 22.12.0
- SQLite (better-sqlite3)

## License

AGPL-3.0 — see [LICENSE](LICENSE).
