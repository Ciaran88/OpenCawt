import { renderViewFrame, renderBadge, shortHash, escapeHtml, stubBanner } from "./common";
import type { OcpAgreementResponse } from "../data/types";

export function renderRecordsView(
  agreements: OcpAgreementResponse[],
  loading: boolean,
  error: string | null
): string {
  let content = "";

  if (loading) {
    content = `<div class="empty-state">Loading records…</div>`;
  } else if (error) {
    content = `<div class="empty-state" style="color:var(--danger)">Error: ${escapeHtml(error)}</div>`;
  } else if (agreements.length === 0) {
    content = `<div class="empty-state">No agreement records. Enter your agent ID above to load.</div>`;
  } else {
    const rows = agreements
      .map(
        (a) => `
      <tr>
        <td>${renderBadge(a.status)}</td>
        <td><code class="mono">${escapeHtml(a.agreementCode)}</code></td>
        <td><code class="hash">${shortHash(a.partyAAgentId)}</code></td>
        <td><code class="hash">${shortHash(a.partyBAgentId)}</code></td>
        <td>${renderBadge(a.mode)}</td>
        <td class="hash">${a.sealedAt ? new Date(a.sealedAt).toLocaleString() : "—"}</td>
        <td>${
          a.receipt
            ? `<code class="hash">${shortHash(a.receipt.mintAddress, 16)}</code> ${renderBadge(a.receipt.mintStatus)}`
            : "—"
        }</td>
        <td>
          <span class="row-action" data-action="view-agreement" data-id="${escapeHtml(a.proposalId)}">View</span>
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
            <th>Party B</th>
            <th>Mode</th>
            <th>Sealed At</th>
            <th>Mint</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  return renderViewFrame({
    title: "Agreement Records",
    subtitle: "All agreements for an agent, including sealed receipts.",
    body: `
      ${stubBanner()}
      <div class="card">
        <div class="card-title">Load Records</div>
        <div style="display:flex; gap:0.5rem; align-items:flex-end;">
          <div class="field" style="flex:1; margin-bottom:0;">
            <label>Agent ID</label>
            <input type="text" id="records-agent-id" placeholder="base58 public key" />
          </div>
          <select id="records-status-filter" style="padding:0.5rem; background:var(--bg); border:1px solid var(--border); color:var(--text); border-radius:4px; font-family:inherit; font-size:13px;">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="sealed">Sealed</option>
            <option value="expired">Expired</option>
          </select>
          <button class="btn" data-action="load-records">Load</button>
        </div>
      </div>

      <div class="card">
        ${content}
      </div>
    `,
  });
}
