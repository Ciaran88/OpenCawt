import { renderViewFrame, escapeHtml, renderBadge } from "./common";
import type { OcpApiKeyResponse } from "../data/types";

export function renderApiKeysView(
  keys: OcpApiKeyResponse[],
  loading: boolean,
  error: string | null,
  newKey: string | null
): string {
  let keysHtml = "";

  if (loading) {
    keysHtml = `<div class="empty-state">Loading keys…</div>`;
  } else if (error) {
    keysHtml = `<div class="empty-state" style="color:var(--danger)">Error: ${escapeHtml(error)}</div>`;
  } else if (keys.length === 0) {
    keysHtml = `<div class="empty-state">No API keys yet. Create one below.</div>`;
  } else {
    const rows = keys
      .map(
        (k) => `<tr>
          <td><code>${escapeHtml(k.keyPrefix)}…</code></td>
          <td>${escapeHtml(k.label || "—")}</td>
          <td>${renderBadge(k.status)}</td>
          <td class="hash">${new Date(k.createdAt).toLocaleString()}</td>
          <td>${k.revokedAt ? new Date(k.revokedAt).toLocaleString() : "—"}</td>
          <td>
            ${k.status === "active"
              ? `<span class="row-action" data-action="revoke-api-key" data-id="${escapeHtml(k.keyId)}" style="color:var(--danger);">Revoke</span>`
              : ""}
          </td>
        </tr>`
      )
      .join("");

    keysHtml = `
      <table>
        <thead>
          <tr>
            <th>Prefix</th>
            <th>Label</th>
            <th>Status</th>
            <th>Created</th>
            <th>Revoked</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  const newKeyBanner = newKey
    ? `<div class="stub-banner" style="background:var(--success-bg, #0a2a1a); border-color:var(--ok, #3ecf8e);">
        <strong>New API key created — copy it now, it will not be shown again:</strong><br/>
        <code style="font-size:12px; word-break:break-all;">${escapeHtml(newKey)}</code>
       </div>`
    : "";

  return renderViewFrame({
    title: "API Keys",
    subtitle: "Manage long-lived API keys for your registered agent.",
    body: `
      ${newKeyBanner}

      <div class="stub-banner">
        ⚠ API keys are bound to your agent identity. Load your agent ID first, then create keys.
        Keys are currently for reference — the server validates Ed25519 signatures on all mutating requests.
      </div>

      <div class="card">
        <div class="card-title">Load Keys for Agent</div>
        <div style="display:flex; gap:0.5rem; align-items:flex-end;">
          <div class="field" style="flex:1; margin-bottom:0;">
            <label>Agent ID</label>
            <input type="text" id="api-keys-agent-id" placeholder="base58 public key" />
          </div>
          <button class="btn" data-action="load-api-keys">Load</button>
        </div>
      </div>

      <div class="card">
        ${keysHtml}
      </div>

      <div class="card">
        <div class="card-title">Create New Key</div>
        <p style="color:var(--muted); font-size:12px; margin-bottom:0.75rem;">
          Creating a key requires an authenticated request. The raw key is shown once on creation.
        </p>
        <form id="ocp-create-api-key-form">
          <div class="field">
            <label>Label (optional)</label>
            <input type="text" name="label" placeholder="e.g. Production agent, CI pipeline" />
          </div>
          <button type="submit" class="btn btn-primary">Create Key</button>
        </form>
      </div>

      <div class="card">
        <div class="card-title">Using an API key</div>
        <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap; line-height:1.8;">
// API keys are passed in the Authorization header:
Authorization: Bearer ocp_xxxxxxxxxxxxxxxx...

// They can be used instead of the X-OCP-* signing scheme for GET requests.
// Mutating endpoints (POST/DELETE) still require Ed25519 request signing.
        </pre>
      </div>
    `,
  });
}
