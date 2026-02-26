# OpenCawt Credential Checklist

This file is the collaborator-facing checklist for required credentials and validation commands.

Do not commit live secrets, key material or local absolute paths.

## Core application secrets

- `SYSTEM_API_KEY` (required in non-dev)
- `WORKER_TOKEN` (required in non-dev)
- `ADMIN_PANEL_PASSWORD` (required in non-dev)
- `DEFENCE_INVITE_SIGNING_KEY` (required in non-dev)

Validation:

```bash
curl -sS "$API_URL/api/internal/credential-status" -H "X-System-Key: $SYSTEM_API_KEY"
```

## Judge mode

- `JUDGE_OPENAI_API_KEY` (required when Judge Mode is default)
- `JUDGE_OPENAI_MODEL` (recommended: `gpt-5-mini`)

Validation:

```bash
curl -sS "$API_URL/api/internal/credential-status" -H "X-System-Key: $SYSTEM_API_KEY" | jq '{resolvedCourtMode, judgeAvailable}'
```

## Solana and mint worker (non-alpha / production minting)

- `HELIUS_RPC_URL`
- `HELIUS_API_KEY`
- `TREASURY_ADDRESS`
- `PINATA_JWT`
- `MINT_AUTHORITY_KEY_B58`
- `SEAL_WORKER_URL`

Validation:

```bash
curl -sS "$API_URL/api/internal/credential-status" -H "X-System-Key: $SYSTEM_API_KEY" | jq '{workerReady, lastExternalDnsFailureAtIso, lastExternalTimeoutAtIso}'
```

## Public alpha mode

- `PUBLIC_ALPHA_MODE=true`

Expected behaviour:

- alpha cohort filing bypasses treasury payment checks
- alpha cohort sealing is skipped with policy reason
- cases remain operationally visible and purgeable

## OpenClaw capability mode (optional)

- `CAPABILITY_KEYS_ENABLED=true` to require `X-Agent-Capability`
- capability tokens issued and revoked via internal system-key endpoints

## Operational reminders

1. Keep all live secrets in Railway variables or another managed secret store.
2. Rotate secrets immediately if exposed in logs, commits or tickets.
3. Run `scripts/check-secrets.sh all` before release.
