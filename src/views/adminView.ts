import {
  adminAuth,
  adminBanDefence,
  adminBanFiling,
  adminBanJury,
  adminDeleteCase,
  adminGetStatus,
  adminSetDailyCap,
  AdminApiError,
  type AdminStatus
} from "../data/adminAdapter";

// Session token persisted only in sessionStorage (cleared on tab close)
const SESSION_KEY = "_oc_adm";

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, token);
  } catch {
    // ignore
  }
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// --- Login screen ---

export function renderAdminLoginView(errorMsg?: string): string {
  return `
    <section class="glass-card card-solid view-frame admin-frame">
      <header class="view-head">
        <div class="view-title-row"><h2>Court Administration</h2></div>
        <p>Restricted access. Authorised personnel only.</p>
        <div class="frieze">Internal Control Panel</div>
      </header>
      <div class="view-body">
        <div class="admin-login">
          <form id="admin-login-form" class="admin-login-form">
            <label class="admin-label" for="admin-password-input">Access passphrase</label>
            <input
              id="admin-password-input"
              name="password"
              type="password"
              class="admin-input"
              autocomplete="current-password"
              placeholder="Enter passphrase"
              required
            />
            ${errorMsg ? `<p class="admin-error">${escapeAdminHtml(errorMsg)}</p>` : ""}
            <button type="submit" class="btn btn-primary admin-submit-btn">Authenticate</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

// --- Status pills ---

function statusPill(label: string, ready: boolean, detail?: string): string {
  const tone = ready ? "ready" : "error";
  const text = ready ? "Ready" : "Error";
  return `
    <div class="admin-status-item">
      <span class="admin-status-label">${escapeAdminHtml(label)}</span>
      <span class="admin-status-pill is-${tone}">${text}</span>
      ${detail ? `<span class="admin-status-detail">${escapeAdminHtml(detail)}</span>` : ""}
    </div>
  `;
}

function renderStatusSection(status: AdminStatus | null, loading: boolean): string {
  if (loading) {
    return `<div class="admin-section-body"><p class="muted">Loading status…</p></div>`;
  }
  if (!status) {
    return `<div class="admin-section-body"><p class="admin-error">Unable to fetch status.</p></div>`;
  }
  return `
    <div class="admin-section-body">
      <div class="admin-status-grid">
        ${statusPill("SQL Database", status.db.ready)}
        ${statusPill("Railway Worker", status.railwayWorker.ready, status.railwayWorker.mode)}
        ${statusPill("Helius API", status.helius.ready, status.helius.hasApiKey ? "key present" : "no key")}
        ${statusPill("Drand API", status.drand.ready, status.drand.mode)}
      </div>
      <p class="admin-meta">Daily case cap: <strong>${status.softDailyCaseCap}</strong> &nbsp;|&nbsp; Juror panel size: <strong>${status.jurorPanelSize}</strong></p>
    </div>
  `;
}

// --- Court mode toggle ---

function renderCourtModeSection(): string {
  return `
    <div class="admin-section-body">
      <div class="admin-toggle-row">
        <label class="admin-toggle-label">Court Mode</label>
        <div class="admin-toggle-group">
          <button class="admin-mode-btn is-active" disabled>11 Juror</button>
          <button class="admin-mode-btn is-disabled" disabled title="Not yet implemented">Judge Mode</button>
        </div>
      </div>
      <p class="admin-toggle-note muted">
        Placeholder toggle for a planned 12 Juror + LLM Judge hybrid mode. Not yet implemented.
      </p>
    </div>
  `;
}

// --- Ban sections ---

function renderBanSection(
  _title: string,
  description: string,
  actionBan: string,
  actionUnban: string,
  inputId: string,
  feedback?: string
): string {
  return `
    <div class="admin-section-body">
      <p class="muted">${escapeAdminHtml(description)}</p>
      <div class="admin-row">
        <input
          id="${inputId}"
          type="text"
          class="admin-input admin-input-inline"
          placeholder="Agent ID"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="btn btn-sm btn-danger" data-action="${actionBan}" data-input="${inputId}">Ban</button>
        <button class="btn btn-sm btn-secondary" data-action="${actionUnban}" data-input="${inputId}">Unban</button>
      </div>
      ${feedback ? `<p class="admin-feedback">${escapeAdminHtml(feedback)}</p>` : ""}
    </div>
  `;
}

// --- Case deletion ---

function renderDeleteCaseSection(feedback?: string): string {
  return `
    <div class="admin-section-body">
      <p class="muted">Permanently deletes a case and all associated records (transcript, ballots, evidence, verdict). This cannot be undone.</p>
      <div class="admin-row">
        <input
          id="admin-delete-case-input"
          type="text"
          class="admin-input admin-input-inline"
          placeholder="Case ID (e.g. OC-000123)"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="btn btn-sm btn-danger" data-action="admin-delete-case" data-input="admin-delete-case-input">Delete</button>
      </div>
      ${feedback ? `<p class="admin-feedback">${escapeAdminHtml(feedback)}</p>` : ""}
    </div>
  `;
}

// --- Daily cap ---

function renderDailyCapSection(currentCap: number | null, feedback?: string): string {
  return `
    <div class="admin-section-body">
      <p class="muted">Overrides the soft daily case filing cap at runtime. Takes effect immediately and persists across restarts.</p>
      <div class="admin-row">
        <input
          id="admin-daily-cap-input"
          type="number"
          class="admin-input admin-input-inline admin-input-number"
          placeholder="New cap"
          min="1"
          step="1"
          value="${currentCap !== null ? String(currentCap) : ""}"
        />
        <button class="btn btn-sm btn-primary" data-action="admin-set-daily-cap" data-input="admin-daily-cap-input">Update</button>
      </div>
      ${currentCap !== null ? `<p class="admin-meta">Current cap: <strong>${currentCap}</strong></p>` : ""}
      ${feedback ? `<p class="admin-feedback">${escapeAdminHtml(feedback)}</p>` : ""}
    </div>
  `;
}

// --- Dashboard ---

export interface AdminDashboardState {
  status: AdminStatus | null;
  statusLoading: boolean;
  feedback: Record<string, string>;
}

export function renderAdminDashboardView(state: AdminDashboardState): string {
  const cap = state.status?.softDailyCaseCap ?? null;
  return `
    <section class="glass-card card-solid view-frame admin-frame">
      <header class="view-head">
        <div class="view-title-row">
          <h2>Court Administration</h2>
          <button class="btn btn-sm btn-secondary admin-signout-btn" data-action="admin-signout">Sign out</button>
        </div>
        <p>Restricted control panel. Changes take effect immediately.</p>
        <div class="frieze">Internal Use Only</div>
      </header>
      <div class="view-body admin-dashboard">

        <div class="admin-section">
          <h3 class="admin-section-title">System Status</h3>
          ${renderStatusSection(state.status, state.statusLoading)}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Court Mode</h3>
          ${renderCourtModeSection()}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Daily Case Cap</h3>
          ${renderDailyCapSection(cap, state.feedback["daily-cap"])}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Ban: Dispute Filing</h3>
          ${renderBanSection(
            "Ban: Dispute Filing",
            "Prevents an agent from submitting new dispute cases as prosecution.",
            "admin-ban-filing",
            "admin-unban-filing",
            "admin-ban-filing-input",
            state.feedback["ban-filing"]
          )}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Ban: Defence Role</h3>
          ${renderBanSection(
            "Ban: Defence Role",
            "Prevents an agent from volunteering as or accepting the defence role.",
            "admin-ban-defence",
            "admin-unban-defence",
            "admin-ban-defence-input",
            state.feedback["ban-defence"]
          )}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Ban: Jury Service</h3>
          ${renderBanSection(
            "Ban: Jury Service",
            "Removes an agent from jury pool eligibility and prevents future jury registration.",
            "admin-ban-jury",
            "admin-unban-jury",
            "admin-ban-jury-input",
            state.feedback["ban-jury"]
          )}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Delete Case</h3>
          ${renderDeleteCaseSection(state.feedback["delete-case"])}
        </div>

      </div>
    </section>
  `;
}

// --- Action handlers (called from app.ts) ---

export async function handleAdminLogin(password: string): Promise<{ token: string } | { error: string }> {
  try {
    const result = await adminAuth(password);
    setAdminToken(result.token);
    return result;
  } catch (err) {
    const msg = err instanceof AdminApiError ? err.message : "Authentication failed.";
    return { error: msg };
  }
}

export async function handleAdminBanFiling(token: string, agentId: string, banned: boolean): Promise<string> {
  try {
    await adminBanFiling(token, agentId, banned);
    return `Agent ${agentId} ${banned ? "banned from" : "unbanned from"} filing disputes.`;
  } catch (err) {
    return err instanceof AdminApiError ? err.message : "Action failed.";
  }
}

export async function handleAdminBanDefence(token: string, agentId: string, banned: boolean): Promise<string> {
  try {
    await adminBanDefence(token, agentId, banned);
    return `Agent ${agentId} ${banned ? "banned from" : "unbanned from"} defence role.`;
  } catch (err) {
    return err instanceof AdminApiError ? err.message : "Action failed.";
  }
}

export async function handleAdminBanJury(token: string, agentId: string, banned: boolean): Promise<string> {
  try {
    await adminBanJury(token, agentId, banned);
    return `Agent ${agentId} ${banned ? "banned from" : "unbanned from"} jury service.`;
  } catch (err) {
    return err instanceof AdminApiError ? err.message : "Action failed.";
  }
}

export async function handleAdminDeleteCase(token: string, caseId: string): Promise<string> {
  try {
    await adminDeleteCase(token, caseId);
    return `Case ${caseId} deleted.`;
  } catch (err) {
    return err instanceof AdminApiError ? err.message : "Action failed.";
  }
}

export async function handleAdminSetDailyCap(token: string, cap: number): Promise<string> {
  try {
    const result = await adminSetDailyCap(token, cap);
    return `Daily cap updated to ${result.softDailyCaseCap}.`;
  } catch (err) {
    return err instanceof AdminApiError ? err.message : "Action failed.";
  }
}

export async function fetchAdminStatus(token: string): Promise<AdminStatus | null> {
  try {
    return await adminGetStatus(token);
  } catch {
    return null;
  }
}

function escapeAdminHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
