import { parseOcpRoute, routeToPath, NAV_ITEMS, type OcpRoute } from "../util/router";
import { renderHomeView } from "../views/homeView";
import { renderRegisterView } from "../views/registerView";
import { renderProposeView } from "../views/proposeView";
import { renderPendingView } from "../views/pendingView";
import { renderRecordsView } from "../views/recordsView";
import { renderVerifyView } from "../views/verifyView";
import { renderDecisionsView } from "../views/decisionsView";
import { renderApiKeysView } from "../views/apiKeysView";
import { renderDocsView } from "../views/docsView";
import {
  listAgreements,
  acceptAgreement,
  verifyAgreement,
  getAgreement,
  getDecision,
  listApiKeys,
} from "../data/adapter";
import type { OcpAgreementResponse, VerifyResponse, OcpDecisionResponse, OcpApiKeyResponse } from "../data/types";
import { escapeHtml } from "../views/common";

// ---- State ----

interface AppState {
  route: OcpRoute;
  pendingAgreements: OcpAgreementResponse[];
  pendingLoading: boolean;
  pendingError: string | null;
  records: OcpAgreementResponse[];
  recordsLoading: boolean;
  recordsError: string | null;
  verifyResult: VerifyResponse | null;
  verifyError: string | null;
  decision: OcpDecisionResponse | null;
  decisionLoading: boolean;
  decisionError: string | null;
  apiKeys: OcpApiKeyResponse[];
  apiKeysLoading: boolean;
  apiKeysError: string | null;
  newApiKey: string | null;
  toast: { message: string; tone: "ok" | "err" } | null;
  toastTimer: ReturnType<typeof setTimeout> | null;
}

function initialState(): AppState {
  return {
    route: parseOcpRoute(window.location.pathname),
    pendingAgreements: [],
    pendingLoading: false,
    pendingError: null,
    records: [],
    recordsLoading: false,
    recordsError: null,
    verifyResult: null,
    verifyError: null,
    decision: null,
    decisionLoading: false,
    decisionError: null,
    apiKeys: [],
    apiKeysLoading: false,
    apiKeysError: null,
    newApiKey: null,
    toast: null,
    toastTimer: null,
  };
}

let state = initialState();

// ---- Render ----

function renderSidebar(): string {
  return NAV_ITEMS.map(
    (item) =>
      `<span class="nav-item ${state.route.name === item.name ? "active" : ""}"
         data-link="true" data-route="${item.name}">${item.label}</span>`
  ).join("");
}

function renderRouteContent(): string {
  switch (state.route.name) {
    case "home":
      return renderHomeView();
    case "register":
      return renderRegisterView();
    case "propose":
      return renderProposeView();
    case "pending":
      return renderPendingView(
        state.pendingAgreements,
        state.pendingLoading,
        state.pendingError
      );
    case "records":
      return renderRecordsView(
        state.records,
        state.recordsLoading,
        state.recordsError
      );
    case "verify":
      return renderVerifyView(state.verifyResult, state.verifyError);
    case "decisions":
      return renderDecisionsView(state.decision, state.decisionLoading, state.decisionError);
    case "api-keys":
      return renderApiKeysView(state.apiKeys, state.apiKeysLoading, state.apiKeysError, state.newApiKey);
    case "docs":
      return renderDocsView();
    case "agreement":
      return `<div class="page-title">Agreement ${escapeHtml(state.route.id)}</div>
              <div class="page-sub">Loading…</div>`;
    case "decision":
      return `<div class="page-title">Decision ${escapeHtml(state.route.id)}</div>
              <div class="page-sub">Loading…</div>`;
    default:
      return renderHomeView();
  }
}

function renderToast(): string {
  if (!state.toast) return "";
  return `<div class="toast toast-${state.toast.tone}">${escapeHtml(state.toast.message)}</div>`;
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `
    <nav class="sidebar">
      <div class="sidebar-logo"><img src="/opencawt_white.png" alt="" class="sidebar-logo-img" />OpenCawt<span> Protocol</span></div>
      ${renderSidebar()}
    </nav>
    <main class="main">
      ${renderRouteContent()}
    </main>
    ${renderToast()}
  `;
}

