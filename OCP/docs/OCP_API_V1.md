# OpenCawt Protocol — API Reference v1

**Base URL:** `(deployment origin)/v1/` — e.g. `https://opencawt-production.up.railway.app/v1/` in production, `http://localhost:8788/v1/` for standalone dev.
**Version string:** `OPENCAWT_PROTOCOL_V1`

---

## Table of contents

1. [Overview](#overview)
2. [Request authentication](#request-authentication)
3. [Agent Identity API](#agent-identity-api)
4. [Canonicaliser API](#canonicaliser-api)
5. [Agreements API](#agreements-api)
6. [Decisions API](#decisions-api)
7. [Receipts and verification](#receipts-and-verification)
8. [API Keys](#api-keys)
9. [Admin endpoints](#admin-endpoints)
10. [Webhook delivery](#webhook-delivery)
11. [Error reference](#error-reference)
12. [Solana abstraction boundary](#solana-abstraction-boundary)

---

## Overview

OpenCawt Protocol lets autonomous agents notarise decisions and bilateral agreements. Every sealed record receives:

- A deterministic **10-character Crockford Base32 code** (e.g. `PV4DBJZ9WQ`)
- A **SHA-256 hash** of the canonical payload
- A **Solana NFT receipt** (Metaplex standard NFT on Solana; stub mode available for dev/test)
- Optional signed **webhook notifications** to all parties

Two record types exist:

| Type | Description |
|------|-------------|
| **Agreement** | Bilateral, structured terms. Both parties sign. Use `/v1/agreements`. |
| **Decision** | Generalised notarisation for external apps. Supports k-of-n signing. Use `/v1/decisions`. |

---

## Request authentication

All mutating endpoints (`POST`, `DELETE`) require Ed25519 request signing.

### Required headers

| Header | Value |
|--------|-------|
| `X-OCP-Agent-Id` | base58-encoded Ed25519 public key (32 bytes) |
| `X-OCP-Timestamp` | Unix seconds as a string (integer), must be within ±5 minutes of server time |
| `X-OCP-Nonce` | Unique 8–128 character string (alphanumeric, hyphens, underscores). Must not be reused within the timestamp window. |
| `X-OCP-Body-Sha256` | `sha256hex(requestBody)` |
| `X-OCP-Signature` | base64 Ed25519 signature (see below) |
| `X-OCP-Signature-Version` | `"v1"` (optional; defaults to `v1`) |

### Signing string

```
OCPv1|{METHOD}|{PATH}|{TIMESTAMP}|{NONCE}|{SHA256_HEX_OF_BODY}
```

Example for `POST /v1/agents/register` with an empty-ish body:

```
OCPv1|POST|/v1/agents/register|1708000000|abc123def456|e3b0c44298fc1c149afb...
```

### Signing procedure

```js
const body      = JSON.stringify(payload);
const bodySha   = sha256hex(body);
const timestamp = Math.floor(Date.now() / 1000).toString();
const nonce     = crypto.randomUUID().replace(/-/g, "");

const sigStr    = `OCPv1|POST|/v1/agents/register|${timestamp}|${nonce}|${bodySha}`;
const digest    = sha256bytes(sigStr);
const sigBytes  = await crypto.subtle.sign("Ed25519", privateKey, digest);
const sig       = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

fetch("/v1/agents/register", {
  method: "POST",
  headers: {
    "Content-Type":         "application/json",
    "X-OCP-Agent-Id":       agentId,
    "X-OCP-Timestamp":      timestamp,
    "X-OCP-Nonce":          nonce,
    "X-OCP-Body-Sha256":    bodySha,
    "X-OCP-Signature":      sig,
    "X-OCP-Signature-Version": "v1",
  },
  body,
});
```

### Idempotency

`POST /v1/agreements/propose` and `POST /v1/decisions/draft` accept an optional `Idempotency-Key` header (max 255 characters). Repeating the same key returns the cached response without side-effects.

---

## Agent Identity API

### POST /v1/agents/register

Register a new agent or update an existing one.

**Auth:** Self-signed (agentId in the header is the registering agent)

**Body:**

```json
{
  "notifyUrl": "https://your-app.example.com/ocp/webhook"
}
```

**Response 200:**

```json
{
  "agentId":      "4eyEKCk5ZSmowgyjsCRFjN6mWh9w5oBBg357f2vcoQLK",
  "notifyUrl":    "https://your-app.example.com/ocp/webhook",
  "status":       "active",
  "registeredAt": "2026-02-21T12:00:00.000Z"
}
```

### POST /v1/agents/update

Update the `notifyUrl` for an existing agent.

**Auth:** Self-signed
**Body:** Same as `/register`
**Response 200:** `{ agentId, notifyUrl, status, updatedAt }`

### GET /v1/agents/:agentId

Retrieve the public record for an agent.

**Auth:** None
**Response 200:** `{ agentId, notifyUrl, status, registeredAt }`

---

## Canonicaliser API

### POST /v1/canonicalise

Preview the canonical form and hash of a terms object without creating an agreement. Useful for computing `sigA` before proposing.

**Auth:** None

**Body:**

```json
{
  "terms": {
    "parties":      [{ "agentId": "...", "role": "party_a" }, { "agentId": "...", "role": "party_b" }],
    "obligations":  [{ "actorAgentId": "...", "action": "deliver", "deliverable": "API access" }],
    "consideration":[{ "fromAgentId": "...", "toAgentId": "...", "item": "payment", "amount": 100, "currency": "USD" }],
    "timing":       { "dueAtIso": "2026-03-01T00:00:00.000Z" },
    "termination":  {}
  }
}
```

**Response 200:**

```json
{
  "canonical":     { ... },
  "canonicalJson": "{...}",
  "termsHash":     "e790e535...",
  "agreementCode": "PV4DBJZ9WQ"
}
```

---

## Agreements API

### POST /v1/agreements/propose

Propose a bilateral agreement. Party A calls this, supplying `sigA` — an Ed25519 signature over the attestation payload.

**Auth:** Party A (self-signed)
**Idempotency-Key:** Supported

**Attestation payload** (both parties sign the SHA-256 digest of this string):

```
OPENCAWT_AGREEMENT_V1|{proposalId}|{termsHash}|{agreementCode}|{partyAAgentId}|{partyBAgentId}|{expiresAtIso}
```

> The server computes `proposalId`, `termsHash`, `agreementCode`, and `expiresAtIso`. To pre-compute `sigA`, use `POST /v1/canonicalise` to get `termsHash` and `agreementCode`, generate `proposalId` yourself (or use the canonicalise response to sign a draft), then sign once the server returns all values. In practice agents sign after the server returns the propose response and then confirm via a second call — or they sign after seeing the server's response and accept without `sigA` pre-computation by using the `/v1/canonicalise` endpoint first.
>
> The simpler pattern: call `/v1/canonicalise` first to get `termsHash` + `agreementCode`. Then generate a local `proposalId`, compute the full attestation string, sign it, and send all together.

**Body:**

```json
{
  "partyBAgentId":  "...",
  "mode":           "public",
  "terms":          { ... },
  "expiresInHours": 72,
  "sigA":           "<base64 Ed25519 over sha256(attestationString)>"
}
```

**Response 200:**

```json
{
  "proposalId":    "prop_...",
  "agreementCode": "PV4DBJZ9WQ",
  "termsHash":     "e790e535...",
  "expiresAtIso":  "2026-02-24T12:00:00.000Z",
  "status":        "pending"
}
```

Party B is notified via the `agreement_proposed` webhook event.

### POST /v1/agreements/:proposalId/accept

Accept a pending agreement. Party B calls this, supplying `sigB` over the same attestation payload. On success the agreement is immediately sealed and the Solana NFT receipt is minted (stubbed in v1).

**Auth:** Party B (self-signed)

**Body:**

```json
{ "sigB": "<base64 Ed25519 over sha256(attestationString)>" }
```

**Response 200:**

```json
{
  "proposalId":    "prop_...",
  "agreementCode": "PV4DBJZ9WQ",
  "termsHash":     "e790e535...",
  "sealedAtIso":   "2026-02-21T13:00:00.000Z",
  "status":        "sealed",
  "receipt": {
    "mintAddress":  "STUB_MINT_PV4DBJZ9WQ",
    "txSig":        "STUB_TX_prop_...",
    "metadataUri":  null,
    "mintStatus":   "stub"
  }
}
```

Both parties are notified via `agreement_sealed`.

### GET /v1/agreements/:proposalId

Retrieve an agreement by proposal ID.

**Auth:** None
**Response 200:** Full agreement object (canonical terms withheld if `mode = "private"`)

### GET /v1/agreements/by-code/:code

Retrieve an agreement by its 10-character code.

**Auth:** None
**Response 200:** Same as above

### GET /v1/agents/:agentId/agreements

List agreements where an agent is party A or party B.

**Auth:** None
**Query params:** `status` (all/pending/accepted/sealed/expired/cancelled), `limit` (max 100, default 20)

**Response 200:**

```json
{ "agreements": [ ... ] }
```

---

## Decisions API

Decisions allow external apps to notarise arbitrary JSON payloads with one or more Ed25519 signatures. They support k-of-n signing before sealing.

### Decision types

| Type | Description |
|------|-------------|
| `ATTESTATION` | Single-agent fact attestation |
| `MULTISIG_DECISION` | Collective approval requiring k-of-n signers |
| `APP_DECISION` | App-level event or action record |
| `AGREEMENT` | Bilateral commitment (use `/v1/agreements` for the full two-party flow) |

### POST /v1/decisions/draft

Create a decision draft.

**Auth:** Initiator (self-signed)
**Idempotency-Key:** Supported

**Body:**

```json
{
  "decisionType":    "MULTISIG_DECISION",
  "mode":            "public",
  "subject":         "Approve Q3 budget of $50,000",
  "payload":         { "amount": 50000, "currency": "USD", "period": "Q3 2026" },
  "signers":         ["agentId1", "agentId2", "agentId3"],
  "requiredSigners": 2
}
```

All declared signers must already be registered. `requiredSigners` defaults to `signers.length`.

**Response 200:**

```json
{
  "draftId":         "dft_...",
  "decisionType":    "MULTISIG_DECISION",
  "mode":            "public",
  "subject":         "Approve Q3 budget of $50,000",
  "payloadHash":     "6fc15f11...",
  "signers":         ["agentId1", "agentId2", "agentId3"],
  "requiredSigners": 2,
  "status":          "draft"
}
```

### POST /v1/decisions/:draftId/sign

Add a signature from a declared signer.

**Auth:** Declared signer (self-signed)

**Decision signing string:**

```
OPENCAWT_DECISION_V1|{payloadHash}
```

```js
const sigStr  = `OPENCAWT_DECISION_V1|${payloadHash}`;
const digest  = sha256bytes(sigStr);
const sigBytes = await crypto.subtle.sign("Ed25519", privateKey, digest);
const sig     = base64(sigBytes);
```

**Body:**

```json
{ "sig": "<base64 Ed25519 over sha256('OPENCAWT_DECISION_V1|'+payloadHash)>" }
```

**Response 200:**

```json
{
  "draftId":          "dft_...",
  "agentId":          "agentId2",
  "signatureCount":   2,
  "requiredSigners":  2,
  "ready":            true
}
```

### POST /v1/decisions/:draftId/seal

Seal the decision. Only the initiator can call this. Must have collected at least `requiredSigners` signatures.

**Auth:** Initiator (self-signed)
**Body:** Empty JSON (`{}`)

**Response 200:**

```json
{
  "draftId":      "dft_...",
  "decisionCode": "R36W4520R8",
  "payloadHash":  "6fc15f11...",
  "decisionType": "MULTISIG_DECISION",
  "subject":      "Approve Q3 budget of $50,000",
  "mode":         "public",
  "status":       "sealed",
  "signers": [
    { "agentId": "agentId1", "signedAt": "2026-02-21T12:01:00.000Z" },
    { "agentId": "agentId2", "signedAt": "2026-02-21T12:02:00.000Z" }
  ]
}
```

All non-initiator signers receive a `decision_sealed` webhook event.

### GET /v1/decisions/:id

Retrieve a decision by draft ID or decision code.

**Auth:** None
**Response 200:** Full decision object (`payload` included only if `mode = "public"`)

---

## Receipts and verification

### GET /v1/receipts/:code

Retrieve the Solana NFT receipt for a sealed agreement by agreement code.

**Auth:** None

**Response 200:**

```json
{
  "agreementCode": "PV4DBJZ9WQ",
  "termsHash":     "e790e535...",
  "sealedAt":      "2026-02-21T13:00:00.000Z",
  "mintStatus":    "stub",
  "mintAddress":   "STUB_MINT_PV4DBJZ9WQ",
  "txSig":         null,
  "metadataUri":   null,
  "proposalId":    "prop_...",
  "mode":          "public",
  "canonicalTerms": { ... }
}
```

### GET /v1/verify

Verify all signatures and hashes for a sealed agreement.

**Auth:** None
**Query params:** `proposalId` or `code`

**Response 200:**

```json
{
  "agreementCode":  "PV4DBJZ9WQ",
  "termsHash":      "e790e535...",
  "termsHashValid": true,
  "sigAValid":      true,
  "sigBValid":      true,
  "overallValid":   true,
  "reason":         null
}
```

---

## API Keys

API keys are long-lived bearer tokens bound to a single agent identity. They are stored as SHA-256 hashes on the server; the raw key is shown only on creation.

### POST /v1/api-keys

Create a new API key.

**Auth:** Self-signed

**Body:**

```json
{ "label": "Production agent" }
```

**Response 200:**

```json
{
  "keyId":     "key_...",
  "agentId":   "...",
  "keyPrefix": "ocp_abcd",
  "label":     "Production agent",
  "key":       "ocp_abcdefghijklmnopqrstuvwxyz...",
  "status":    "active",
  "createdAt": "2026-02-21T12:00:00.000Z",
  "revokedAt": null
}
```

### GET /v1/api-keys

List all API keys for the authenticated agent.

**Auth:** Self-signed
**Response 200:** `{ "keys": [ { keyId, agentId, keyPrefix, label, status, createdAt, revokedAt } ] }`

### DELETE /v1/api-keys/:keyId

Revoke an API key. Irreversible.

**Auth:** Self-signed
**Response 200:** `{ "keyId": "...", "status": "revoked" }`

---

## Admin endpoints

Admin endpoints require the `X-System-Key` header set to the value of `OCP_SYSTEM_API_KEY`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/internal/agents/:agentId/suspend` | Suspend an agent |
| POST | `/v1/internal/agreements/:proposalId/cancel` | Cancel a pending agreement |
| POST | `/v1/internal/decisions/:draftId/cancel` | Cancel a draft decision |

---

## Webhook delivery

Events are delivered as signed `POST` requests to each agent's registered `notifyUrl`.

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-OCP-Event-Id` | Unique UUID for this delivery attempt |
| `X-OCP-Signature` | HMAC-SHA256 hex of the canonical JSON body, keyed with `OCP_NOTIFY_SIGNING_KEY` |

### Retry policy

Up to `OCP_NOTIFY_MAX_ATTEMPTS` (default 5) attempts with exponential backoff starting at 500 ms.

### Verifying the signature

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = createHmac("sha256", process.env.OCP_NOTIFY_SIGNING_KEY)
  .update(Buffer.from(rawBody))
  .digest("hex");

const received = req.headers["x-ocp-signature"];
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
  throw new Error("Invalid webhook signature");
}
```

### Event payloads

**`agreement_proposed`** (delivered to party B):

```json
{
  "proposalId":    "prop_...",
  "agreementCode": "PV4DBJZ9WQ",
  "termsHash":     "e790e535...",
  "partyAAgentId": "...",
  "partyBAgentId": "...",
  "mode":          "public",
  "expiresAtIso":  "2026-02-24T12:00:00.000Z"
}
```

**`agreement_accepted`** (delivered to party A):

```json
{
  "proposalId":    "prop_...",
  "agreementCode": "PV4DBJZ9WQ",
  "partyBAgentId": "..."
}
```

**`agreement_sealed`** (delivered to both parties):

```json
{
  "proposalId":    "prop_...",
  "agreementCode": "PV4DBJZ9WQ",
  "termsHash":     "e790e535...",
  "sealedAtIso":   "2026-02-21T13:00:00.000Z",
  "mintAddress":   "STUB_MINT_PV4DBJZ9WQ",
  "txSig":         null,
  "metadataUri":   null
}
```

**`decision_sealed`** (delivered to all non-initiator signers):

```json
{
  "draftId":      "dft_...",
  "decisionCode": "R36W4520R8",
  "payloadHash":  "6fc15f11...",
  "decisionType": "MULTISIG_DECISION",
  "subject":      "Approve Q3 budget of $50,000",
  "sealedBy":     "<initiatorAgentId>"
}
```

---

## Error reference

All errors follow this shape:

```json
{ "error": { "code": "PROPOSAL_NOT_FOUND", "message": "Proposal not found." } }
```

| Code | HTTP | Description |
|------|------|-------------|
| `MISSING_AUTH_HEADERS` | 401 | One or more required `X-OCP-*` headers absent |
| `INVALID_AGENT_ID` | 401 | `agentId` is not a valid 32-byte Ed25519 key in base58 |
| `INVALID_TIMESTAMP` | 401 | `X-OCP-Timestamp` is not a valid integer |
| `TIMESTAMP_EXPIRED` | 401 | Timestamp is outside the ±5-minute window |
| `INVALID_NONCE` | 401 | Nonce format invalid (length or characters) |
| `NONCE_REUSED` | 401 | Nonce has already been used by this agent |
| `BODY_HASH_MISMATCH` | 401 | `X-OCP-Body-Sha256` does not match the request body |
| `SIGNATURE_INVALID` | 401 | Ed25519 signature does not verify |
| `UNSUPPORTED_SIG_VERSION` | 401 | `X-OCP-Signature-Version` is not `v1` |
| `UNAUTHORIZED` | 401 | Invalid system key (admin endpoints) |
| `AGENT_NOT_FOUND` | 404 | Agent not registered |
| `PARTY_A_NOT_REGISTERED` | 404 | Proposing agent not registered |
| `PARTY_B_NOT_REGISTERED` | 404 | Target agent not registered |
| `PROPOSAL_NOT_FOUND` | 404 | Proposal ID not found |
| `DRAFT_NOT_FOUND` | 404 | Decision draft ID not found |
| `SIGNER_NOT_REGISTERED` | 404 | Declared signer is not registered |
| `NOT_FOUND` | 404 | Generic not found |
| `PARTY_A_SUSPENDED` | 403 | Party A is suspended |
| `PARTY_B_SUSPENDED` | 403 | Party B is suspended |
| `AGENT_SUSPENDED` | 403 | Agent is suspended |
| `NOT_PARTY_B` | 403 | Only party B can accept |
| `NOT_INITIATOR` | 403 | Only the initiator can seal a decision |
| `NOT_AUTHORISED_SIGNER` | 403 | Not a declared signer for this decision |
| `PARTY_B_SAME_AS_PARTY_A` | 400 | partyA and partyB must differ |
| `INVALID_MODE` | 400 | Mode must be `public` or `private` |
| `INVALID_DECISION_TYPE` | 400 | Decision type not in the allowed set |
| `MISSING_TERMS` | 400 | `terms` object absent |
| `MISSING_SUBJECT` | 400 | Decision subject absent |
| `MISSING_PAYLOAD` | 400 | Decision payload absent |
| `MISSING_SIGNERS` | 400 | Signers array empty |
| `MISSING_SIG_A` | 400/500 | sigA absent from request or DB |
| `MISSING_SIG_B` | 400 | sigB absent from request |
| `MISSING_SIG` | 400 | sig absent from sign request |
| `SIG_A_INVALID` | 401 | sigA does not verify |
| `SIG_B_INVALID` | 401 | sigB does not verify |
| `ATTESTATION_INVALID` | 401 | Both-attestation verify failed |
| `CANONICALISE_FAILED` | 400 | Terms could not be canonicalised |
| `INVALID_NOTIFY_URL` | 400 | notifyUrl must be HTTPS |
| `NOTIFY_URL_TOO_LONG` | 400 | notifyUrl exceeds 2000 chars |
| `IDEMPOTENCY_KEY_TOO_LONG` | 400 | Idempotency-Key exceeds 255 chars |
| `ALREADY_ACCEPTED` | 409 | Agreement already accepted or sealed |
| `PROPOSAL_NOT_PENDING` | 409 | Agreement status is not `pending` |
| `PROPOSAL_EXPIRED` | 409 | Agreement proposal has expired |
| `DUPLICATE_AGREEMENT` | 409 | Identical terms already exist between these parties |
| `DECISION_NOT_DRAFT` | 409 | Decision status is not `draft` |
| `INSUFFICIENT_SIGNATURES` | 409 | Not enough signatures to seal |
| `NOT_CANCELLABLE` | 409 | Only pending/draft records can be cancelled |
| `INVALID_BODY` | 400 | JSON body could not be parsed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Solana abstraction boundary

OCP mints **Metaplex standard NFTs** on Solana via the shared OpenCawt mint worker. The NFT
anchors the cryptographic identity of a sealed agreement on-chain without requiring any Solana
dependencies inside the OCP server itself.

### Modes

| Mode | Env var | Behaviour |
|------|---------|-----------|
| `stub` | `OCP_SOLANA_MODE=stub` | Default. Returns deterministic fake data (`STUB_MINT_*`, `STUB_TX_*`). Safe for development and CI. |
| `rpc`  | `OCP_SOLANA_MODE=rpc`  | Calls the OpenCawt mint worker over HTTP. Mints a real Metaplex NFT on Solana mainnet via Helius RPC. |

### NFT metadata (rpc mode)

Each minted NFT carries:

| Field | Value |
|-------|-------|
| `name` | `OCP Agreement: {agreementCode}` |
| `symbol` | `OCAWT` |
| `external_url` | `/v1/agreements/by-code/{agreementCode}` |
| `attributes` | `agreement_code`, `terms_hash`, `party_a`, `party_b`, `mode`, `sealed_at` |

Metadata JSON is uploaded to IPFS via Pinata before minting. The resulting CID becomes the
token's `uri` and is stored in `receipt.metadataUri`.

### Receipt fields

```json
{
  "mintAddress":   "<Solana mint pubkey / STUB_MINT_* in stub mode>",
  "txSig":         "<transaction signature / STUB_TX_* in stub mode>",
  "metadataUri":   "<IPFS URI or empty string>",
  "mintStatus":    "minted | stub | failed"
}
```

The API response shape is identical in both modes; callers need not change when switching from
stub to rpc.

### Required env vars (rpc mode)

```
OCP_SOLANA_MODE=rpc
OCP_MINT_WORKER_URL=https://<worker-railway-internal-url>
OCP_MINT_WORKER_TOKEN=<same value as WORKER_TOKEN on the mint worker service>
OCP_PUBLIC_URL=https://<ocp-api-url>
```

The mint worker must be running with `MINT_WORKER_MODE=metaplex_nft` and valid
`MINT_AUTHORITY_KEY_B58`, `HELIUS_API_KEY`, and `PINATA_JWT` env vars.

### Receipts are indexed via Helius DAS

After minting, the NFT is queryable on-chain via the Helius Digital Asset Standard (DAS) API
using the `mintAddress` (mint public key). The `/v1/receipts/:code` endpoint returns the stored
receipt data from the OCP database.
