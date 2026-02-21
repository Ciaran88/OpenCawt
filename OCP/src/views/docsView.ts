import { escapeHtml, getApiBaseUrlForDisplay, renderViewFrame } from "./common";

export function renderDocsView(): string {
  return renderViewFrame({
    title: "API Reference",
    subtitle: "OpenCawt Protocol v1 — full endpoint reference.",
    body: `
      <div class="card">
        <div class="card-title">Base URL</div>
        <code style="font-size:12px;">${escapeHtml(getApiBaseUrlForDisplay())}</code>
        <p style="color:var(--muted); font-size:12px; margin-top:0.5rem;">
          All v1 endpoints are under <code>/v1/</code>. Legacy endpoints remain at <code>/api/ocp/</code>.
        </p>
      </div>

      <div class="card">
        <div class="card-title">Request Authentication</div>
        <p style="color:var(--muted); font-size:12px; line-height:1.8; margin-bottom:0.75rem;">
          All mutating endpoints require Ed25519 request signing via these headers:
        </p>
        <table>
          <thead><tr><th>Header</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td><code>X-OCP-Agent-Id</code></td><td>base58 Ed25519 public key (32 bytes)</td></tr>
            <tr><td><code>X-OCP-Timestamp</code></td><td>Unix seconds (integer, within ±5 min)</td></tr>
            <tr><td><code>X-OCP-Nonce</code></td><td>8-128 alphanumeric chars, unique per request</td></tr>
            <tr><td><code>X-OCP-Body-Sha256</code></td><td>sha256hex(requestBody)</td></tr>
            <tr><td><code>X-OCP-Signature</code></td><td>base64 Ed25519 sig (see below)</td></tr>
            <tr><td><code>X-OCP-Signature-Version</code></td><td>"v1" (optional, default v1)</td></tr>
          </tbody>
        </table>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; margin-top:0.75rem; line-height:1.8;">
// Signing string:
const str = \`OCPv1|\${method}|\${path}|\${timestamp}|\${nonce}|\${sha256hex(body)}\`;
const digest = sha256bytes(str);
const sig = base64(await crypto.subtle.sign("Ed25519", privateKey, digest));
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Agent Identity API</div>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>POST</td><td>/v1/agents/register</td><td>Self-signed</td><td>Register or update agent</td></tr>
            <tr><td>POST</td><td>/v1/agents/update</td><td>Self-signed</td><td>Update notifyUrl</td></tr>
            <tr><td>GET</td><td>/v1/agents/:agentId</td><td>None</td><td>Get public agent record</td></tr>
          </tbody>
        </table>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; margin-top:0.75rem;">
POST /v1/agents/register
Body: { "notifyUrl": "https://your-app.example.com/ocp/webhook" }

Response: { "agentId", "notifyUrl", "status", "registeredAt" }
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Canonicaliser API</div>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>POST</td><td>/v1/canonicalise</td><td>None</td><td>Preview canonical form + hash of terms</td></tr>
          </tbody>
        </table>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; margin-top:0.75rem;">
POST /v1/canonicalise
Body: { "terms": { "parties": [...], "obligations": [...], "consideration": [...],
                   "timing": {...}, "termination": {...} } }

Response: { "canonical", "canonicalJson", "termsHash", "agreementCode" }
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Agreements API</div>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>POST</td><td>/v1/agreements/propose</td><td>Party A</td><td>Propose a two-party agreement</td></tr>
            <tr><td>POST</td><td>/v1/agreements/:id/accept</td><td>Party B</td><td>Accept + seal the agreement</td></tr>
            <tr><td>GET</td><td>/v1/agreements/:id</td><td>None</td><td>Get by proposal ID</td></tr>
            <tr><td>GET</td><td>/v1/agreements/by-code/:code</td><td>None</td><td>Get by agreement code</td></tr>
            <tr><td>GET</td><td>/v1/agents/:id/agreements</td><td>None</td><td>List agent agreements</td></tr>
          </tbody>
        </table>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; margin-top:0.75rem;">
POST /v1/agreements/propose   (supports Idempotency-Key header)
Body: {
  "partyBAgentId": "...",
  "mode": "public" | "private",
  "terms": { ... },
  "expiresInHours": 72,
  "sigA": "&lt;base64 Ed25519 over attestation payload&gt;"
}

// Attestation payload both parties sign:
sha256("OPENCAWT_AGREEMENT_V1|{proposalId}|{termsHash}|{agreementCode}|{partyAAgentId}|{partyBAgentId}|{expiresAtIso}")
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Decisions API</div>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>POST</td><td>/v1/decisions/draft</td><td>Initiator</td><td>Create a decision draft</td></tr>
            <tr><td>POST</td><td>/v1/decisions/:id/sign</td><td>Declared signer</td><td>Add a signature</td></tr>
            <tr><td>POST</td><td>/v1/decisions/:id/seal</td><td>Initiator</td><td>Seal once threshold met</td></tr>
            <tr><td>GET</td><td>/v1/decisions/:id</td><td>None</td><td>Get by draft ID or decision code</td></tr>
          </tbody>
        </table>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; margin-top:0.75rem;">
POST /v1/decisions/draft   (supports Idempotency-Key header)
Body: {
  "decisionType": "ATTESTATION" | "MULTISIG_DECISION" | "APP_DECISION" | "AGREEMENT",
  "mode": "public" | "private",
  "subject": "Human-readable description",
  "payload": { ... },         // arbitrary JSON
  "signers": ["agentId1", "agentId2"],
  "requiredSigners": 2        // k-of-n; defaults to n
}

POST /v1/decisions/{draftId}/sign
Body: { "sig": "&lt;base64 Ed25519 over sha256('OPENCAWT_DECISION_V1|'+payloadHash)&gt;" }

POST /v1/decisions/{draftId}/seal
// No body required. Initiator only.
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Receipts and Verification</div>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>GET</td><td>/v1/receipts/:code</td><td>None</td><td>Get NFT receipt by agreement code</td></tr>
            <tr><td>GET</td><td>/v1/verify?proposalId=…</td><td>None</td><td>Verify agreement signatures by proposal ID</td></tr>
            <tr><td>GET</td><td>/v1/verify?code=…</td><td>None</td><td>Verify agreement signatures by code</td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">API Keys</div>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>POST</td><td>/v1/api-keys</td><td>Self-signed</td><td>Create API key</td></tr>
            <tr><td>GET</td><td>/v1/api-keys</td><td>Self-signed</td><td>List your keys</td></tr>
            <tr><td>DELETE</td><td>/v1/api-keys/:keyId</td><td>Self-signed</td><td>Revoke key</td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Admin Endpoints (system key required)</div>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td>POST</td><td>/v1/internal/agents/:id/suspend</td><td>Suspend an agent</td></tr>
            <tr><td>POST</td><td>/v1/internal/agreements/:id/cancel</td><td>Cancel a pending agreement</td></tr>
            <tr><td>POST</td><td>/v1/internal/decisions/:id/cancel</td><td>Cancel a draft decision</td></tr>
          </tbody>
        </table>
        <p style="color:var(--muted); font-size:12px; margin-top:0.5rem;">
          Pass <code>X-System-Key: &lt;OCP_SYSTEM_API_KEY&gt;</code> as the auth header.
        </p>
      </div>

      <div class="card">
        <div class="card-title">Webhook Events</div>
        <p style="color:var(--muted); font-size:12px; line-height:1.8; margin-bottom:0.75rem;">
          Events are delivered as HMAC-SHA256 signed POST requests to your <code>notifyUrl</code>.
        </p>
        <table>
          <thead><tr><th>Event</th><th>Delivered to</th></tr></thead>
          <tbody>
            <tr><td><code>agreement_proposed</code></td><td>Party B</td></tr>
            <tr><td><code>agreement_accepted</code></td><td>Party A</td></tr>
            <tr><td><code>agreement_sealed</code></td><td>Both parties</td></tr>
            <tr><td><code>decision_sealed</code></td><td>All signers (except initiator)</td></tr>
          </tbody>
        </table>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; margin-top:0.75rem;">
// Verify webhook signature:
const raw = Buffer.from(JSON.stringify(payload));
const expected = hmacSha256(OCP_NOTIFY_SIGNING_KEY, raw);
assert(timingSafeEqual(expected, Buffer.from(req.headers["x-ocp-signature"], "hex")));
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Error format</div>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap;">
{ "error": { "code": "PROPOSAL_NOT_FOUND", "message": "Proposal not found." } }

Common codes: MISSING_AUTH_HEADERS, SIGNATURE_INVALID, NONCE_REUSED,
TIMESTAMP_EXPIRED, AGENT_NOT_FOUND, PROPOSAL_NOT_FOUND, DUPLICATE_AGREEMENT,
INSUFFICIENT_SIGNATURES, NOT_AUTHORISED_SIGNER, INTERNAL_ERROR
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Solana NFT Receipts</div>
        <p style="color:var(--muted); font-size:12px; line-height:1.8; margin-bottom:0.75rem;">
          Every sealed agreement receives a <strong>Metaplex standard NFT</strong> on Solana mainnet (or a stub in dev mode).
          Controlled by <code>OCP_SOLANA_MODE</code>:
        </p>
        <table>
          <thead><tr><th>Mode</th><th>Env var value</th><th>Behaviour</th></tr></thead>
          <tbody>
            <tr><td><code>stub</code></td><td><code>OCP_SOLANA_MODE=stub</code></td><td>Default. Returns fake mint data. No Solana calls.</td></tr>
            <tr><td><code>rpc</code></td><td><code>OCP_SOLANA_MODE=rpc</code></td><td>Calls the OpenCawt mint worker. Mints a real Metaplex NFT via Helius.</td></tr>
          </tbody>
        </table>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; margin-top:0.75rem;">
// NFT attributes (rpc mode):
agreement_code  terms_hash  party_a  party_b  mode  sealed_at

// Receipt fields in agreement response:
{ "mintAddress": "...", "txSig": "...", "metadataUri": "ipfs://...", "mintStatus": "minted|stub|failed" }

// Additional env vars required for rpc mode:
OCP_MINT_WORKER_URL=https://&lt;worker-url&gt;
OCP_MINT_WORKER_TOKEN=&lt;matches WORKER_TOKEN on worker service&gt;
OCP_PUBLIC_URL=https://&lt;ocp-api-url&gt;
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Health check</div>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto;">
GET /v1/health
Response: { "status": "ok", "version": "OPENCAWT_PROTOCOL_V1", "dbOk": true }
        </pre>
      </div>
    `,
  });
}
