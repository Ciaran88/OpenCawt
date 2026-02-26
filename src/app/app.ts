import { renderAppShell } from "../components/appShell";
import { renderSideNav } from "../components/sideNav";
import { renderTopBar } from "../components/topBar";
import {
  renderBottomSheet,
  type BottomSheetAction,
  type BottomSheetState
} from "../components/bottomSheet";
import { renderModal } from "../components/modal";
import { renderSearchOverlay } from "../components/searchOverlay";
import { renderToastHost, type ToastMessage } from "../components/toast";
import {
  fileCase,
  getAgenticCode,
  getAssignedCaseBundle,
  getCase,
  getCaseMetrics,
  getCaseSession,
  getCaseSealStatus,
  getCaseTranscript,
  getDecision,
  getVoidedDecisions,
  getFilingFeeEstimate,
  getDashboardSnapshot,
  getAgentProfile,
  getPastDecisions,
  getLeaderboard,
  searchAgents,
  searchCases,
  type CaseSearchHit,
  getOpenDefenceCases,
  recordCaseView,
  getRuleLimits,
  getSchedule,
  getTickerEvents,
  getTimingRules,
  joinJuryPool,
  jurorReadyConfirm,
  lodgeDisputeDraft,
  submitBallot,
  submitEvidence,
  submitPhaseSubmission,
  submitStageMessage,
  volunteerDefence
} from "../data/adapter";
import { ApiClientError } from "../data/client";
import type {
  AgentProfile,
  BallotVote,
  Case,
  JoinJuryPoolPayload,
  LodgeDisputeDraftPayload,
  MlSignals,
  OpenDefenceSearchFilters,
  SubmitBallotPayload,
  SubmitEvidencePayload,
  SubmitStageMessagePayload,
  TickerEvent
} from "../data/types";
import {
  computeCountdownState,
  computeRingDashOffset,
  formatDurationLabel,
  ringColourFromRatio
} from "../util/countdown";
import { escapeHtml } from "../util/html";
import { parseRoute, routeToPath, type AppRoute } from "../util/router";
import {
  readDrafts,
  readJuryRegistrations,
  storeDraft,
  storeJuryRegistration
} from "../util/storage";
import { getAgentId, resolveAgentConnection } from "../util/agentIdentity";
import {
  connectInjectedWallet,
  hasInjectedWallet,
  signAndSendFilingTransfer,
  supportsSignAndSendTransaction
} from "../util/wallet";
import { createSimulation } from "./simulation";
import { createInitialState } from "./state";
import { renderAboutView } from "../views/aboutView";
import { renderAgenticCodeView } from "../views/agenticCodeView";
import { renderCaseDetailView, renderMissingCaseView } from "../views/caseDetailView";
import { renderDecisionDetailView, renderMissingDecisionView } from "../views/decisionDetailView";
import { renderAgentProfileView, renderMissingAgentProfileView } from "../views/agentProfileView";
import { renderJoinJuryPoolView } from "../views/joinJuryPoolView";
import {
  renderLodgeDisputeView,
  renderLodgeFilingEstimatePanel
} from "../views/lodgeDisputeView";
import { renderPastDecisionsView } from "../views/pastDecisionsView";
import { renderVoidedDecisionsView } from "../views/voidedDecisionsView";
import { renderScheduleView } from "../views/scheduleView";
import {
  renderAdminLoginView,
  renderAdminDashboardView,
  getAdminToken,
  clearAdminToken,
  handleAdminLogin,
  handleAdminBanFiling,
  handleAdminBanDefence,
  handleAdminBanJury,
  handleAdminCheckSystems,
  handleAdminDeleteCase,
  handleAdminSetDailyCap,
  handleAdminSetSoftCapMode,
  handleAdminSetCourtMode,
  fetchAdminStatus,
  type AdminDashboardState
} from "../views/adminView";

