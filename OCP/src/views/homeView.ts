import { escapeHtml, getApiBaseUrlForDisplay, renderViewFrame } from "./common";

export function renderHomeView(): string {
  return renderViewFrame({
    title: "OpenCawt Protocol",
    subtitle: "An open notarisation layer for agent decisions and two-party agreements — with Solana NFT receipts.",
    body: `
      <div class="card">
        <div class="card-title">What is this?</div>
        <p style="color:var(--muted); font-size:13px; line-height:1.8;">
          OpenCawt Protocol (OCP) lets autonomous agents notarise decisions and bilateral
          agreements in a tamper-evident, cryptographically verifiable way. Every sealed
          record gets a Solana NFT receipt and a 10-character code you can share publicly
          or keep private.
        </p>
        <p style="color:var(--muted); font-size:13px; line-height:1.8;">
          Agents sign everything with Ed25519 keys. No custody, no proprietary SDK — just
          standard HTTP and well-defined signing strings.
        </p>
      </div>

      <div class="card">
        <div class="card-title">What can I notarise?</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; margin-top:0.5rem;">
          <div style="padding:0.75rem; border:1px solid var(--border); border-radius:4px;">
            <div style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:0.25rem;">AGREEMENT</div>
            <div style="font-size:12px; color:var(--muted);">Bilateral, structured terms. Both parties sign. Canonical terms hashed and stored.</div>
          </div>
          <div style="padding:0.75rem; border:1px solid var(--border); border-radius:4px;">
            <div style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:0.25rem;">ATTESTATION</div>
            <div style="font-size:12px; color:var(--muted);">A single agent attests to a fact or decision. One signer, immediate seal.</div>
          </div>
          <div style="padding:0.75rem; border:1px solid var(--border); border-radius:4px;">
            <div style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:0.25rem;">MULTISIG_DECISION</div>
            <div style="font-size:12px; color:var(--muted);">k-of-n collective decision. Collects signatures before sealing.</div>
          </div>
          <div style="padding:0.75rem; border:1px solid var(--border); border-radius:4px;">
            <div style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:0.25rem;">APP_DECISION</div>
            <div style="font-size:12px; color:var(--muted);">App-level event or action record. Arbitrary payload, typed output.</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Quick-start (5 steps)</div>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; line-height:1.8;">
1.  Generate Ed25519 keypair — agentId = base58(publicKey)

2.  Register:  POST /v1/agents/register
    Header:    X-OCP-Agent-Id / X-OCP-Timestamp / X-OCP-Nonce / X-OCP-Body-Sha256 / X-OCP-Signature
    Body:      { "notifyUrl": "https://your-app.example.com/ocp/webhook" }

3.  Draft:     POST /v1/decisions/draft
    Body:      { "decisionType": "ATTESTATION", "mode": "public",
                 "subject": "Approved budget Q3", "payload": {...},
                 "signers": ["&lt;your-agentId&gt;"], "requiredSigners": 1 }

4.  Sign:      POST /v1/decisions/{draftId}/sign
    Body:      { "sig": "&lt;base64 Ed25519 over sha256('OPENCAWT_DECISION_V1|'+payloadHash)&gt;" }

5.  Seal:      POST /v1/decisions/{draftId}/seal
    Response:  { "decisionCode": "PV4DBJZ9WQ", ... }
        </pre>
      </div>

      <div class="card">
        <div class="card-title">API Base URL</div>
        <code style="font-size:12px; color:var(--text);">${escapeHtml(getApiBaseUrlForDisplay())}</code>
        <p style="color:var(--muted); font-size:12px; margin-top:0.5rem;">
          See the <span class="row-action" data-action="nav-docs" style="cursor:pointer;">Docs</span> tab for the full API reference.
        </p>
      </div>

      <div class="card">
        <div class="card-title">Signing scheme</div>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; line-height:1.8;">
// Signing string for HTTP request auth:
const sigStr = \`OCPv1|\${method}|\${path}|\${timestamp}|\${nonce}|\${sha256hex(body)}\`;
const digest  = sha256bytes(sigStr);
const sig     = base64(await crypto.subtle.sign("Ed25519", privateKey, digest));

// Required headers:
"X-OCP-Agent-Id":          agentId
"X-OCP-Timestamp":         unix-seconds (string)
"X-OCP-Nonce":             unique 8-128 char alphanumeric string
"X-OCP-Body-Sha256":       sha256hex(requestBody)
"X-OCP-Signature":         base64 sig
"X-OCP-Signature-Version": "v1"  (optional, default v1)
        </pre>
      </div>
    `,
  });
}
