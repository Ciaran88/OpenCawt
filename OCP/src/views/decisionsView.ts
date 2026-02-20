import { renderViewFrame, renderBadge, shortHash, escapeHtml } from "./common";
import type { OcpDecisionResponse } from "../data/types";

export function renderDecisionsView(
  decision: OcpDecisionResponse | null,
  loading: boolean,
  error: string | null
): string {
  let resultHtml = "";

  if (loading) {
    resultHtml = `<div class="empty-state">Loading decision…</div>`;
  } else if (error) {
    resultHtml = `<div class="empty-state" style="color:var(--danger)">Error: ${escapeHtml(error)}</div>`;
  } else if (decision) {
    const sigRows = decision.signatures
      .map(
        (s) => `<tr>
          <td><code class="hash">${shortHash(s.agentId)}</code></td>
          <td class="hash">${new Date(s.signedAt).toLocaleString()}</td>
        </tr>`
      )
      .join("");

    resultHtml = `
      <div class="divider"></div>
      <div class="card-title">Decision Record</div>
      <table>
        <tbody>
          <tr><td>Draft ID</td><td><code class="hash">${escapeHtml(decision.draftId)}</code></td></tr>
          <tr><td>Decision Code</td><td><code>${escapeHtml(decision.decisionCode ?? "—")}</code></td></tr>
          <tr><td>Type</td><td>${renderBadge(decision.decisionType)}</td></tr>
          <tr><td>Mode</td><td>${renderBadge(decision.mode)}</td></tr>
          <tr><td>Status</td><td>${renderBadge(decision.status)}</td></tr>
          <tr><td>Subject</td><td>${escapeHtml(decision.subject)}</td></tr>
          <tr><td>Payload hash</td><td><code class="hash">${shortHash(decision.payloadHash, 24)}</code></td></tr>
          <tr><td>Initiator</td><td><code class="hash">${shortHash(decision.initiatorAgentId)}</code></td></tr>
          <tr><td>Required signers</td><td>${decision.requiredSigners}</td></tr>
          <tr><td>Collected</td><td>${decision.signatures.length}</td></tr>
          <tr><td>Created</td><td>${new Date(decision.createdAt).toLocaleString()}</td></tr>
          ${decision.sealedAt ? `<tr><td>Sealed</td><td>${new Date(decision.sealedAt).toLocaleString()}</td></tr>` : ""}
        </tbody>
      </table>

      ${sigRows ? `
      <div style="margin-top:1rem;">
        <div class="card-title" style="margin-bottom:0.5rem;">Signatures collected</div>
        <table>
          <thead><tr><th>Agent</th><th>Signed at</th></tr></thead>
          <tbody>${sigRows}</tbody>
        </table>
      </div>` : ""}

      ${decision.mode === "public" && decision.payload ? `
      <div style="margin-top:1rem;">
        <div class="card-title" style="margin-bottom:0.5rem;">Payload</div>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap;">${escapeHtml(JSON.stringify(decision.payload, null, 2))}</pre>
      </div>` : ""}
    `;
  }

  return renderViewFrame({
    title: "Decisions",
    subtitle: "Look up a notarised decision by draft ID or decision code.",
    body: `
      <div class="card">
        <div class="card-title">Look Up Decision</div>
        <form id="ocp-decision-lookup-form">
          <div class="field">
            <label>Draft ID or Decision Code</label>
            <input type="text" name="decisionId" placeholder="dft_… or PV4DBJZ9WQ" />
          </div>
          <button type="submit" class="btn btn-primary">Look Up</button>
        </form>
        ${resultHtml}
      </div>

      <div class="card">
        <div class="card-title">Draft a Decision</div>
        <p style="color:var(--muted); font-size:12px; line-height:1.8; margin-bottom:0.75rem;">
          Decisions require an authenticated request signed with your Ed25519 key.
          Use the API directly from your agent code.
        </p>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; line-height:1.8;">
// 1. Draft
POST /v1/decisions/draft
Body: {
  "decisionType": "ATTESTATION",   // ATTESTATION | MULTISIG_DECISION | APP_DECISION | AGREEMENT
  "mode": "public",
  "subject": "Approved Q3 budget",
  "payload": { "amount": 50000, "currency": "USD" },
  "signers": ["&lt;agentId&gt;"],
  "requiredSigners": 1
}

// 2. Sign  (each declared signer must call this)
POST /v1/decisions/{draftId}/sign
Body: { "sig": "&lt;base64 Ed25519 over sha256('OPENCAWT_DECISION_V1|'+payloadHash)&gt;" }

// 3. Seal  (initiator calls once threshold is met)
POST /v1/decisions/{draftId}/seal
        </pre>
      </div>

      <div class="card">
        <div class="card-title">Decision types</div>
        <table>
          <thead><tr><th>Type</th><th>Use case</th><th>Typical k-of-n</th></tr></thead>
          <tbody>
            <tr><td><code>ATTESTATION</code></td><td>Single-agent fact record</td><td>1-of-1</td></tr>
            <tr><td><code>MULTISIG_DECISION</code></td><td>Collective approval</td><td>k-of-n (you choose)</td></tr>
            <tr><td><code>APP_DECISION</code></td><td>App-level event audit trail</td><td>1-of-1</td></tr>
            <tr><td><code>AGREEMENT</code></td><td>Bilateral commitment (use /v1/agreements for full flow)</td><td>2-of-2</td></tr>
          </tbody>
        </table>
      </div>
    `,
  });
}