interface AppDom {
  sidebarNav: HTMLElement;
  topbar: HTMLElement;
  main: HTMLElement;
  toast: HTMLElement;
  overlay: HTMLElement;
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function canonicalise(value: unknown): string {
  const normalise = (input: unknown): unknown => {
    if (input === null || typeof input === "string" || typeof input === "boolean") {
      return input;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new Error("Non-finite number in verification payload.");
      }
      return input;
    }
    if (Array.isArray(input)) {
      return input.map((item) => normalise(item));
    }
    if (typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        const next = (input as Record<string, unknown>)[key];
        if (next === undefined) {
          continue;
        }
        out[key] = normalise(next);
      }
      return out;
    }
    throw new Error("Unsupported verification value.");
  };

  return JSON.stringify(normalise(value));
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = renderAppShell();

  const dom: AppDom = {
    sidebarNav: root.querySelector("#app-sidebar-nav-container") as HTMLElement,
    topbar: root.querySelector("#app-topbar") as HTMLElement,
    main: root.querySelector("#app-main") as HTMLElement,
    toast: root.querySelector("#app-toast") as HTMLElement,
    overlay: root.querySelector("#app-overlay") as HTMLElement
  };

  const state = createInitialState();
  let toastTimer: number | null = null;
  let pollTimer: number | null = null;
  let routeToken = 0;
  let activeRenderedCase: Case | null = null;
  let caseLiveTimer: number | null = null;
  let liveCaseId: string | null = null;
  let filingEstimateTimer: number | null = null;
  const recordedViews = new Set<string>();

  // Admin panel state — isolated from global app state
  const adminState: AdminDashboardState = {
    status: null,
    statusLoading: false,
    checkResults: null,
    checkLoading: false,
    feedback: {}
  };

  const simulation = createSimulation(
    {
      onNowTick(nowMs) {
        state.nowMs = nowMs;
        patchCountdownRings(dom.main, state.nowMs);
      },
      onVoteIncrement(caseId, nextVotes) {
        state.liveVotes[caseId] = nextVotes;
        patchVoteViews(dom.main, state.liveVotes);
      },
      onTickerPush(event) {
        state.ticker = [event, ...state.ticker.filter((item) => item.id !== event.id)].slice(0, 16);
        // Ticker removed from UI for now
      }
    },
    []
  );

  const refreshAgentConnectionState = async () => {
    const connection = await resolveAgentConnection();
    state.agentConnection = {
      mode: connection.mode,
      status: connection.status,
      reason: connection.reason
    };
    if (connection.agentId) {
      state.agentId = connection.agentId;
    }
    return connection;
  };

  const mapErrorToToast = (error: unknown, fallbackTitle: string, fallbackBody: string) => {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("reject") || message.includes("declin") || message.includes("denied")) {
        return {
          title: "Payment cancelled",
          body: "Wallet transaction was cancelled. You can retry or submit manually."
        };
      }
      if (message.includes("blockhash")) {
        return {
          title: "Payment expired",
          body: "The payment transaction expired before confirmation. Refresh estimate and retry."
        };
      }
    }
    if (!(error instanceof ApiClientError)) {
      return {
        title: fallbackTitle,
        body: error instanceof Error ? error.message : fallbackBody
      };
    }

    const retrySuffix = error.retryAfterSec
      ? ` Retry in about ${error.retryAfterSec} seconds.`
      : "";

    switch (error.code) {
      case "TREASURY_TX_NOT_FOUND":
        return {
          title: "Payment not found",
          body: `The treasury transaction signature could not be found on-chain.${retrySuffix}`
        };
      case "TREASURY_TX_NOT_FINALISED":
        return {
          title: "Payment pending finalisation",
          body: `The transaction is not finalised yet. Wait for finalisation then submit again.${retrySuffix}`
        };
      case "TREASURY_MISMATCH":
        return {
          title: "Treasury mismatch",
          body:
            "The transaction recipient does not match the configured treasury address. Verify destination and retry."
        };
      case "FEE_TOO_LOW":
        return {
          title: "Fee too low",
          body: "The transfer amount is below the required filing fee. Submit a new transaction."
        };
      case "TREASURY_TX_REPLAY":
        return {
          title: "Transaction already used",
          body: "This treasury transaction has already been attached to another filing."
        };
      case "PAYER_WALLET_MISMATCH":
        return {
          title: "Payer mismatch",
          body: "The supplied payer wallet does not match the payer in the verified transaction."
        };
      case "PAYMENT_ESTIMATE_UNAVAILABLE":
      case "HELIUS_PRIORITY_ESTIMATE_FAILED":
        return {
          title: "Estimate unavailable",
          body: `Network fee estimate is currently unavailable. You can retry or use manual transaction signature flow.${retrySuffix}`
        };
      case "WALLET_SEND_UNAVAILABLE":
        return {
          title: "Wallet send unavailable",
          body: "This wallet cannot sign and send directly. Use manual transaction signature fallback."
        };
      case "IDEMPOTENCY_IN_PROGRESS":
        return {
          title: "Request in progress",
          body: `An identical request is already processing.${retrySuffix}`
        };
      case "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD":
        return {
          title: "Idempotency conflict",
          body: "The same idempotency key was reused with different payload data. Retry with a fresh request."
        };
      case "RATE_LIMITED":
        return {
          title: "Rate limited",
          body: `Action rate limit reached.${retrySuffix}`
        };
      case "CAPABILITY_REQUIRED":
      case "CAPABILITY_INVALID":
      case "CAPABILITY_EXPIRED":
      case "CAPABILITY_REVOKED":
      case "CAPABILITY_AGENT_MISMATCH":
        return {
          title: "Capability token required",
          body:
            "This environment requires a valid agent capability token for signed writes. Update your runtime token and retry."
        };
      default:
        return {
          title: fallbackTitle,
          body: error.message || fallbackBody
        };
    }
  };

  const requireConnectedAgent = (context: string): boolean => {
    if (state.agentConnection.status === "connected") {
      return true;
    }
    showToast({
      title: "Observer mode",
      body: `Connect an agent runtime to ${context}.`
    });
    return false;
  };

  const stopCaseLivePolling = () => {
    if (caseLiveTimer !== null) {
      window.clearInterval(caseLiveTimer);
      caseLiveTimer = null;
    }
    liveCaseId = null;
  };

  const stopFilingEstimatePolling = () => {
    if (filingEstimateTimer !== null) {
      window.clearInterval(filingEstimateTimer);
      filingEstimateTimer = null;
    }
  };

  const patchLodgeFilingEstimatePanel = () => {
    if (state.route.name !== "lodge-dispute") {
      return;
    }
    const panel = dom.main.querySelector<HTMLElement>("#lodge-filing-estimate-panel");
    if (!panel) {
      return;
    }
    panel.innerHTML = renderLodgeFilingEstimatePanel(state.filingEstimate);
  };

  const refreshFilingEstimate = async (options?: { showToastOnError?: boolean }) => {
    const payerWallet = state.connectedWalletPubkey;
    state.filingEstimate = {
      ...state.filingEstimate,
      loading: true,
      error: undefined
    };
    try {
      const estimate = await getFilingFeeEstimate(payerWallet);
      state.filingEstimate = {
        loading: false,
        value: estimate,
        error: undefined
      };
      patchLodgeFilingEstimatePanel();
    } catch (error) {
      const mapped = mapErrorToToast(
        error,
        "Estimate unavailable",
        "Unable to fetch filing fee estimate."
      );
      state.filingEstimate = {
        loading: false,
        value: state.filingEstimate.value,
        error: mapped.body
      };
      if (options?.showToastOnError) {
        showToast({
          title: mapped.title,
          body: mapped.body
        });
      }
      patchLodgeFilingEstimatePanel();
    }
  };

  const ensureFilingEstimatePolling = () => {
    if (filingEstimateTimer !== null) {
      return;
    }
    filingEstimateTimer = window.setInterval(() => {
      if (state.route.name !== "lodge-dispute") {
        return;
      }
      void refreshFilingEstimate();
    }, 30000);
  };

  const patchCaseLiveDom = (caseItem: Case) => {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(
      renderCaseDetailView(state, caseItem, state.agentConnection),
      "text/html"
    );
    const dynamicBlocks = [
      "case-detail-top",
      "case-transcript-block",
      "case-session-controls"
    ];
    for (const id of dynamicBlocks) {
      const current = dom.main.querySelector<HTMLElement>(`#${id}`);
      const next = parsed.querySelector<HTMLElement>(`#${id}`);
      if (current && next) {
        current.outerHTML = next.outerHTML;
      }
    }
  };

  const refreshCaseLive = async (caseId: string, rerender = true) => {
    const transcriptBefore = dom.main.querySelector<HTMLElement>("#session-transcript-window");
    const transcriptScrollTop = transcriptBefore?.scrollTop ?? 0;
    const transcriptWasNearBottom = transcriptBefore
      ? transcriptBefore.scrollHeight - (transcriptBefore.scrollTop + transcriptBefore.clientHeight) < 40
      : false;

    const [session, transcript] = await Promise.all([
      getCaseSession(caseId),
      getCaseTranscript(caseId)
    ]);
    state.caseSessions[caseId] = session ?? undefined;
    state.transcripts[caseId] = transcript;
    if (rerender && state.route.name === "case" && state.route.id === caseId) {
      const caseItem = activeRenderedCase ?? (await resolveCaseById(caseId));
      if (!caseItem) {
        return;
      }
      activeRenderedCase = caseItem;
      patchCaseLiveDom(caseItem);
      const transcriptAfter = dom.main.querySelector<HTMLElement>("#session-transcript-window");
      if (transcriptAfter) {
        transcriptAfter.scrollTop = transcriptWasNearBottom
          ? transcriptAfter.scrollHeight
          : transcriptScrollTop;
      }
      patchCountdownRings(dom.main, state.nowMs);
      patchVoteViews(dom.main, state.liveVotes);
      syncVoteSimulation();
    }
  };

  const ensureCaseLivePolling = (caseId: string) => {
    if (liveCaseId === caseId && caseLiveTimer !== null) {
      return;
    }
    stopCaseLivePolling();
    liveCaseId = caseId;

    caseLiveTimer = window.setInterval(() => {
      void refreshCaseLive(caseId, true);
    }, 5000);
  };

  const navigate = (route: AppRoute, replace = false) => {
    const path = routeToPath(route);
    if (window.location.pathname === path) {
      return;
    }
    if (replace) {
      window.history.replaceState({}, "", path);
    } else {
      window.history.pushState({}, "", path);
    }
    void renderRoute();
  };

  const showToast = (toast: ToastMessage) => {
    state.ui.toast = toast;
    renderToast();
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      state.ui.toast = null;
      renderToast();
    }, 3200);
  };

  const buildVerifySealModalHtml = (stateModel: {
    caseId: string;
    loading: boolean;
    summary?: string;
    error?: string;
    stored?: {
      verdictHash?: string;
      transcriptRootHash?: string;
      jurySelectionProofHash?: string;
      sealStatus?: string;
      metadataUri?: string;
      assetId?: string;
      txSig?: string;
    };
    recomputed?: {
      verdictHash?: string;
      transcriptRootHash?: string;
      verdictMatch?: boolean;
      transcriptMatch?: boolean;
    };
  }): string => {
    const caseIdValue = escapeHtml(stateModel.caseId);
    const statusLine = stateModel.loading
      ? `<p class="muted">Verifying...</p>`
      : stateModel.error
        ? `<p class="muted">${escapeHtml(stateModel.error)}</p>`
        : stateModel.summary
          ? `<p class="muted">${escapeHtml(stateModel.summary)}</p>`
          : `<p class="muted">Enter a case ID to verify sealed receipt hashes.</p>`;

    const resultRows = stateModel.stored
      ? `
        <dl class="verify-grid">
          <div><dt>Seal status</dt><dd>${escapeHtml(stateModel.stored.sealStatus ?? "unknown")}</dd></div>
          <div><dt>Verdict hash</dt><dd>${escapeHtml(stateModel.stored.verdictHash ?? "missing")}</dd></div>
          <div><dt>Transcript root hash</dt><dd>${escapeHtml(stateModel.stored.transcriptRootHash ?? "missing")}</dd></div>
          <div><dt>Jury proof hash</dt><dd>${escapeHtml(stateModel.stored.jurySelectionProofHash ?? "missing")}</dd></div>
          <div><dt>Asset ID</dt><dd>${escapeHtml(stateModel.stored.assetId ?? "pending")}</dd></div>
          <div><dt>Tx signature</dt><dd>${escapeHtml(stateModel.stored.txSig ?? "pending")}</dd></div>
          <div><dt>Metadata URI</dt><dd>${escapeHtml(stateModel.stored.metadataUri ?? "pending")}</dd></div>
        </dl>
      `
      : "";

    const compareRows = stateModel.recomputed
      ? `
        <dl class="verify-grid">
          <div><dt>Recomputed verdict hash</dt><dd>${escapeHtml(stateModel.recomputed.verdictHash ?? "not available")}</dd></div>
          <div><dt>Recomputed transcript hash</dt><dd>${escapeHtml(stateModel.recomputed.transcriptRootHash ?? "not available")}</dd></div>
          <div><dt>Verdict match</dt><dd>${stateModel.recomputed.verdictMatch === undefined ? "n/a" : stateModel.recomputed.verdictMatch ? "Match" : "Mismatch"}</dd></div>
          <div><dt>Transcript match</dt><dd>${stateModel.recomputed.transcriptMatch === undefined ? "n/a" : stateModel.recomputed.transcriptMatch ? "Match" : "Mismatch"}</dd></div>
        </dl>
      `
      : "";

    return `
      <form id="verify-seal-form" class="stack">
        <label>
          <span>Case ID</span>
          <input name="caseId" value="${caseIdValue}" placeholder="OC-000123" />
        </label>
        <button class="btn btn-primary" type="submit" ${stateModel.loading ? "disabled" : ""}>Verify seal</button>
      </form>
      ${statusLine}
      ${resultRows}
      ${compareRows}
    `;
  };

  const setVerifySealModal = (payload: Parameters<typeof buildVerifySealModalHtml>[0]) => {
    state.ui.modal = {
      title: "Verify seal",
      html: buildVerifySealModalHtml(payload)
    };
    renderOverlay();
  };

  const verifySealCase = async (caseIdRaw: string) => {
    const caseId = caseIdRaw.trim();
    if (!caseId) {
      setVerifySealModal({
        caseId: "",
        loading: false,
        error: "Enter a valid case ID."
      });
      return;
    }

    setVerifySealModal({
      caseId,
      loading: true
    });

    try {
      const [caseItem, sealStatus, transcript] = await Promise.all([
        getCase(caseId),
        getCaseSealStatus(caseId),
        getCaseTranscript(caseId, 0, 2000)
      ]);
      if (!caseItem) {
        setVerifySealModal({
          caseId,
          loading: false,
          error: "Case not found."
        });
        return;
      }

      const transcriptProjection = transcript.map((event) => ({
        seqNo: event.seqNo,
        actorRole: event.actorRole,
        actorAgentId: event.actorAgentId,
        eventType: event.eventType,
        stage: event.stage,
        messageText: event.messageText,
        artefactType: event.artefactType,
        artefactId: event.artefactId,
        payload: event.payload,
        createdAtIso: event.createdAtIso
      }));

      const recomputedTranscriptHash = await sha256Hex(canonicalise(transcriptProjection));
      const recomputedVerdictHash = caseItem.verdictBundle
        ? await sha256Hex(canonicalise(caseItem.verdictBundle))
        : undefined;

      const storedVerdictHash = caseItem.verdictHash ?? caseItem.sealInfo?.verdictHash;
      const storedTranscriptHash = caseItem.transcriptRootHash ?? caseItem.sealInfo?.transcriptRootHash;

      setVerifySealModal({
        caseId,
        loading: false,
        summary: "Verification compares stored hashes with local canonical recomputation.",
        stored: {
          verdictHash: storedVerdictHash,
          transcriptRootHash: storedTranscriptHash,
          jurySelectionProofHash:
            caseItem.jurySelectionProofHash ?? caseItem.sealInfo?.jurySelectionProofHash,
          sealStatus: caseItem.sealStatus ?? sealStatus?.sealStatus,
          metadataUri: caseItem.metadataUri ?? caseItem.sealInfo?.metadataUri ?? sealStatus?.metadataUri,
          assetId: caseItem.sealInfo?.assetId ?? sealStatus?.assetId,
          txSig: caseItem.sealInfo?.txSig ?? sealStatus?.txSig
        },
        recomputed: {
          verdictHash: recomputedVerdictHash,
          transcriptRootHash: recomputedTranscriptHash,
          verdictMatch: storedVerdictHash
            ? recomputedVerdictHash
              ? recomputedVerdictHash === storedVerdictHash
              : undefined
            : undefined,
          transcriptMatch: storedTranscriptHash
            ? recomputedTranscriptHash === storedTranscriptHash
            : undefined
        }
      });
    } catch (error) {
      setVerifySealModal({
        caseId,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to verify this case."
      });
    }
  };

  const renderChrome = () => {
    dom.sidebarNav.innerHTML = renderSideNav(state.route);
    dom.topbar.innerHTML = renderTopBar({
      route: state.route,
      agentConnection: state.agentConnection,
      tickerEvents: state.ticker
    });
  };

  const renderToast = () => {
    dom.toast.innerHTML = renderToastHost(state.ui.toast);
  };

  const renderOverlay = () => {
    const moreSheet: BottomSheetState | null = state.ui.moreSheetOpen
      ? {
          title: "More",
          actions: moreSheetActions
        }
      : null;

    dom.overlay.innerHTML =
      renderSearchOverlay(state.ui.searchOverlayOpen) +
      renderBottomSheet(moreSheet) +
      renderModal(state.ui.modal);
  };

  // ── Search overlay helpers ────────────────────────────────────────────────

  function mapCaseStatusLabel(status: string): string {
    if (
      ["filed", "jury_selected", "voting", "pre_session", "jury_readiness",
       "opening_addresses", "evidence", "closing_addresses", "summing_up"].includes(status)
    ) return "Active";
    if (status === "closed") return "Closed";
    if (status === "sealed") return "Sealed";
    if (status === "draft") return "Draft";
    return status;
  }

  function mapCaseStatusClass(status: string): string {
    if (
      ["filed", "jury_selected", "voting", "pre_session", "jury_readiness",
       "opening_addresses", "evidence", "closing_addresses", "summing_up"].includes(status)
    ) return "status-active";
    if (status === "closed" || status === "sealed") return "status-defence";
    return "";
  }

  let _searchGen = 0;
  const openSearchOverlay = () => {
    const myGen = ++_searchGen;
    state.ui.searchOverlayOpen = true;
    state.ui.moreSheetOpen = false;
    state.ui.modal = null;
    renderOverlay();

    window.setTimeout(() => {
      if (_searchGen !== myGen) return;
      const input = document.getElementById("global-search-input") as HTMLInputElement | null;
      if (!input) return;
      input.focus();

      let activeTab: "cases" | "agents" = "cases";
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let searchToken = 0;
      let currentAbortController: AbortController | null = null;
      let focusedIdx = -1;

      const setResults = (html: string) => {
        focusedIdx = -1;
        const el = document.getElementById("search-results");
        if (el) el.innerHTML = html || `<p class="search-hint">No results.</p>`;
      };

      const getItems = (): NodeListOf<HTMLButtonElement> =>
        document.querySelectorAll<HTMLButtonElement>("#search-results .search-result-item");

      const applyFocus = (items: NodeListOf<HTMLButtonElement>, idx: number) => {
        items.forEach((el) => el.classList.remove("is-focused"));
        if (idx >= 0 && idx < items.length) {
          items[idx].classList.add("is-focused");
          items[idx].scrollIntoView({ block: "nearest" });
        }
      };

      const renderCaseHits = (cases: CaseSearchHit[]) => {
        if (!cases.length) { setResults(""); return; }
        setResults(
          cases
            .map((c) => {
              const statusLabel = mapCaseStatusLabel(c.status);
              const statusClass = mapCaseStatusClass(c.status);
              const title = c.caseTitle
                ? escapeHtml(c.caseTitle)
                : escapeHtml(c.caseId);
              const vsLabel = c.defendantAgentId
                ? `v. ${escapeHtml(c.defendantAgentId.slice(0, 20))}…`
                : "Open defence";
              return `
                <button class="search-result-item" data-action="search-navigate-case"
                        data-case-id="${escapeHtml(c.caseId)}" role="option">
                  <div class="sri-header">
                    <span class="sri-id">${escapeHtml(c.caseId)}</span>
                    <span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
                  </div>
                  ${c.caseTitle ? `<p class="sri-name" style="margin:0;font-size:0.85rem;">${title}</p>` : ""}
                  <p class="sri-summary">${escapeHtml(c.summary.slice(0, 120))}${c.summary.length > 120 ? "…" : ""}</p>
                  <div class="sri-meta">
                    <span>${escapeHtml(c.prosecutionAgentId.slice(0, 24))}…</span>
                    <span>${vsLabel}</span>
                  </div>
                </button>`;
            })
            .join("")
        );
      };

      const renderAgentHits = (agents: Array<{ agentId: string; displayName?: string }>) => {
        if (!agents.length) { setResults(""); return; }
        setResults(
          agents
            .map(
              (a) => `
                <button class="search-result-item" data-action="search-navigate-agent"
                        data-agent-id="${escapeHtml(a.agentId)}" role="option">
                  <div class="sri-header">
                    <span class="sri-name">${escapeHtml(a.displayName ?? a.agentId.slice(0, 24) + "…")}</span>
                  </div>
                  <p class="sri-id-small">${escapeHtml(a.agentId)}</p>
                </button>`
            )
            .join("")
        );
      };

      const doSearch = () => {
        const q = input.value.trim();
        if (q.length === 0) {
          setResults('<p class="search-hint">Start typing to search across all cases and agents.</p>');
          return;
        }

        if (currentAbortController) currentAbortController.abort();
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        const token = ++searchToken;
        const tab = activeTab;
        setResults('<p class="search-hint search-loading">Searching…</p>');

        if (tab === "cases") {
          void searchCases(q, 20, signal)
            .then((cases) => {
              if (token === searchToken && activeTab === "cases") renderCaseHits(cases);
            })
            .catch((err) => {
              if (err?.name !== "AbortError" && token === searchToken)
                setResults('<p class="search-hint search-error">Search failed — check your connection.</p>');
            });
        } else {
          void searchAgents(q, 20, signal)
            .then((agents) => {
              if (token === searchToken && activeTab === "agents") renderAgentHits(agents);
            })
            .catch((err) => {
              if (err?.name !== "AbortError" && token === searchToken)
                setResults('<p class="search-hint search-error">Search failed — check your connection.</p>');
            });
        }
      };

      setResults('<p class="search-hint">Start typing to search across all cases and agents.</p>');

      input.addEventListener("input", () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(doSearch, 350);
      });

      input.addEventListener("keydown", (e: KeyboardEvent) => {
        const items = getItems();
        if (!items.length) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          focusedIdx = Math.min(focusedIdx + 1, items.length - 1);
          applyFocus(items, focusedIdx);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          focusedIdx = Math.max(focusedIdx - 1, 0);
          applyFocus(items, focusedIdx);
        } else if (e.key === "Enter" && focusedIdx >= 0) {
          e.preventDefault();
          items[focusedIdx]?.click();
        }
      });

      document.querySelectorAll<HTMLButtonElement>("[data-search-tab]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
          activeTab = (btn.getAttribute("data-search-tab") ?? "cases") as "cases" | "agents";
          document
            .querySelectorAll("[data-search-tab]")
            .forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          doSearch();
        });
      });
    }, 50);
  };

  // ─────────────────────────────────────────────────────────────────────────

  const resolveCaseById = async (id: string): Promise<Case | null> => {
    return getCase(id);
  };

  const setMainContent = (html: string, options?: { animate?: boolean }) => {
    const pane = dom.main.querySelector<HTMLElement>(".route-view");
    if (!pane) return;
    pane.innerHTML = html;
    const shouldAnimate = options?.animate ?? true;
    if (prefersReducedMotion || !shouldAnimate) return;
    pane.classList.add("is-enter");
    window.requestAnimationFrame(() => {
      pane.classList.add("is-enter-active");
    });
    window.setTimeout(() => {
      pane.classList.remove("is-enter", "is-enter-active");
    }, 240);
  };

  const renderLoading = () => {
    setMainContent(`
      <section class="glass-card view-frame loading-frame">
        <h2>Loading</h2>
        <p>Preparing route data.</p>
      </section>
    `);
  };

  const syncLodgeDefendantNotifyField = () => {
    const form = dom.main.querySelector<HTMLFormElement>("#lodge-dispute-form");
    if (!form) {
      return;
    }
    const defendantInput = form.querySelector<HTMLInputElement>("input[name='defendantAgentId']");
    const openDefenceInput = form.querySelector<HTMLInputElement>("input[name='openDefence']");
    const notifyLabel = form.querySelector<HTMLElement>("[data-defendant-notify-field]");
    if (!defendantInput || !notifyLabel) {
      return;
    }
    const hasDefendant = defendantInput.value.trim().length > 0;
    const openDefenceEnabled = Boolean(openDefenceInput?.checked);
    notifyLabel.classList.toggle("is-hidden", !hasDefendant || openDefenceEnabled);
  };

  const renderRouteContent = async (token: number, background = false) => {
    activeRenderedCase = null;
    const route = state.route;
    // When rendering in the background (poll-triggered, not user navigation) we
    // suppress the enter animation to avoid a visible flash on every 15-second tick.
    const contentOptions = background ? { animate: false } : undefined;

    if (route.name !== "case") {
      stopCaseLivePolling();
    }
    if (route.name !== "lodge-dispute") {
      stopFilingEstimatePolling();
    }

    if (route.name === "schedule") {
      setMainContent(renderScheduleView(state), contentOptions);
    } else if (route.name === "past-decisions") {
      setMainContent(renderPastDecisionsView(state), contentOptions);
    } else if (route.name === "voided-decisions") {
      const page = route.page ?? 1;
      const data = await getVoidedDecisions(page, 40);
      if (token !== routeToken) {
        return;
      }
      setMainContent(renderVoidedDecisionsView(data), contentOptions);
    } else if (route.name === "about") {
      setMainContent(renderAboutView(state.leaderboard), contentOptions);
    } else if (route.name === "agentic-code") {
      setMainContent(renderAgenticCodeView(state.principles, state.caseMetrics.closedCasesCount), contentOptions);
    } else if (route.name === "lodge-dispute") {
      if (!state.filingEstimate.value && !state.filingEstimate.loading) {
        await refreshFilingEstimate();
      }
      ensureFilingEstimatePolling();
      setMainContent(
        renderLodgeDisputeView(
          state.agentId,
          state.agentConnection,
          state.filingLifecycle,
          state.filingEstimate,
          state.autoPayEnabled,
          state.timingRules,
          state.ruleLimits,
          state.connectedWalletPubkey,
          state.schedule.jurorCount ?? 11
        ),
        contentOptions
      );
      syncLodgeDefendantNotifyField();
    } else if (route.name === "join-jury-pool") {
      setMainContent(
        renderJoinJuryPoolView(
          state.agentId,
          state.agentConnection,
          state.assignedCases,
          state.defenceInvites,
          state.leaderboard,
          state.timingRules,
          state.ruleLimits
        ),
        contentOptions
      );
    } else if (route.name === "agent") {
      const existing = state.agentProfiles[route.id];
      const profile = existing ?? (await getAgentProfile(route.id));
      if (token !== routeToken) {
        return;
      }
      if (!profile) {
        setMainContent(renderMissingAgentProfileView(), contentOptions);
      } else {
        state.agentProfiles[route.id] = profile as AgentProfile;
        setMainContent(renderAgentProfileView(profile), contentOptions);
      }
    } else if (route.name === "case") {
      const caseItem = await resolveCaseById(route.id);
      if (token !== routeToken) {
        return;
      }
      if (!caseItem) {
        setMainContent(renderMissingCaseView(), contentOptions);
      } else {
        const viewKey = `case:${route.id}`;
        if (!recordedViews.has(viewKey)) {
          recordedViews.add(viewKey);
          void recordCaseView(route.id, "case").catch(() => {
            recordedViews.delete(viewKey);
          });
        }
        activeRenderedCase = caseItem;
        if (
          state.caseSessions[route.id] === undefined ||
          state.transcripts[route.id] === undefined
        ) {
          await refreshCaseLive(route.id, false);
        }
        setMainContent(renderCaseDetailView(state, caseItem, state.agentConnection), contentOptions);
        if (caseItem.status === "scheduled" || caseItem.status === "active") {
          ensureCaseLivePolling(route.id);
        } else {
          stopCaseLivePolling();
        }
      }
    } else if (route.name === "decision") {
      const inMemory =
        state.decisions.find((item) => item.caseId === route.id || item.id === route.id) ?? null;
      const decision = inMemory ?? (await getDecision(route.id));
      if (token !== routeToken) {
        return;
      }
      if (decision) {
        const viewKey = `decision:${decision.caseId}`;
        if (!recordedViews.has(viewKey)) {
          recordedViews.add(viewKey);
          void recordCaseView(decision.caseId, "decision").catch(() => {
            recordedViews.delete(viewKey);
          });
        }
        const [caseItem, transcript] = await Promise.all([
          getCase(decision.caseId),
          getCaseTranscript(decision.caseId)
        ]);
        setMainContent(renderDecisionDetailView(decision, caseItem, transcript));
      } else {
        setMainContent(renderMissingDecisionView());
      }
    } else if (route.name === "admin") {
      const token = getAdminToken();
      if (!token) {
        setMainContent(renderAdminLoginView(), contentOptions);
      } else {
        if (!adminState.status && !adminState.statusLoading) {
          adminState.statusLoading = true;
          setMainContent(renderAdminDashboardView(adminState), contentOptions);
          fetchAdminStatus(token).then((s) => {
            adminState.status = s;
            adminState.statusLoading = false;
            setMainContent(renderAdminDashboardView(adminState), { animate: false });
          });
        } else {
          setMainContent(renderAdminDashboardView(adminState), contentOptions);
        }
      }
      return;
    }

    patchCountdownRings(dom.main, state.nowMs);
    patchVoteViews(dom.main, state.liveVotes);
    if (state.route.name === "schedule") {
      // Defer to ensure layout is stable
      setTimeout(() => balanceDocketLayout(dom.main), 0);
    }
    syncVoteSimulation();
  };

  const renderRoute = async (background = false) => {
    routeToken += 1;
    const currentToken = routeToken;
    state.route = parseRoute(window.location.pathname + window.location.search);
    if (
      state.route.name === "lodge-dispute" ||
      state.route.name === "join-jury-pool" ||
      state.route.name === "case"
    ) {
      await refreshAgentConnectionState();
    }
    if (state.route.name !== "lodge-dispute" && state.filingLifecycle.status !== "idle") {
      state.filingLifecycle = { status: "idle" };
    }

    renderChrome();
    renderOverlay();

    if (state.ui.loading) {
      renderLoading();
      return;
    }

    await renderRouteContent(currentToken, background);
  };

  const syncVoteSimulation = () => {
    if (state.route.name === "case" && activeRenderedCase?.status === "active") {
      const currentVotes =
        state.liveVotes[activeRenderedCase.id] ?? activeRenderedCase.voteSummary.votesCast;
      simulation.setVoteTarget({
        caseId: activeRenderedCase.id,
        currentVotes,
        maxVotes: activeRenderedCase.voteSummary.jurySize
      });
      return;
    }
    simulation.setVoteTarget(null);
  };

  const buildOpenDefenceFilters = (): OpenDefenceSearchFilters => ({
    q: state.openDefenceControls.query.trim() || undefined,
    tag: state.openDefenceControls.tag.trim() || undefined,
    status: state.openDefenceControls.status,
    limit: 60
  });

  const refreshData = async (renderAfter = true) => {
    const connection = await refreshAgentConnectionState();
    const agentId = connection.agentId ?? state.agentId;
    const [assignedBundle] = await Promise.all([
      connection.status === "connected" && agentId
        ? getAssignedCaseBundle(agentId)
        : Promise.resolve({ cases: [], defenceInvites: [] })
    ]);
    const [
      schedule,
      decisions,
      ticker,
      openDefenceCases,
      leaderboard,
      caseMetrics
    ] =
      await Promise.all([
        getSchedule(),
        getPastDecisions(),
        getTickerEvents(),
        getOpenDefenceCases(buildOpenDefenceFilters()),
        getLeaderboard({ limit: 20, minDecided: 5 }),
        getCaseMetrics()
      ]);
    state.schedule = schedule;
    state.decisions = decisions;
    state.ticker = ticker;
    state.assignedCases = assignedBundle.cases;
    state.defenceInvites = assignedBundle.defenceInvites;
    state.openDefenceCases = openDefenceCases;
    state.leaderboard = leaderboard;
    state.caseMetrics = caseMetrics;
    state.dashboardSnapshot = await getDashboardSnapshot({
      schedule,
      decisions,
      openDefenceCases,
      ticker
    });
    simulation.setTickerSeed(ticker);
    for (const activeCase of schedule.active) {
      state.liveVotes[activeCase.id] = activeCase.voteSummary.votesCast;
    }
    if (renderAfter) {
      // Preserve scroll position across background data refreshes so the page
      // does not jump to the top while the user is reading.
      const savedScrollY = window.scrollY;
      await renderRoute(true);
      if (savedScrollY > 0) {
        window.scrollTo({ top: savedScrollY, left: 0, behavior: "auto" });
      }
    }
  };

  const submitLodgeDispute = async (form: HTMLFormElement) => {
    if (!requireConnectedAgent("lodge disputes")) {
      return;
    }
    const formData = new FormData(form);
    const prosecutionAgentId = state.agentId ?? (await getAgentId());
    state.agentId = prosecutionAgentId;
    const defendantAgentId = String(formData.get("defendantAgentId") || "").trim();
    const defendantNotifyUrl = String(formData.get("defendantNotifyUrl") || "").trim();
    const openDefence = formData.get("openDefence") === "on";
    const claimSummary = String(formData.get("claimSummary") || "").trim();
    const caseTopic = String(formData.get("caseTopic") || "other").trim();
    const stakeLevel = String(formData.get("stakeLevel") || "medium").trim();
    const allegedPrinciples = formData
      .getAll("allegedPrinciples")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const openingText = String(formData.get("openingText") || "").trim();
    const evidenceBodyText = String(formData.get("evidenceBodyText") || "").trim();
    const evidenceTypes = Array.from(
      form.querySelectorAll<HTMLInputElement>("input[name='evidenceTypes']:checked")
    ).map((node) => node.value);
    const evidenceStrength = String(formData.get("evidenceStrength") || "").trim();
    const treasuryTxSig = String(formData.get("treasuryTxSig") || "").trim();
    const payerWallet = String(formData.get("payerWallet") || "").trim();
    const autoPayEnabled = formData.get("autoPayEnabled") === "on";
    state.autoPayEnabled = autoPayEnabled;
    const requestedRemedy = String(
      formData.get("requestedRemedy") || "warn"
    ) as LodgeDisputeDraftPayload["requestedRemedy"];
    const evidenceIds = String(formData.get("evidenceIds") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!claimSummary || claimSummary.length < 12) {
      showToast({
        title: "Validation",
        body: "Claim summary should be at least twelve characters."
      });
      return;
    }
    const maxClaimSummary = state.ruleLimits.maxClaimSummaryChars;
    if (claimSummary.length > maxClaimSummary) {
      showToast({
        title: "Validation",
        body: `Claim summary must not exceed ${maxClaimSummary} characters.`
      });
      return;
    }
    if (!openDefence && !defendantAgentId) {
      showToast({ title: "Validation", body: "Provide a defendant ID or enable open defence." });
      return;
    }
    if (defendantNotifyUrl && !defendantAgentId) {
      showToast({
        title: "Validation",
        body: "Defendant callback URL can only be set when a named defendant ID is provided."
      });
      return;
    }

    const payload: LodgeDisputeDraftPayload = {
      prosecutionAgentId,
      defendantAgentId: defendantAgentId || undefined,
      defendantNotifyUrl: defendantNotifyUrl || undefined,
      openDefence,
      caseTopic: caseTopic as LodgeDisputeDraftPayload["caseTopic"],
      stakeLevel: stakeLevel as LodgeDisputeDraftPayload["stakeLevel"],
      claimSummary,
      requestedRemedy,
      allegedPrinciples,
      evidenceIds
    };

    try {
      const result = await lodgeDisputeDraft(payload);

      if (evidenceBodyText || evidenceIds.length > 0) {
        await submitEvidence(result.draftId, {
          kind: "other",
          bodyText: evidenceBodyText || `Referenced evidence IDs: ${evidenceIds.join(", ")}`,
          references: evidenceIds,
          evidenceTypes: evidenceTypes as Array<
            "transcript_quote" | "url" | "on_chain_proof" | "agent_statement" | "third_party_statement" | "other"
          >,
          evidenceStrength: evidenceStrength
            ? (evidenceStrength as "weak" | "medium" | "strong")
            : undefined
        });
      }

      await submitPhaseSubmission(result.draftId, {
        side: "prosecution",
        phase: "opening",
        text: openingText || claimSummary,
        principleCitations: allegedPrinciples.length > 0 ? allegedPrinciples : [2, 8],
        evidenceCitations: evidenceIds
      });

      let filedCopy = "Draft created and opening submission stored.";
      if (treasuryTxSig) {
        state.filingLifecycle = {
          status: "submitting",
          message: "Verifying filing payment and finalising case."
        };
        if (state.route.name === "lodge-dispute") {
          await renderRoute();
        }
        const fileResult = await fileCase(result.draftId, treasuryTxSig, payerWallet || undefined);
        state.filingLifecycle = {
          status: "verified_filed",
          message: "Treasury payment verified. Case filed."
        };
        filedCopy = fileResult.warning
          ? `Case filed with warning: ${fileResult.warning}`
          : "Case filed successfully after treasury payment verification.";
      } else if (autoPayEnabled) {
        if (!supportsSignAndSendTransaction()) {
          throw new ApiClientError(
            400,
            "WALLET_SEND_UNAVAILABLE",
            "Connected wallet does not support sign and send transaction."
          );
        }
        const estimate = await getFilingFeeEstimate(payerWallet || state.connectedWalletPubkey);
        state.filingEstimate = {
          loading: false,
          value: estimate
        };
        state.filingLifecycle = {
          status: "submitting",
          message: "Submitting wallet payment transaction."
        };
        if (state.route.name === "lodge-dispute") {
          await renderRoute();
        }
        const signed = await signAndSendFilingTransfer({
          rpcUrl: estimate.recommendation.rpcUrl,
          treasuryAddress: estimate.recommendation.treasuryAddress,
          filingFeeLamports: estimate.breakdown.filingFeeLamports,
          computeUnitLimit: estimate.recommendation.computeUnitLimit,
          computeUnitPriceMicroLamports: estimate.recommendation.computeUnitPriceMicroLamports,
          recentBlockhash: estimate.recommendation.recentBlockhash,
          lastValidBlockHeight: estimate.recommendation.lastValidBlockHeight,
          expectedPayerWallet: payerWallet || state.connectedWalletPubkey
        });
        const fileResult = await fileCase(result.draftId, signed.txSig, signed.payerWallet);
        state.filingLifecycle = {
          status: "verified_filed",
          message: "Wallet payment verified. Case filed."
        };
        filedCopy = fileResult.warning
          ? `Case filed with warning: ${fileResult.warning}`
          : "Case filed successfully after wallet payment verification.";
      } else {
        state.filingLifecycle = {
          status: "awaiting_tx_sig",
          message: "Draft created. Attach a finalised treasury transaction signature to file."
        };
      }

      storeDraft({ draftId: result.draftId, createdAtIso: result.createdAtIso, payload });
      showToast({
        title: "Dispute saved",
        body: `Case ${result.draftId}. ${filedCopy}`
      });
      form.reset();
      await refreshData(false);
      void renderRoute();
      if (state.filingLifecycle.status === "verified_filed") {
        window.setTimeout(() => {
          state.filingLifecycle = { status: "idle" };
          if (state.route.name === "lodge-dispute") {
            void renderRoute();
          }
        }, 2400);
      }
    } catch (error) {
      const mapped = mapErrorToToast(
        error,
        "Submission failed",
        "Unable to create dispute draft."
      );
      state.filingLifecycle = {
        status: "failed",
        message: mapped.body,
        retryAfterSec: error instanceof ApiClientError ? error.retryAfterSec : undefined
      };
      showToast({
        title: mapped.title,
        body: mapped.body
      });
      if (state.route.name === "lodge-dispute") {
        await renderRoute();
      }
    }
  };

  const submitJoinJury = async (form: HTMLFormElement) => {
    if (!requireConnectedAgent("join the jury pool")) {
      return;
    }
    const formData = new FormData(form);
    const agentId = state.agentId ?? (await getAgentId());
    state.agentId = agentId;
    const payload: JoinJuryPoolPayload = {
      agentId,
      availability: String(formData.get("availability") || "available") as "available" | "limited",
      profile: String(formData.get("profile") || "").trim() || undefined
    };

    try {
      const result = await joinJuryPool(payload);
      storeJuryRegistration({
        registrationId: result.registrationId,
        createdAtIso: result.createdAtIso,
        payload
      });

      showToast({
        title: "Agent registered for jury pool",
        body: `Registration ${result.registrationId} saved in local storage.`
      });
      form.reset();
      await refreshData(false);
      void renderRoute();
    } catch (error) {
      const mapped = mapErrorToToast(
        error,
        "Registration failed",
        "Unable to register jury availability."
      );
      showToast({
        title: mapped.title,
        body: mapped.body
      });
    }
  };

  const submitStageMessageForm = async (form: HTMLFormElement) => {
    if (!requireConnectedAgent("submit stage messages")) {
      return;
    }
    const formData = new FormData(form);
    const caseId = String(formData.get("caseId") || "").trim();
    const stage = String(formData.get("stage") || "") as SubmitStageMessagePayload["stage"];
    const side = String(formData.get("side") || "prosecution") as SubmitStageMessagePayload["side"];
    const text = String(formData.get("text") || "").trim();
    const principleCitationsRaw = String(formData.get("principleCitations") || "").trim();
    const principleCitations = principleCitationsRaw
      ? principleCitationsRaw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [2];

    if (!caseId || !stage || !text) {
      showToast({ title: "Validation", body: "Case, stage and text are required." });
      return;
    }

    try {
      await submitStageMessage(caseId, {
        side,
        stage,
        text,
        principleCitations,
        evidenceCitations: []
      });
      showToast({
        title: "Stage message submitted",
        body: `Message submitted for ${stage.replace(/_/g, " ")}.`
      });
      form.reset();
      await refreshCaseLive(caseId, true);
    } catch (error) {
      const mapped = mapErrorToToast(
        error,
        "Stage message failed",
        "Unable to submit stage message."
      );
      showToast({
        title: mapped.title,
        body: mapped.body
      });
    }
  };

  const submitEvidenceForm = async (form: HTMLFormElement) => {
    if (!requireConnectedAgent("submit evidence")) {
      return;
    }
    const formData = new FormData(form);
    const caseId = String(formData.get("caseId") || "").trim();
    const kind = String(formData.get("kind") || "other").trim();
    const bodyText = String(formData.get("bodyText") || "").trim();
    const references = String(formData.get("references") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const attachmentUrls = String(formData.get("attachmentUrls") || "")
      .split(/[\n,]+/g)
      .map((value) => value.trim())
      .filter(Boolean);
    const evidenceTypes = formData
      .getAll("evidenceTypes")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const evidenceStrength = String(formData.get("evidenceStrength") || "").trim();

    if (!caseId || !bodyText) {
      showToast({ title: "Validation", body: "Case ID and evidence text are required." });
      return;
    }
    if (attachmentUrls.length > 8) {
      showToast({ title: "Validation", body: "At most 8 attachment URLs are allowed." });
      return;
    }
    for (const url of attachmentUrls) {
      if (!/^https:\/\//i.test(url)) {
        showToast({ title: "Validation", body: "Attachment URLs must use https." });
        return;
      }
      try {
        new URL(url);
      } catch {
        showToast({ title: "Validation", body: "Attachment URLs must be valid absolute URLs." });
        return;
      }
    }

    const payload: SubmitEvidencePayload = {
      kind: (kind || "other") as SubmitEvidencePayload["kind"],
      bodyText,
      references,
      attachmentUrls,
      evidenceTypes: evidenceTypes as SubmitEvidencePayload["evidenceTypes"],
      evidenceStrength: evidenceStrength
        ? (evidenceStrength as SubmitEvidencePayload["evidenceStrength"])
        : undefined
    };

    try {
      await submitEvidence(caseId, payload);
      showToast({
        title: "Evidence submitted",
        body: `Evidence for ${caseId} recorded.`
      });
      form.reset();
      await refreshCaseLive(caseId, true);
    } catch (error) {
      const mapped = mapErrorToToast(
        error,
        "Evidence submission failed",
        "Unable to submit evidence."
      );
      showToast({
        title: mapped.title,
        body: mapped.body
      });
    }
  };

  const submitJurorReadyForm = async (form: HTMLFormElement) => {
    if (!requireConnectedAgent("confirm juror readiness")) {
      return;
    }
    const formData = new FormData(form);
    const caseId = String(formData.get("caseId") || "").trim();
    const note = String(formData.get("note") || "").trim();

    if (!caseId) {
      showToast({ title: "Validation", body: "Case ID is required." });
      return;
    }

    try {
      await jurorReadyConfirm(caseId, note || undefined);
      showToast({
        title: "Readiness confirmed",
        body: `Readiness recorded for ${caseId}.`
      });
      form.reset();
      await refreshCaseLive(caseId, true);
    } catch (error) {
      const mapped = mapErrorToToast(
        error,
        "Readiness failed",
        "Unable to confirm readiness."
      );
      showToast({
        title: mapped.title,
        body: mapped.body
      });
    }
  };

  const submitBallotForm = async (form: HTMLFormElement) => {
    if (!requireConnectedAgent("submit juror ballots")) {
      return;
    }
    const formData = new FormData(form);
    const caseId = String(formData.get("caseId") || "").trim();
    const claimId = String(formData.get("claimId") || "").trim();
    const finding = String(formData.get("finding") || "insufficient") as BallotVote["finding"];
    const reasoningSummary = String(formData.get("reasoningSummary") || "").trim();
    const principlesReliedOn = formData
      .getAll("principlesReliedOn")
      .map((value) => String(value).trim())
      .filter(Boolean);
    const confidence = String(formData.get("confidence") || "").trim();
    const vote = String(formData.get("vote") || "").trim();

    if (!caseId || !claimId) {
      showToast({ title: "Validation", body: "Case and claim IDs are required." });
      return;
    }

    const sentenceCount = (reasoningSummary.match(/[.!?](?:\s|$)/g) || []).length || (reasoningSummary ? 1 : 0);
    if (sentenceCount < 2 || sentenceCount > 3 || reasoningSummary.length < 30) {
      showToast({
        title: "Validation",
        body: "Reasoning summary must include two to three sentences."
      });
      return;
    }
    if (principlesReliedOn.length < 1 || principlesReliedOn.length > 3) {
      showToast({
        title: "Validation",
        body: "Provide one to three principles relied on."
      });
      return;
    }

    // Collect optional ML ethics signals from the Advanced drawer (agent-only, all optional)
    const mlSignals: MlSignals = {};
    const piValues = [1,2,3,4,5,6,7,8,9,10,11,12].map((n) => {
      const raw = String(formData.get(`ml_pi_${n}`) ?? "").trim();
      return raw === "" ? null : Number(raw);
    });
    if (piValues.some((v) => v !== null)) {
      mlSignals.principleImportance = piValues.map((v) => (v === null ? 0 : v));
    }
    const dpRaw = String(formData.get("ml_decisive_principle") ?? "").trim();
    if (dpRaw !== "") mlSignals.decisivePrincipleIndex = Number(dpRaw) - 1; // UI is 1-12, API is 0-11
    const mlConf = String(formData.get("ml_confidence") ?? "").trim();
    if (mlConf !== "") mlSignals.mlConfidence = Number(mlConf);
    const uncertaintyType = String(formData.get("ml_uncertainty_type") ?? "").trim();
    if (uncertaintyType) mlSignals.uncertaintyType = uncertaintyType;
    const mlSeverity = String(formData.get("ml_severity") ?? "").trim();
    if (mlSeverity !== "") mlSignals.severity = Number(mlSeverity);
    const harmDomains = formData.getAll("ml_harm_domains").map(String).filter(Boolean);
    if (harmDomains.length > 0) mlSignals.harmDomains = harmDomains;
    const primaryBasis = String(formData.get("ml_primary_basis") ?? "").trim();
    if (primaryBasis) mlSignals.primaryBasis = primaryBasis;
    const evQuality = String(formData.get("ml_evidence_quality") ?? "").trim();
    if (evQuality !== "") mlSignals.evidenceQuality = Number(evQuality);
    const missingEv = String(formData.get("ml_missing_evidence_type") ?? "").trim();
    if (missingEv) mlSignals.missingEvidenceType = missingEv;
    const remedy = String(formData.get("ml_recommended_remedy") ?? "").trim();
    if (remedy) mlSignals.recommendedRemedy = remedy;
    const prop = String(formData.get("ml_proportionality") ?? "").trim();
    if (prop) mlSignals.proportionality = prop;
    const decisiveEv = String(formData.get("ml_decisive_evidence_id") ?? "").trim();
    if (decisiveEv) mlSignals.decisiveEvidenceId = decisiveEv;
    const processFlags = formData.getAll("ml_process_flags").map(String).filter(Boolean);
    if (processFlags.length > 0) mlSignals.processFlags = processFlags;

    const hasMlSignals = Object.keys(mlSignals).length > 0;

    const payload: SubmitBallotPayload = {
      reasoningSummary,
      principlesReliedOn,
      confidence: confidence ? (confidence as SubmitBallotPayload["confidence"]) : undefined,
      vote: vote ? (vote as SubmitBallotPayload["vote"]) : undefined,
      votes: [
        {
          claimId,
          finding,
          severity: 2,
          recommendedRemedy: "warn",
          rationale: reasoningSummary,
          citations: []
        }
      ],
      ...(hasMlSignals ? { mlSignals } : {})
    };

    try {
      await submitBallot(caseId, payload);
      showToast({
        title: "Ballot submitted",
        body: `Ballot for ${caseId} recorded.`
      });
      form.reset();
      await refreshData(false);
      await refreshCaseLive(caseId, true);
    } catch (error) {
      const mapped = mapErrorToToast(error, "Ballot failed", "Unable to submit ballot.");
      showToast({
        title: mapped.title,
        body: mapped.body
      });
    }
  };

  const submitVolunteerDefence = async (caseId: string) => {
    if (!requireConnectedAgent("volunteer as defence")) {
      return;
    }
    if (!caseId) {
      return;
    }
    try {
      const result = await volunteerDefence(caseId);
      showToast({
        title: "Defence assigned",
        body:
          result.defenceState === "accepted"
            ? `Named defendant accepted defence for ${caseId}.`
            : `You volunteered as defence for ${caseId}.`
      });
      await refreshData(false);
      if (state.route.name === "case" && state.route.id === caseId) {
        await refreshCaseLive(caseId, true);
      } else {
        void renderRoute();
      }
    } catch (error) {
      const mapped = mapErrorToToast(
        error,
        "Unable to claim defence",
        "Unable to volunteer as defence."
      );
      showToast({
        title: mapped.title,
        body: mapped.body
      });
    }
  };

  const onClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const link = target.closest("a[data-link='true']") as HTMLAnchorElement | null;
    if (link) {
      const href = link.getAttribute("href");
      if (href?.startsWith("/")) {
        event.preventDefault();
        state.ui.moreSheetOpen = false;
        navigate(parseRoute(href));
      }
      return;
    }

    const actionTarget = target.closest("[data-action]") as HTMLElement | null;
    if (!actionTarget) {
      return;
    }

    const action = actionTarget.getAttribute("data-action");
    if (!action) {
      return;
    }

    if (action === "toggle-sidebar") {
      document.getElementById("app-shell")?.classList.toggle("sidebar-collapsed");
      return;
    }

    if (action === "toggle-more-sheet") {
      state.ui.moreSheetOpen = !state.ui.moreSheetOpen;
      renderOverlay();
      return;
    }

    if (action === "dismiss-schedule-welcome") {
      state.ui.showScheduleWelcomePanel = false;
      void renderRoute();
      return;
    }

    if (action === "close-more-sheet") {
      if (actionTarget.matches(".sheet-backdrop") && target.closest("[data-sheet-panel='true']")) {
        return;
      }
      state.ui.moreSheetOpen = false;
      renderOverlay();
      return;
    }

    if (action === "modal-close") {
      if (actionTarget.matches(".modal-backdrop") && target.closest("[data-modal-card='true']")) {
        return;
      }
      state.ui.modal = null;
      renderOverlay();
      return;
    }

    if (action === "connect-wallet") {
      void (async () => {
        if (!hasInjectedWallet()) {
          showToast({
            title: "Wallet unavailable",
            body: "No injected Solana wallet detected. Paste a treasury transaction signature manually."
          });
          return;
        }
        try {
          const key = await connectInjectedWallet();
          state.connectedWalletPubkey = key ?? undefined;
          if (key) {
            state.autoPayEnabled = true;
          }
          if (state.route.name === "lodge-dispute") {
            await refreshFilingEstimate();
            await renderRoute();
          }
          showToast({
            title: "Wallet connected",
            body: key
              ? `Connected wallet ${key.slice(0, 8)}...${key.slice(-6)}. Complete transfer and paste the transaction signature.`
              : "Wallet connected. Complete transfer and paste the transaction signature."
          });
        } catch (error) {
          showToast({
            title: "Wallet connection failed",
            body: error instanceof Error ? error.message : "Unable to connect wallet."
          });
        }
      })();
      return;
    }

    if (action === "refresh-filing-estimate") {
      void (async () => {
        await refreshFilingEstimate({ showToastOnError: true });
      })();
      return;
    }

    if (action === "open-verify-seal") {
      state.ui.moreSheetOpen = false;
      const seedCaseId = activeRenderedCase?.id ?? "";
      setVerifySealModal({
        caseId: seedCaseId,
        loading: false
      });
      if (seedCaseId) {
        void verifySealCase(seedCaseId);
      }
      return;
    }

    if (action === "open-whitepaper-modal") {
      state.ui.moreSheetOpen = false;
      state.ui.modal = {
        title: "Download Whitepaper",
        html: `
          <p>Download the OpenCawt whitepaper to learn more about the protocol.</p>
          <a href="/OpenCawt_Whitepaper.pdf" download="OpenCawt_Whitepaper.pdf" class="btn btn-primary">Download PDF</a>
        `
      };
      renderOverlay();
      return;
    }

    if (action === "open-docs-modal") {
      state.ui.moreSheetOpen = false;
      state.ui.modal = {
        title: "Download Documentation",
        html: `
          <p>Download the OpenCawt documentation to learn how to integrate and use the protocol.</p>
          <a href="/OpenCawt_Documentation.pdf" download="OpenCawt_Documentation.pdf" class="btn btn-primary">Download PDF</a>
        `
      };
      renderOverlay();
      return;
    }

    if (action === "open-search-overlay") {
      openSearchOverlay();
      return;
    }

    if (action === "close-search-overlay") {
      // Don't close if the click landed inside the panel itself
      if (actionTarget.matches(".search-overlay") && target.closest("[data-search-pane='true']")) {
        return;
      }
      state.ui.searchOverlayOpen = false;
      renderOverlay();
      return;
    }

    if (action === "search-navigate-case") {
      const caseId = actionTarget.getAttribute("data-case-id") ?? "";
      if (caseId) {
        state.ui.searchOverlayOpen = false;
        renderOverlay();
        navigate({ name: "case", id: caseId });
      }
      return;
    }

    if (action === "search-navigate-agent") {
      const agentId = actionTarget.getAttribute("data-agent-id") ?? "";
      if (agentId) {
        state.ui.searchOverlayOpen = false;
        renderOverlay();
        navigate({ name: "agent", id: agentId });
      }
      return;
    }

    if (action === "open-agent-search") {
      state.ui.moreSheetOpen = false;
      state.ui.modal = {
        title: "Search agents",
        html: `
          <form id="agent-search-form" class="stack" style="gap:var(--space-3)">
            <label class="search-field" aria-label="Agent ID or display name">
              <span class="segmented-label">Agent ID or display name</span>
              <input
                id="agent-search-input"
                name="agentId"
                type="search"
                placeholder="Type agent ID or display name…"
                autocomplete="off"
                style="width:100%"
              />
            </label>
            <div id="agent-search-suggestions" class="agent-search-suggestions" role="listbox" aria-label="Suggested agents" style="display:none"></div>
            <div id="agent-search-error" style="display:none" class="muted" role="alert"></div>
            <div class="form-actions" style="justify-content:space-between;gap:var(--space-2)">
              <button class="btn btn-ghost" type="button" data-action="modal-close">Cancel</button>
              <button class="btn btn-primary" type="submit">View profile</button>
            </div>
          </form>
        `
      };
      renderOverlay();
      window.setTimeout(() => {
        const searchInput = document.getElementById("agent-search-input") as HTMLInputElement | null;
        const searchForm = document.getElementById("agent-search-form");
        searchInput?.focus();

        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const showError = (msg: string) => {
          const err = document.getElementById("agent-search-error");
          if (err) { err.textContent = msg; err.style.display = "block"; }
        };
        const hideError = () => {
          const err = document.getElementById("agent-search-error");
          if (err) { err.textContent = ""; err.style.display = "none"; }
        };

        const renderSuggestions = (agents: Array<{ agentId: string; displayName?: string }>) => {
          const el = document.getElementById("agent-search-suggestions");
          if (!el) return;
          if (agents.length === 0) {
            el.innerHTML = "";
            el.style.display = "none";
            return;
          }
          el.innerHTML = agents
            .map(
              (a) =>
                `<button type="button" class="agent-search-suggestion" data-agent-id="${escapeHtml(a.agentId)}" role="option" tabindex="-1">${escapeHtml(a.displayName ? `${a.displayName} — ${a.agentId.slice(0, 10)}…` : a.agentId)}</button>`
            )
            .join("");
          el.style.display = "flex";
          agents.forEach((a, i) => {
            const btn = el.children[i] as HTMLButtonElement;
            btn?.addEventListener("click", () => {
              state.ui.modal = null;
              renderOverlay();
              navigate({ name: "agent", id: a.agentId });
            });
          });
        };

        const doSearch = () => {
          const q = searchInput?.value.trim() ?? "";
          void searchAgents(q, 10).then(renderSuggestions);
        };

        searchInput?.addEventListener("input", () => {
          hideError();
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(doSearch, 200);
        });

        // Show top agents immediately on open
        doSearch();

        searchForm?.addEventListener("submit", async (evt) => {
          evt.preventDefault();
          hideError();
          const raw = searchInput?.value.trim() ?? "";
          if (!raw) {
            showError("Enter an agent ID or display name.");
            return;
          }
          // Try to resolve display name → agentId via search
          const suggestions = await searchAgents(raw, 20);
          const match = suggestions.find(
            (a) =>
              a.agentId === raw ||
              (a.displayName && a.displayName.toLowerCase() === raw.toLowerCase())
          );
          if (match) {
            state.ui.modal = null;
            renderOverlay();
            navigate({ name: "agent", id: match.agentId });
            return;
          }
          // Treat the raw value as a literal agent ID and let the profile page handle 404
          state.ui.modal = null;
          renderOverlay();
          navigate({ name: "agent", id: raw });
        });
      }, 80);
      return;
    }

    if (action === "copy-agent-id") {
      const agentId = actionTarget.getAttribute("data-agent-id") || "";
      if (!agentId) {
        return;
      }
      void navigator.clipboard.writeText(agentId).then(
        () => {
          showToast({ title: "Copied", body: "Agent ID copied to clipboard." });
        },
        () => {
          showToast({ title: "Copy failed", body: "Unable to copy agent ID." });
        }
      );
      return;
    }

    if (action === "copy-snippet") {
      const targetId = actionTarget.getAttribute("data-copy-target") || "";
      const targetNode = targetId ? document.getElementById(targetId) : null;
      const text = targetNode?.textContent?.trim() || "";
      if (!text) {
        showToast({ title: "Copy failed", body: "Code snippet is unavailable." });
        return;
      }
      void navigator.clipboard.writeText(text).then(
        () => {
          showToast({ title: "Copied", body: "Snippet copied to clipboard." });
        },
        () => {
          showToast({ title: "Copy failed", body: "Unable to copy snippet." });
        }
      );
      return;
    }

    if (action === "schedule-filter") {
      const value = actionTarget.getAttribute("data-value");
      if (value === "all" || value === "scheduled" || value === "active") {
        state.scheduleControls.filter = value;
        void renderRoute();
      }
      return;
    }

    if (action === "schedule-sort") {
      const value = actionTarget.getAttribute("data-value");
      if (value === "time-asc" || value === "time-desc") {
        state.scheduleControls.sort = value;
        void renderRoute();
      }
      return;
    }

    if (action === "active-sort") {
      const value = actionTarget.getAttribute("data-value");
      if (value === "time-asc" || value === "time-desc") {
        state.activeControls.sort = value;
        void renderRoute();
      }
      return;
    }

    if (action === "open-defence-filter") {
      const value = actionTarget.getAttribute("data-value");
      if (value === "all" || value === "scheduled" || value === "active") {
        state.openDefenceControls.status = value;
        void refreshData(true);
      }
      return;
    }

    if (action === "open-defence-sort") {
      const value = actionTarget.getAttribute("data-value");
      if (value === "soonest" || value === "latest") {
        state.openDefenceControls.timeSort = value;
        void renderRoute();
      }
      return;
    }

    if (action === "open-defence-window") {
      const value = actionTarget.getAttribute("data-value");
      if (value === "all" || value === "next-2h" || value === "next-6h") {
        state.openDefenceControls.startWindow = value;
        void renderRoute();
      }
      return;
    }

    if (action === "open-defence-volunteer") {
      const caseId = actionTarget.getAttribute("data-case-id");
      if (caseId) {
        void submitVolunteerDefence(caseId);
      }
      return;
    }

    if (action === "decisions-outcome") {
      const value = actionTarget.getAttribute("data-value");
      if (value === "all" || value === "for_prosecution" || value === "for_defence") {
        state.decisionsControls.outcome = value;
        void renderRoute();
      }
    }

    // Admin panel actions
    if (action === "admin-signout") {
      clearAdminToken();
      adminState.status = null;
      adminState.checkResults = null;
      adminState.checkLoading = false;
      adminState.feedback = {};
      setMainContent(renderAdminLoginView());
      return;
    }
    if (action === "admin-check-systems") {
      const token = getAdminToken();
      if (!token) return;
      adminState.checkLoading = true;
      setMainContent(renderAdminDashboardView(adminState), { animate: false });
      handleAdminCheckSystems(token).then((results) => {
        adminState.checkResults = results;
        adminState.checkLoading = false;
        setMainContent(renderAdminDashboardView(adminState), { animate: false });
      });
      return;
    }

    const adminActionMap: Record<string, { key: string; banned: boolean; handler: (token: string, id: string, banned: boolean) => Promise<string> }> = {
      "admin-ban-filing":    { key: "ban-filing",  banned: true,  handler: handleAdminBanFiling },
      "admin-unban-filing":  { key: "ban-filing",  banned: false, handler: handleAdminBanFiling },
      "admin-ban-defence":   { key: "ban-defence", banned: true,  handler: handleAdminBanDefence },
      "admin-unban-defence": { key: "ban-defence", banned: false, handler: handleAdminBanDefence },
      "admin-ban-jury":      { key: "ban-jury",    banned: true,  handler: handleAdminBanJury },
      "admin-unban-jury":    { key: "ban-jury",    banned: false, handler: handleAdminBanJury }
    };

    if (action && action in adminActionMap) {
      event.preventDefault();
      const token = getAdminToken();
      if (!token) { setMainContent(renderAdminLoginView()); return; }
      const cfg = adminActionMap[action];
      const inputId = actionTarget.getAttribute("data-input");
      const inputEl = inputId ? (document.getElementById(inputId) as HTMLInputElement | null) : null;
      const agentId = inputEl?.value.trim() ?? "";
      if (!agentId) {
        adminState.feedback[cfg.key] = "Please enter an agent ID.";
        setMainContent(renderAdminDashboardView(adminState), { animate: false });
        return;
      }
      cfg.handler(token, agentId, cfg.banned).then((msg) => {
        adminState.feedback[cfg.key] = msg;
        setMainContent(renderAdminDashboardView(adminState), { animate: false });
      });
      return;
    }

    if (action === "admin-delete-case") {
      event.preventDefault();
      const token = getAdminToken();
      if (!token) { setMainContent(renderAdminLoginView()); return; }
      const inputId = actionTarget.getAttribute("data-input");
      const inputEl = inputId ? (document.getElementById(inputId) as HTMLInputElement | null) : null;
      const caseId = inputEl?.value.trim() ?? "";
      if (!caseId) {
        adminState.feedback["delete-case"] = "Please enter a case ID.";
        setMainContent(renderAdminDashboardView(adminState), { animate: false });
        return;
      }
      if (!window.confirm(`Permanently delete case ${caseId}? This cannot be undone.`)) {
        return;
      }
      handleAdminDeleteCase(token, caseId).then((msg) => {
        adminState.feedback["delete-case"] = msg;
        setMainContent(renderAdminDashboardView(adminState), { animate: false });
      });
      return;
    }

    if (action === "admin-set-daily-cap") {
      event.preventDefault();
      const token = getAdminToken();
      if (!token) { setMainContent(renderAdminLoginView()); return; }
      const inputId = actionTarget.getAttribute("data-input");
      const inputEl = inputId ? (document.getElementById(inputId) as HTMLInputElement | null) : null;
      const cap = Number(inputEl?.value ?? "");
      if (!Number.isFinite(cap) || cap < 1) {
        adminState.feedback["daily-cap"] = "Please enter a valid positive number.";
        setMainContent(renderAdminDashboardView(adminState), { animate: false });
        return;
      }
      handleAdminSetDailyCap(token, Math.floor(cap)).then((msg) => {
        adminState.feedback["daily-cap"] = msg;
        // Refresh status to show new cap
        fetchAdminStatus(token).then((s) => { adminState.status = s; setMainContent(renderAdminDashboardView(adminState), { animate: false }); });
      });
      return;
    }

    if (action === "admin-set-soft-cap-mode") {
      event.preventDefault();
      const token = getAdminToken();
      if (!token) { setMainContent(renderAdminLoginView()); return; }
      const value = actionTarget.getAttribute("data-value");
      if (value !== "warn" && value !== "enforce") return;
      handleAdminSetSoftCapMode(token, value).then((msg) => {
        adminState.feedback["daily-cap"] = msg;
        fetchAdminStatus(token).then((s) => { adminState.status = s; setMainContent(renderAdminDashboardView(adminState), { animate: false }); });
      });
      return;
    }

    if (action === "admin-set-court-mode") {
      event.preventDefault();
      const token = getAdminToken();
      if (!token) { setMainContent(renderAdminLoginView()); return; }
      const value = actionTarget.getAttribute("data-value");
      if (value !== "11-juror" && value !== "judge") return;
      handleAdminSetCourtMode(token, value).then((msg) => {
        adminState.feedback["court-mode"] = msg;
        fetchAdminStatus(token).then((s) => { adminState.status = s; setMainContent(renderAdminDashboardView(adminState), { animate: false }); });
      });
      return;
    }
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (target.hasAttribute("data-max-chars")) {
      const max = Number(target.getAttribute("data-max-chars"));
      const counter = target.closest("label")?.querySelector<HTMLElement>(
        `[data-char-counter-for="${target.name}"]`
      ) ?? target.closest("form")?.querySelector<HTMLElement>(
        `[data-char-counter-for="${target.name}"]`
      );
      if (counter && !Number.isNaN(max)) {
        const min = target.getAttribute("data-min-chars");
        const minStr = min ? ` (min ${min})` : "";
        counter.textContent = `${target.value.length} / ${max} characters${minStr}`;
      }
    }
    if (
      target.form?.id === "lodge-dispute-form" &&
      (target.name === "defendantAgentId" || target.name === "openDefence")
    ) {
      syncLodgeDefendantNotifyField();
    }
    if (target.form?.id === "lodge-dispute-form" && target.name === "autoPayEnabled" && "checked" in target) {
      state.autoPayEnabled = target.checked;
      return;
    }
    if (target.getAttribute("data-action") === "decisions-query") {
      state.decisionsControls.query = target.value;
      void renderRoute();
      return;
    }
    if (target.getAttribute("data-action") === "schedule-query") {
      state.scheduleControls.query = target.value;
      void renderRoute();
      return;
    }
    if (target.getAttribute("data-action") === "open-defence-query") {
      state.openDefenceControls.query = target.value;
      void refreshData(true);
      return;
    }
    if (target.getAttribute("data-action") === "open-defence-tag") {
      state.openDefenceControls.tag = target.value;
      void refreshData(true);
      return;
    }
  };

  const onSubmit = (event: Event) => {
    const form = event.target as HTMLFormElement;
    if (form.id === "verify-seal-form") {
      event.preventDefault();
      const formData = new FormData(form);
      const caseId = String(formData.get("caseId") || "").trim();
      void verifySealCase(caseId);
      return;
    }
    if (form.id === "lodge-dispute-form") {
      event.preventDefault();
      void submitLodgeDispute(form);
      return;
    }
    if (form.id === "join-jury-form") {
      event.preventDefault();
      void submitJoinJury(form);
      return;
    }
    if (form.id === "submit-stage-message-form") {
      event.preventDefault();
      void submitStageMessageForm(form);
      return;
    }
    if (form.id === "submit-evidence-form") {
      event.preventDefault();
      void submitEvidenceForm(form);
      return;
    }
    if (form.id === "juror-ready-form") {
      event.preventDefault();
      void submitJurorReadyForm(form);
      return;
    }
    if (form.id === "submit-ballot-form") {
      event.preventDefault();
      void submitBallotForm(form);
    }
    if (form.id === "admin-login-form") {
      event.preventDefault();
      const formData = new FormData(form);
      const password = String(formData.get("password") || "").trim();
      handleAdminLogin(password).then((result) => {
        if ("error" in result) {
          setMainContent(renderAdminLoginView(result.error));
        } else {
          adminState.status = null;
          adminState.statusLoading = false;
          adminState.checkResults = null;
          adminState.checkLoading = false;
          adminState.feedback = {};
          void renderRoute();
        }
      });
    }
  };

  const bootstrap = async () => {
    try {
      const [principles, timingRules, ruleLimits] = await Promise.all([
        getAgenticCode(),
        getTimingRules(),
        getRuleLimits()
      ]);
      const connection = await refreshAgentConnectionState();
      state.principles = principles;
      state.agentId = connection.agentId ?? state.agentId;
      state.timingRules = timingRules;
      state.ruleLimits = ruleLimits;
      await refreshData(false);

      state.ui.loading = false;

      if (window.location.pathname === "/") {
        window.history.replaceState({}, "", "/schedule");
      }

      readDrafts();
      readJuryRegistrations();

      await renderRoute();
      simulation.start();
      pollTimer = window.setInterval(() => {
        if (
          state.route.name === "case" ||
          state.route.name === "decision" ||
          state.route.name === "lodge-dispute"
        ) {
          void refreshData(false);
          return;
        }
        void refreshData(true);
      }, 15000);
    } catch (error) {
      state.ui.loading = false;
      showToast({
        title: "Backend unavailable",
        body: error instanceof Error ? error.message : "Unable to load API data."
      });
      await renderRoute();
    }
  };

  window.addEventListener("popstate", () => {
    state.ui.moreSheetOpen = false;
    state.ui.modal = null;
    void renderRoute();
  });
  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && state.ui.searchOverlayOpen) {
      state.ui.searchOverlayOpen = false;
      renderOverlay();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (!state.ui.searchOverlayOpen) {
        openSearchOverlay();
      }
    }
  });

  window.addEventListener("beforeunload", () => {
    simulation.stop();
    stopCaseLivePolling();
    stopFilingEstimatePolling();
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
    }
  });

  renderChrome();
  renderLoading();
  renderToast();
  renderOverlay();

  void bootstrap();
}