// ---- Navigation ----

function navigate(route: OcpRoute): void {
  state.route = route;
  const path = routeToPath(route);
  window.history.pushState({}, "", path);
  render();
}

// ---- Toast ----

function showToast(message: string, tone: "ok" | "err" = "ok"): void {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toast = { message, tone };
  state.toastTimer = setTimeout(() => {
    state.toast = null;
    render();
  }, 4000);
  render();
}

// ---- Event handlers ----

async function handleLoadPending(): Promise<void> {
  const input = document.getElementById("pending-agent-id") as HTMLInputElement | null;
  const agentId = input?.value.trim();
  if (!agentId) { showToast("Enter your agent ID first.", "err"); return; }
  state.pendingLoading = true;
  state.pendingError = null;
  render();
  try {
    const res = await listAgreements(agentId, "pending");
    state.pendingAgreements = res.agreements;
  } catch (e) {
    state.pendingError = (e as Error).message;
  } finally {
    state.pendingLoading = false;
  }
  render();
}

async function handleLoadRecords(): Promise<void> {
  const input = document.getElementById("records-agent-id") as HTMLInputElement | null;
  const agentId = input?.value.trim();
  const statusSel = document.getElementById("records-status-filter") as HTMLSelectElement | null;
  const status = statusSel?.value ?? "all";
  if (!agentId) { showToast("Enter an agent ID first.", "err"); return; }
  state.recordsLoading = true;
  state.recordsError = null;
  render();
  try {
    const res = await listAgreements(agentId, status);
    state.records = res.agreements;
  } catch (e) {
    state.recordsError = (e as Error).message;
  } finally {
    state.recordsLoading = false;
  }
  render();
}

async function handleAcceptAgreement(proposalId: string): Promise<void> {
  const panel = document.getElementById("accept-panel");
  const idInput = document.getElementById("accept-proposal-id") as HTMLInputElement | null;
  if (panel) panel.style.display = "block";
  if (idInput) idInput.value = proposalId;
}

async function handleSubmitAccept(): Promise<void> {
  const idInput = document.getElementById("accept-proposal-id") as HTMLInputElement | null;
  const sigInput = document.getElementById("accept-sig-b") as HTMLInputElement | null;
  const proposalId = idInput?.value.trim();
  const sigB = sigInput?.value.trim();
  if (!proposalId || !sigB) { showToast("Proposal ID and sigB are required.", "err"); return; }
  try {
    const result = await acceptAgreement(proposalId, { sigB });
    showToast(`Agreement sealed! Code: ${result.agreementCode}`, "ok");
    await handleLoadPending();
  } catch (e) {
    showToast((e as Error).message, "err");
  }
}

async function handleViewAgreement(proposalId: string): Promise<void> {
  navigate({ name: "agreement", id: proposalId });
  try {
    const agreement = await getAgreement(proposalId);
    const main = document.querySelector("main.main");
    if (main) {
      main.innerHTML = renderAgreementDetail(agreement);
    }
  } catch (e) {
    showToast((e as Error).message, "err");
  }
}

async function handleLoadDecision(id: string): Promise<void> {
  state.decisionLoading = true;
  state.decisionError = null;
  state.decision = null;
  render();
  try {
    state.decision = await getDecision(id);
  } catch (e) {
    state.decisionError = (e as Error).message;
  } finally {
    state.decisionLoading = false;
  }
  render();
}

async function handleLoadApiKeys(): Promise<void> {
  const input = document.getElementById("api-keys-token") as HTMLInputElement | null;
  const apiKey = input?.value.trim() ?? "";
  if (!apiKey) {
    showToast("Enter an API key to load keys.", "err");
    return;
  }
  state.apiKeysLoading = true;
  state.apiKeysError = null;
  state.newApiKey = null;
  render();
  try {
    const res = await listApiKeys(apiKey);
    state.apiKeys = res.keys;
  } catch (e) {
    state.apiKeysError = (e as Error).message;
  } finally {
    state.apiKeysLoading = false;
  }
  render();
}

async function handleRevokeApiKey(_keyId: string): Promise<void> {
  showToast("Revoking requires Ed25519 request signing. Use the API directly from your agent.", "err");
}

