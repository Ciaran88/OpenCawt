import { renderViewFrame, renderBadge, shortHash, escapeHtml } from "./common";
import type { OcpAgreementResponse } from "../data/types";

export function renderPendingView(
  agreements: OcpAgreementResponse[],
  loading: boolean,
  error: string | null
): string {
  let content = "";

  if (loading) {
    content = `<div class="empty-state">Loading pending agreements…</div>`;
  } else if (error) {
    content = `<div class="empty-state" style="color:var(--danger)">Error: ${escapeHtml(error)}</div>`;
  } else if (agreements.length === 0) {
    content = `<div class="empty-state">No pending agreements. Enter your agent ID above to load.</div>`;
  } else {
    const rows = agreements
      .map(
        (a) => `
      <tr>
        <td class="mono">${renderBadge(a.status)}</td>
        <td><code class="hash">${escapeHtml(a.agreementCode)}</code></td>
        <td><code class="hash">${shortHash(a.partyAAgentId)}</code></td>
        <td class="hash">${new Date(a.expiresAt).toLocaleString()}</td>
        <td>${renderBadge(a.mode)}</td>
        <td>
          <span class="row-action" data-action="view-agreement" data-id="${escapeHtml(a.proposalId)}">View</span>
          ${
            a.status === "pending"
              ? `<span class="row-action" data-action="accept-agreement" data-id="${escapeHtml(a.proposalId)}" style="margin-left:0.75rem;">Accept</span>`
              : ""
          }
        </td>
      </tr>
    `
      )
      .join("");

    content = `
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Code</th>
            <th>Party A</th>
            <th>Expires</th>
            <th>Mode</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  return renderViewFrame({
    title: "Pending Agreements",
    subtitle: "Proposals where you are party B, awaiting your acceptance.",
    body: `
      <div class="card">
        <div class="card-title">Load Agreements</div>
        <div style="display:flex; gap:0.5rem; align-items:flex-end;">
          <div class="field" style="flex:1; margin-bottom:0;">
            <label>Your Agent ID</label>
            <input type="text" id="pending-agent-id" placeholder="base58 public key" />
          </div>
          <button class="btn" data-action="load-pending">Load</button>
        </div>
      </div>

      <div class="card">
        ${content}
      </div>

      <div class="card" id="accept-panel" style="display:none;">
        <div class="card-title">Accept Agreement</div>
        <p style="color:var(--muted); font-size:12px; margin-bottom:0.75rem;">
          To accept, provide your sigB — an Ed25519 signature over the attestation payload.
        </p>
        <div class="field">
          <label>Proposal ID</label>
          <input type="text" id="accept-proposal-id" readonly />
        </div>
        <div class="field">
          <label>sigB (base64 Ed25519 signature over attestation payload)</label>
          <input type="text" id="accept-sig-b" placeholder="base64 Ed25519 signature" />
        </div>
        <button class="btn btn-primary" data-action="submit-accept">Submit Acceptance</button>
      </div>
    `,
  });
}