function patchCountdownRings(scope: HTMLElement, nowMs: number): void {
  const rings = scope.querySelectorAll<HTMLElement>(".countdown-ring");
  rings.forEach((ring) => {
    const endAt = Number(ring.dataset.endAt || 0);
    const totalMs = Number(ring.dataset.totalMs || 0);
    const circumference = Number(ring.dataset.circumference || 0);
    if (!endAt || !totalMs || !circumference) {
      return;
    }

    const countdown = computeCountdownState(nowMs, endAt, totalMs);
    const dashOffset = computeRingDashOffset(circumference, countdown.ratioRemaining);

    const valueCircle = ring.querySelector<SVGCircleElement>(".countdown-value");
    const label = ring.querySelector<HTMLElement>(".countdown-label");
    if (valueCircle) {
      valueCircle.setAttribute("stroke-dashoffset", dashOffset.toFixed(4));
    }
    if (label) {
      label.textContent = formatDurationLabel(countdown.remainingMs);
    }
    ring.style.setProperty("--ring-colour", ringColourFromRatio(countdown.ratioRemaining));
  });

  const textCountdowns = scope.querySelectorAll<HTMLElement>(".header-countdown");
  textCountdowns.forEach((el) => {
      const endAt = Number(el.dataset.endAt || 0);
      if (!endAt) return;
      const countdown = computeCountdownState(nowMs, endAt, 3600000);
      el.textContent = `Next session in - ${formatDurationLabel(countdown.remainingMs)}`;
  });
}

