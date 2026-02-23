import {
  adminAuth,
  adminBanDefence,
  adminBanFiling,
  adminBanJury,
  adminCheckSystems,
  adminDeleteCase,
  adminGetStatus,
  adminSetCourtMode,
  adminSetDailyCap,
  adminSetSoftCapMode,
  AdminApiError,
  type AdminCheckResult,
  type AdminStatus
} from "../data/adminAdapter";

// Session token persisted only in sessionStorage (cleared on tab close)
const SESSION_KEY = "_oc_adm";
const SESSION_SKEW_MS = 5_000;

type AdminSession = {
  token: string;
  expiresAtIso: string;
};

function getOcpFrontendUrl(): string {
  const configured = (import.meta.env.VITE_OCP_FRONTEND_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const port = window.location.port;
    if ((host === "localhost" || host === "127.0.0.1") && port === "5173") {
      return "http://127.0.0.1:5174";
    }
  }
  return "/ocp";
}

export function getAdminToken(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AdminSession;
    const expiresAtMs = new Date(parsed.expiresAtIso).getTime();
    if (!Number.isFinite(expiresAtMs) || Date.now() + SESSION_SKEW_MS >= expiresAtMs) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

function setAdminToken(session: AdminSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
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

function statusPill(
  label: string,
  ready: boolean,
  detail?: string,
  options?: { checking?: boolean; error?: string }
): string {
  const checking = options?.checking ?? false;
  const tone = checking ? "checking" : ready ? "ready" : "error";
  const text = checking ? "Checking…" : ready ? "Ready" : "Error";
  const displayDetail = options?.error ?? detail;
  return `
    <div class="admin-status-item">
      <span class="admin-status-label">${escapeAdminHtml(label)}</span>
      <span class="admin-status-pill is-${tone}">${text}</span>
      ${displayDetail ? `<span class="admin-status-detail">${escapeAdminHtml(displayDetail)}</span>` : ""}
    </div>
  `;
}

function renderStatusSection(
  status: AdminStatus | null,
  loading: boolean,
  checkResults: AdminCheckResult | null,
  checkLoading: boolean
): string {
  if (loading) {
    return `<div class="admin-section-body"><p class="muted">Loading status…</p></div>`;
  }
  if (!status) {
    return `<div class="admin-section-body"><p class="admin-error">Unable to fetch status.</p></div>`;
  }

  const useCheck = checkResults !== null;
  const checking = checkLoading;

  const dbReady = useCheck ? checkResults.db.ready : status.db.ready;
  const dbDetail = useCheck && checkResults.db.error ? checkResults.db.error : undefined;

  const workerReady = useCheck ? checkResults.railwayWorker.ready : status.railwayWorker.ready;
  const workerDetail = useCheck
    ? checkResults.railwayWorker.error ?? checkResults.railwayWorker.mode
    : status.railwayWorker.mode;

  const heliusReady = useCheck ? checkResults.helius.ready : status.helius.ready;
  const heliusDetail = useCheck
    ? checkResults.helius.error ?? (status.helius.hasApiKey ? "key present" : "no key")
    : status.helius.hasApiKey
      ? "key present"
      : "no key";

  const drandReady = useCheck ? checkResults.drand.ready : status.drand.ready;
  const drandDetail = useCheck ? (checkResults.drand.error ?? status.drand.mode) : status.drand.mode;

  const ocpReady = useCheck ? checkResults.ocp?.ready ?? false : status.ocp?.ready ?? false;
  const ocpDetail = useCheck && checkResults.ocp?.error ? checkResults.ocp.error : "v1/health + DB";

  const treasuryBalanceDisplay = status?.treasuryAddress
    ? (checkLoading ? "Checking…" : (checkResults?.treasuryBalanceSol ?? "—"))
    : null;

  const heliusTone = checking ? "checking" : heliusReady ? "ready" : "error";
  const heliusText = checking ? "Checking…" : heliusReady ? "Ready" : "Error";
  const heliusDisplayDetail = checking ? undefined : (useCheck ? checkResults.helius.error : heliusDetail);
  const heliusWithTreasury = `
    <div class="admin-status-item admin-status-item-with-sub">
      <span class="admin-status-label">Helius API</span>
      <span class="admin-status-pill is-${heliusTone}">${heliusText}</span>
      ${heliusDisplayDetail ? `<span class="admin-status-detail">${escapeAdminHtml(heliusDisplayDetail)}</span>` : ""}
      ${treasuryBalanceDisplay !== null ? `
      <div class="admin-treasury-pill">
        <span class="admin-status-label">Treasury Wallet balance (SOL):</span>
        <span class="admin-treasury-value">${escapeAdminHtml(treasuryBalanceDisplay)}</span>
      </div>` : ""}
    </div>
  `;

  return `
    <div class="admin-section-body">
      <div class="admin-status-row">
        <div class="admin-status-grid">
          ${statusPill("SQL Database", dbReady, dbDetail, { checking, error: checking ? undefined : (useCheck ? checkResults.db.error : undefined) })}
          ${statusPill("Railway Worker", workerReady, workerDetail, { checking, error: checking ? undefined : (useCheck ? checkResults.railwayWorker.error : undefined) })}
          ${heliusWithTreasury}
          ${statusPill("Drand API", drandReady, drandDetail, { checking, error: checking ? undefined : (useCheck ? checkResults.drand.error : undefined) })}
          ${statusPill("OCP API", ocpReady, ocpDetail, { checking, error: checking ? undefined : (useCheck ? checkResults.ocp?.error : undefined) })}
        </div>
        <button
          type="button"
          class="btn btn-sm btn-secondary admin-check-btn"
          data-action="admin-check-systems"
          ${checkLoading ? "disabled" : ""}
        >
          ${checkLoading ? "Checking…" : "Check Systems"}
        </button>
      </div>
      <p class="admin-meta">Daily case cap: <strong>${status.softDailyCaseCap}</strong> &nbsp;|&nbsp; Juror panel size: <strong>${status.jurorPanelSize}</strong></p>
    </div>
  `;
}

// --- Court mode toggle ---

function renderCourtModeSection(status: AdminStatus | null): string {
  const current = status?.courtMode ?? "judge";
  const jurorActive = current === "11-juror";
  const judgeActive = current === "judge";
  const judgeAvailable = status?.judgeAvailable ?? false;
  const warning = !judgeAvailable
    ? `<p class="admin-error">Judge integration is unavailable. Judge Mode cannot be enabled until it is restored.</p>`
    : "";
  return `
    <div class="admin-section-body">
      <div class="admin-toggle-row">
        <label class="admin-toggle-label">Court Mode</label>
        <div class="admin-toggle-group">
          <button type="button" class="admin-mode-btn ${judgeActive ? "is-active" : ""}" data-action="admin-set-court-mode" data-value="judge">Judge Mode (Default)</button>
          <button type="button" class="admin-mode-btn ${jurorActive ? "is-active" : ""}" data-action="admin-set-court-mode" data-value="11-juror">11 Juror (Override)</button>
        </div>
      </div>
      ${warning}
      <p class="admin-toggle-note muted">
        New cases use Judge Mode by default. Set 11 Juror only as an explicit override. Existing cases keep their original court mode.
      </p>
    </div>
  `;
}

// --- NFT System ---

function renderNftSystemSection(
  status: AdminStatus | null,
  checkResults: AdminCheckResult | null
): string {
  const treasuryAddress = status?.treasuryAddress ?? "—";
  const workerAddress =
    checkResults?.railwayWorker?.mintAuthorityPubkey ?? "Run Check Systems to see";
  const workflowSummary = status?.workflowSummary ?? "Workflow summary unavailable.";

  return `
    <div class="admin-section-body">
      <dl class="admin-address-list">
        <div class="admin-address-row">
          <dt>Treasury</dt>
          <dd><code class="admin-address-code">${escapeAdminHtml(treasuryAddress)}</code></dd>
        </div>
        <div class="admin-address-row">
          <dt>Worker mint authority</dt>
          <dd><code class="admin-address-code">${escapeAdminHtml(workerAddress)}</code></dd>
        </div>
      </dl>
      <p class="admin-workflow-summary muted">${escapeAdminHtml(workflowSummary)}</p>
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

function renderDailyCapSection(
  currentCap: number | null,
  softCapMode: "warn" | "enforce",
  feedback?: string
): string {
  const warnActive = softCapMode === "warn";
  const enforceActive = softCapMode === "enforce";
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
      <div class="admin-toggle-row">
        <label class="admin-toggle-label">Cap mode</label>
        <div class="admin-toggle-group admin-cap-mode-toggle">
          <button type="button" class="admin-mode-btn admin-cap-mode-btn ${warnActive ? "is-active" : ""}" data-action="admin-set-soft-cap-mode" data-value="warn">Warn</button>
          <button type="button" class="admin-mode-btn admin-cap-mode-btn ${enforceActive ? "is-active" : ""}" data-action="admin-set-soft-cap-mode" data-value="enforce">Enforce</button>
        </div>
      </div>
      <p class="admin-toggle-note muted">Warn: allow filings past the cap with a warning; Enforce: block filings when the cap is reached.</p>
      ${currentCap !== null ? `<p class="admin-meta">Current cap: <strong>${currentCap}</strong></p>` : ""}
      ${feedback ? `<p class="admin-feedback">${escapeAdminHtml(feedback)}</p>` : ""}
    </div>
  `;
}

// --- Dashboard ---

export interface AdminDashboardState {
  status: AdminStatus | null;
  statusLoading: boolean;
  checkResults: AdminCheckResult | null;
  checkLoading: boolean;
  feedback: Record<string, string>;
}

export function renderAdminDashboardView(state: AdminDashboardState): string {
  const cap = state.status?.softDailyCaseCap ?? null;
  return `
    <section class="glass-card card-solid view-frame admin-frame">
      <header class="view-head">
        <div class="view-title-row">
          <h2>Court Administration</h2>
          <a href="${escapeAdminHtml(getOcpFrontendUrl())}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-secondary admin-ocp-link">OCP Protocol</a>
          <button class="btn btn-sm btn-secondary admin-signout-btn" data-action="admin-signout">Sign out</button>
        </div>
        <p>Restricted control panel. Changes take effect immediately.</p>
        <div class="frieze">Internal Use Only</div>
      </header>
      <div class="view-body admin-dashboard">

        <div class="admin-section">
          <h3 class="admin-section-title">System Status</h3>
          ${renderStatusSection(state.status, state.statusLoading, state.checkResults, state.checkLoading)}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Court Mode</h3>
          ${renderCourtModeSection(state.status)}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">NFT System</h3>
          ${renderNftSystemSection(state.status, state.checkResults)}
        </div>

        <div class="admin-section">
          <h3 class="admin-section-title">Daily Case Cap</h3>
          ${renderDailyCapSection(cap, state.status?.softCapMode ?? "warn", state.feedback["daily-cap"])}
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

export async function handleAdminLogin(
  password: string
): Promise<{ token: string; expiresAtIso: string } | { error: string }> {
  try {
    const result = await adminAuth(password);
    setAdminToken(result);
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

export async function handleAdminSetSoftCapMode(
  token: string,
  mode: "warn" | "enforce"
): Promise<string> {
  try {
    const result = await adminSetSoftCapMode(token, mode);
    return `Cap mode set to ${result.softCapMode}.`;
  } catch (err) {
    return err instanceof AdminApiError ? err.message : "Action failed.";
  }
}

export async function handleAdminSetCourtMode(
  token: string,
  mode: "11-juror" | "judge"
): Promise<string> {
  try {
    const result = await adminSetCourtMode(token, mode);
    return `Court mode set to ${result.courtMode}. New cases will use this mode.`;
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

export async function handleAdminCheckSystems(
  token: string
): Promise<AdminCheckResult | null> {
  try {
    return await adminCheckSystems(token);
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