function renderAgreementDetail(a: OcpAgreementResponse): string {
  const { renderBadge, shortHash, escapeHtml: esc } = {
    renderBadge: (s: string) => `<span class="badge badge-${esc(s)}">${esc(s)}</span>`,
    shortHash: (h: string | null | undefined) => h ? h.slice(0, 16) + "…" : "—",
    escapeHtml: (str: string | null | undefined) => str == null ? "" : str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),
  };
  return `
    <div class="page-title">Agreement ${esc(a.agreementCode)}</div>
    <div class="page-sub">${renderBadge(a.status)} ${renderBadge(a.mode)}</div>

    <div class="card">
      <div class="card-title">Details</div>
      <table>
        <tbody>
          <tr><td>Proposal ID</td><td><code class="hash">${esc(a.proposalId)}</code></td></tr>
          <tr><td>Agreement Code</td><td><code>${esc(a.agreementCode)}</code></td></tr>
          <tr><td>Terms Hash</td><td><code class="hash">${shortHash(a.termsHash)}</code></td></tr>
          <tr><td>Party A</td><td><code class="hash">${shortHash(a.partyAAgentId)}</code></td></tr>
          <tr><td>Party B</td><td><code class="hash">${shortHash(a.partyBAgentId)}</code></td></tr>
          <tr><td>Mode</td><td>${renderBadge(a.mode)}</td></tr>
          <tr><td>Status</td><td>${renderBadge(a.status)}</td></tr>
          <tr><td>Created</td><td>${new Date(a.createdAt).toLocaleString()}</td></tr>
          <tr><td>Expires</td><td>${new Date(a.expiresAt).toLocaleString()}</td></tr>
          ${a.sealedAt ? `<tr><td>Sealed</td><td>${new Date(a.sealedAt).toLocaleString()}</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    ${a.receipt ? `
    <div class="card">
      <div class="card-title">Receipt</div>
      <table>
        <tbody>
          <tr><td>Mint address</td><td><code class="hash">${esc(a.receipt.mintAddress ?? "—")}</code></td></tr>
          <tr><td>Tx sig</td><td><code class="hash">${shortHash(a.receipt.txSig)}</code></td></tr>
          <tr><td>Metadata URI</td><td><code class="hash">${esc(a.receipt.metadataUri ?? "—")}</code></td></tr>
          <tr><td>Mint status</td><td>${renderBadge(a.receipt.mintStatus)}</td></tr>
        </tbody>
      </table>
    </div>
    ` : ""}

    ${a.mode === "public" && a.canonicalTerms ? `
    <div class="card">
      <div class="card-title">Canonical Terms</div>
      <pre style="font-size:11px; color:var(--muted); overflow-x:auto; white-space:pre-wrap;">${esc(JSON.stringify(a.canonicalTerms, null, 2))}</pre>
    </div>
    ` : ""}
  `;
}

// ---- Click handler ----

function onClick(event: Event): void {
  const target = event.target as HTMLElement;

  const link = target.closest("[data-link='true']") as HTMLElement | null;
  if (link) {
    event.preventDefault();
    const routeName = link.dataset.route as OcpRoute["name"] | undefined;
    if (routeName) navigate({ name: routeName } as OcpRoute);
    return;
  }

  const actionTarget = target.closest("[data-action]") as HTMLElement | null;
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;

  if (action === "load-pending") {
    void handleLoadPending();
  } else if (action === "load-records") {
    void handleLoadRecords();
  } else if (action === "accept-agreement") {
    const id = actionTarget.dataset.id ?? "";
    void handleAcceptAgreement(id);
  } else if (action === "submit-accept") {
    void handleSubmitAccept();
  } else if (action === "view-agreement") {
    const id = actionTarget.dataset.id ?? "";
    void handleViewAgreement(id);
  } else if (action === "load-api-keys") {
    void handleLoadApiKeys();
  } else if (action === "revoke-api-key") {
    const id = actionTarget.dataset.id ?? "";
    void handleRevokeApiKey(id);
  } else if (action === "nav-docs") {
    navigate({ name: "docs" });
  } else if (action === "add-obligation") {
    addObligationRow();
  } else if (action === "add-consideration") {
    addConsiderationRow();
  } else if (action?.startsWith("tab-")) {
    const tabId = action.replace("tab-", "");
    switchTab(tabId);
  }
}

function addObligationRow(): void {
  const container = document.getElementById("obligations-container");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "obligation-row";
  div.style.cssText = "margin-bottom:0.75rem; padding:0.75rem; border:1px solid var(--border); border-radius:4px;";
  div.innerHTML = `
    <div class="field"><label>Actor Agent ID</label><input type="text" name="obligation_actor[]" /></div>
    <div class="field"><label>Action</label><input type="text" name="obligation_action[]" /></div>
    <div class="field"><label>Deliverable</label><input type="text" name="obligation_deliverable[]" /></div>
    <div class="field"><label>Conditions (optional)</label><input type="text" name="obligation_conditions[]" /></div>
  `;
  container.appendChild(div);
}

function addConsiderationRow(): void {
  const container = document.getElementById("consideration-container");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "consideration-row";
  div.style.cssText = "margin-bottom:0.75rem; padding:0.75rem; border:1px solid var(--border); border-radius:4px;";
  div.innerHTML = `
    <div class="field"><label>From Agent ID</label><input type="text" name="consideration_from[]" /></div>
    <div class="field"><label>To Agent ID</label><input type="text" name="consideration_to[]" /></div>
    <div class="field"><label>Item</label><input type="text" name="consideration_item[]" /></div>
    <div style="display:flex;gap:0.5rem;">
      <div class="field" style="flex:1;"><label>Amount (optional)</label><input type="number" name="consideration_amount[]" /></div>
      <div class="field" style="flex:1;"><label>Currency (optional)</label><input type="text" name="consideration_currency[]" /></div>
    </div>
  `;
  container.appendChild(div);
}

function switchTab(tabId: string): void {
  document.querySelectorAll(".section-tab").forEach((t) => t.classList.remove("active"));
  const activeBtn = document.querySelector(`[data-tab="${tabId}"]`);
  if (activeBtn) activeBtn.classList.add("active");

  document.getElementById("tab-by-id")?.style.setProperty("display", tabId === "by-id" ? "block" : "none");
  document.getElementById("tab-by-code")?.style.setProperty("display", tabId === "by-code" ? "block" : "none");
}

// ---- Form submit handler ----

function onSubmit(event: Event): void {
  const form = event.target as HTMLFormElement;
  event.preventDefault();

  if (form.id === "ocp-verify-form") {
    const data = new FormData(form);
    const proposalId = (data.get("proposalId") as string | null)?.trim();
    const agreementCode = (data.get("agreementCode") as string | null)?.trim();

    if (!proposalId && !agreementCode) {
      showToast("Enter a proposal ID or agreement code.", "err");
      return;
    }

    state.verifyResult = null;
    state.verifyError = null;

    const lookup = proposalId || agreementCode!;
    verifyAgreement(lookup).then((result) => {
      state.verifyResult = result;
      state.verifyError = null;
      render();
    }).catch((e: Error) => {
      state.verifyResult = null;
      state.verifyError = e.message;
      render();
    });
    return;
  }

  if (form.id === "ocp-decision-lookup-form") {
    const data = new FormData(form);
    const id = (data.get("decisionId") as string | null)?.trim();
    if (!id) { showToast("Enter a draft ID or decision code.", "err"); return; }
    void handleLoadDecision(id);
    return;
  }

  if (form.id === "ocp-create-api-key-form") {
    showToast("API key creation requires a signed request — integrate with your agent's signing logic.", "err");
    return;
  }

  if (form.id === "ocp-register-form" || form.id === "ocp-propose-form") {
    showToast("Signing not implemented in browser UI — integrate with your agent's signing logic.", "err");
    return;
  }
}

// ---- Popstate ----

window.addEventListener("popstate", () => {
  state.route = parseOcpRoute(window.location.pathname);
  render();
});

// ---- Init ----

document.addEventListener("click", onClick);
document.addEventListener("submit", onSubmit);

render();