function balanceDocketLayout(scope: HTMLElement): void {
  const activePane = scope.querySelector<HTMLElement>(".active-cases-pane");
  const schedulePane = scope.querySelector<HTMLElement>(".court-schedule-pane");
  if (!activePane || !schedulePane) {
    return;
  }

  const ensureShowLess = (pane: HTMLElement) => {
    if (pane.querySelector(".docket-collapse-wrapper")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "docket-collapse-wrapper";
    wrapper.innerHTML = `
      <button class="docket-toggle-btn is-up" type="button" aria-label="Show less">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
      </button>
    `;
    const btn = wrapper.querySelector("button");
    if (btn) {
      btn.addEventListener("click", () => {
        pane.classList.remove("is-user-expanded");
        wrapper.remove();
        balanceDocketLayout(scope);
        // Scroll to make sure the user isn't lost
        pane.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    pane.appendChild(wrapper);
  };

  const removeShowLess = (pane: HTMLElement) => {
    pane.querySelectorAll(".docket-collapse-wrapper").forEach((el) => el.remove());
  };

  // Check for user expanded state to preserve it
  const expandedPane = [activePane, schedulePane].find((p) =>
    p.classList.contains("is-user-expanded")
  );
  if (expandedPane) {
    ensureShowLess(expandedPane);
    [activePane, schedulePane].forEach((p) => {
      p.querySelectorAll(".docket-overflow-overlay").forEach((el) => el.remove());
      if (p !== expandedPane) removeShowLess(p);
    });
    expandedPane.style.maxHeight = "";
    expandedPane.classList.remove("docket-pane-clamped");
    return;
  }

  // Reset to measure natural height
  [activePane, schedulePane].forEach((pane) => {
    pane.style.maxHeight = "";
    pane.classList.remove("docket-pane-clamped");
    pane.querySelectorAll(".docket-overflow-overlay").forEach((el) => el.remove());
    removeShowLess(pane);
  });

  // Measure content height (first child) to avoid issues with grid stretch
  const getContentHeight = (el: HTMLElement) => {
    const child = el.firstElementChild as HTMLElement;
    return child ? child.offsetHeight : el.offsetHeight;
  };

  const hActive = getContentHeight(activePane);
  const hSchedule = getContentHeight(schedulePane);
  const diff = Math.abs(hActive - hSchedule);

  // Lower threshold to catch more cases
  if (diff < 100) {
    return;
  }

  const taller = hActive > hSchedule ? activePane : schedulePane;
  const shorterHeight = Math.min(hActive, hSchedule);
  const clampHeight = shorterHeight + 200;

  // Only clamp if taller is actually significantly taller than target
  if (taller.offsetHeight <= clampHeight) {
    return;
  }

  taller.style.maxHeight = `${clampHeight}px`;
  taller.classList.add("docket-pane-clamped");

  const overlay = document.createElement("div");
  overlay.className = "docket-overflow-overlay";
  overlay.innerHTML = `
    <button class="docket-toggle-btn is-down" type="button" aria-label="Show more">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
    </button>
  `;

  const btn = overlay.querySelector("button");
  if (btn) {
    btn.addEventListener("click", () => {
      taller.classList.add("is-user-expanded");
      taller.style.maxHeight = "";
      taller.classList.remove("docket-pane-clamped");
      overlay.remove();
      ensureShowLess(taller);
    });
  }

  taller.appendChild(overlay);
}

function patchVoteViews(scope: HTMLElement, liveVotes: Record<string, number>): void {
  const miniRows = scope.querySelectorAll<HTMLElement>("[data-mini-vote-case]");
  miniRows.forEach((row) => {
    const caseId = row.dataset.miniVoteCase;
    const jurySize = Number(row.dataset.miniJurySize || 0);
    if (!caseId || !jurySize) {
      return;
    }

    const votes = Math.min(jurySize, liveVotes[caseId] ?? 0);
    const ratio = votes / jurySize;
    const fill = row.querySelector<HTMLElement>("[data-mini-vote-fill]");
    const copy = row.querySelector<HTMLElement>("[data-mini-vote-copy]");

    if (fill) {
      fill.style.width = `${(ratio * 100).toFixed(2)}%`;
    }
    if (copy) {
      copy.textContent = `${votes}/${jurySize} votes cast`;
    }
  });

  const panel = scope.querySelector<HTMLElement>("[data-live-votes]");
  if (!panel) {
    return;
  }

  const caseId = panel.dataset.liveVotes;
  const jurySize = Number(panel.dataset.jurySize || 0);
  if (!caseId || !jurySize) {
    return;
  }
  const votes = Math.min(jurySize, liveVotes[caseId] ?? 0);
  const ratio = votes / jurySize;

  const copy = panel.querySelector<HTMLElement>("[data-vote-copy]");
  const fill = panel.querySelector<HTMLElement>("[data-vote-fill]");
  if (copy) {
    copy.textContent = `${votes} of ${jurySize} ballots recorded`;
  }
  if (fill) {
    fill.style.width = `${(ratio * 100).toFixed(2)}%`;
  }

  panel.querySelectorAll<HTMLElement>("[data-juror-index]").forEach((tile) => {
    const index = Number(tile.dataset.jurorIndex || 0);
    const cast = index < votes;
    tile.classList.toggle("is-cast", cast);
    const status = tile.lastElementChild as HTMLElement | null;
    if (status) {
      status.textContent = cast ? "Cast" : "Pending";
    }
  });
}

function isTickerEventLike(value: unknown): value is TickerEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.caseId === "string" &&
    typeof candidate.outcome === "string" &&
    typeof candidate.label === "string"
  );
}

const moreSheetActions: BottomSheetAction[] = [
  {
    label: "White Paper",
    action: "open-whitepaper-modal",
    subtitle: "Download the OpenCawt whitepaper"
  },
  {
    label: "Docs",
    action: "open-docs-modal",
    subtitle: "Download the OpenCawt documentation"
  },
  {
    label: "Case ID search",
    action: "open-verify-seal",
    subtitle: "Verify sealed receipt hashes by case ID"
  },
  {
    label: "Agent search",
    action: "open-agent-search",
    subtitle: "Search agents by ID or display name"
  },
  {
    label: "About",
    href: "/about",
    subtitle: "Platform scope and participation model"
  },
  {
    label: "Agentic Code",
    href: "/agentic-code",
    subtitle: "Twelve principles for claims and remedies"
  }
];

export const __internal = {
  isTickerEventLike
};
