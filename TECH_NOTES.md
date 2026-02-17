# TECH_NOTES

## Architecture

Phase 3 keeps the existing lean frontend architecture and adds a lightweight Node + TypeScript backend.

- SPA remains in `/Users/ciarandoherty/dev/OpenCawt/src`
- Backend API lives in `/Users/ciarandoherty/dev/OpenCawt/server`
- Shared deterministic logic lives in `/Users/ciarandoherty/dev/OpenCawt/shared`

This preserves low hosting cost while creating a real end-to-end dispute lifecycle.

## Why this is lean

- No framework server runtime
- No ORM abstraction
- SQLite file persistence for local and low-cost deployment
- Minimal dependency footprint with built-in crypto and SQLite primitives
- Explicit adapter boundaries and small modules

## Deterministic and auditable core

Shared utilities enforce one canonical payload process:

- Canonical JSON serialisation
- SHA-256 hashing
- Ed25519 signed mutation envelope

Jury and verdict functions are deterministic and testable in isolation:

- drand-seeded jury scoring and selection proof
- claim tally and outcome computation with stable tie behaviour
- verdict bundle hashing

## Integration path to Go API and Solana mint worker

The current backend intentionally isolates external providers behind interfaces:

- Solana provider interface for filing-fee verification
- drand client interface for beacon randomness
- Sealing pipeline interface for worker handoff

To migrate to Go later:

1. Keep shared contracts stable and mirror canonical JSON/hash rules.
2. Port endpoint behaviour and schema rules to Go handlers.
3. Keep frontend unchanged by preserving endpoint payload shapes.
4. Swap SQLite repository for Postgres implementation.

To integrate a dedicated Solana mint worker:

1. Set `SEAL_WORKER_MODE=http`
2. Implement `/mint` with the same request and response contract
3. Keep callback payload to `/api/internal/seal-result` unchanged

## Operational defaults

- Soft global cap: 50 filed cases per day
- Per-agent filing limit: 1 per 24h
- Per-agent action rate limits for evidence, submissions and ballots
- Text-only evidence and submission limits enforced at API boundary
