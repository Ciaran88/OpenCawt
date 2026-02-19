import { renderAppHeader } from "../components/appHeader";
import { renderAppShell } from "../components/appShell";
import {
  renderBottomSheet,
  type BottomSheetAction,
  type BottomSheetState
} from "../components/bottomSheet";
import { renderBottomTabBar } from "../components/bottomTabBar";
import { renderModal } from "../components/modal";
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
  getFilingFeeEstimate,
  getDashboardSnapshot,
  getAgentProfile,
  getPastDecisions,
  getLeaderboard,
  getOpenDefenceCases,
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
  OpenDefenceSearchFilters,
  SubmitBallotPayload,
  SubmitEvidencePayload,
  SubmitStageMessagePayload,
  TickerEvent
} from "../data/types";
import {
  computeCountdownState,
  computeRingDashOffset,
  formatDurationLabel
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
  applyResolvedTheme,
  cycleThemeMode,
  persistThemeMode,
  readThemeMode,
  resolveTheme
} from "../util/theme";
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
import { renderScheduleView } from "../views/scheduleView";

interface AppDom {
  header: HTMLElement;
  main: HTMLElement;
  toast: HTMLElement;
  overlay: HTMLElement;
  tabbar: HTMLElement;
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
    header: root.querySelector("#app-header") as HTMLElement,
    main: root.querySelector("#app-main") as HTMLElement,
    toast: root.querySelector("#app-toast") as HTMLElement,
    overlay: root.querySelector("#app-overlay") as HTMLElement,
    tabbar: root.querySelector("#app-tabbar") as HTMLElement
  };

  const state = createInitialState();
  state.theme.mode = readThemeMode();
  state.theme.resolved = resolveTheme(state.theme.mode);
  applyResolvedTheme(state.theme.resolved);
  let toastTimer: number | null = null;
  let pollTimer: number | null = null;
  let routeToken = 0;
  let activeRenderedCase: Case | null = null;
  let caseLiveTimer: number | null = null;
  let liveCaseId: string | null = null;
  let filingEstimateTimer: number | null = null;

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
        renderHeader();
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

  const refreshCaseLive = async (caseId: string, rerender = true) => {
    const pageScrollY = window.scrollY;
    const transcriptBefore = dom.main.querySelector<HTMLElement>(".session-transcript-window");
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
      setMainContent(renderCaseDetailView(state, caseItem, state.agentConnection), {
        animate: false
      });
      window.scrollTo({ top: pageScrollY, left: 0, behavior: "auto" });
      const transcriptAfter = dom.main.querySelector<HTMLElement>(".session-transcript-window");
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

  const renderHeader = () => {
    dom.header.innerHTML = renderAppHeader({
      route: state.route,
      tickerEvents: state.ticker,
      theme: state.theme,
      agentConnection: state.agentConnection
    });
  };

  const renderTabbar = () => {
    dom.tabbar.innerHTML = renderBottomTabBar(state.route, state.ui.moreSheetOpen);
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

    dom.overlay.innerHTML = `${renderBottomSheet(moreSheet)}${renderModal(state.ui.modal)}`;
  };

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

  const renderRouteContent = async (token: number) => {
    activeRenderedCase = null;
    const route = state.route;

    if (route.name !== "case") {
      stopCaseLivePolling();
    }
    if (route.name !== "lodge-dispute") {
      stopFilingEstimatePolling();
    }

    if (route.name === "schedule") {
      setMainContent(renderScheduleView(state));
    } else if (route.name === "past-decisions") {
      setMainContent(renderPastDecisionsView(state));
    } else if (route.name === "about") {
      setMainContent(renderAboutView(state.leaderboard));
    } else if (route.name === "agentic-code") {
      setMainContent(renderAgenticCodeView(state.principles, state.caseMetrics.closedCasesCount));
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
          state.connectedWalletPubkey
        )
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
        )
      );
    } else if (route.name === "agent") {
      const existing = state.agentProfiles[route.id];
      const profile = existing ?? (await getAgentProfile(route.id));
      if (token !== routeToken) {
        return;
      }
      if (!profile) {
        setMainContent(renderMissingAgentProfileView());
      } else {
        state.agentProfiles[route.id] = profile as AgentProfile;
        setMainContent(renderAgentProfileView(profile));
      }
    } else if (route.name === "case") {
      const caseItem = await resolveCaseById(route.id);
      if (token !== routeToken) {
        return;
      }
      if (!caseItem) {
        setMainContent(renderMissingCaseView());
      } else {
        activeRenderedCase = caseItem;
        if (
          state.caseSessions[route.id] === undefined ||
          state.transcripts[route.id] === undefined
        ) {
          await refreshCaseLive(route.id, false);
        }
        setMainContent(renderCaseDetailView(state, caseItem, state.agentConnection));
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
      if (!decision) {
        setMainContent(renderMissingDecisionView());
      } else {
        const transcript = await getCaseTranscript(decision.caseId);
        if (token !== routeToken) {
          return;
        }
        setMainContent(renderDecisionDetailView(decision, transcript));
      }
    }

    patchCountdownRings(dom.main, state.nowMs);
    patchVoteViews(dom.main, state.liveVotes);
    syncVoteSimulation();
  };

  const renderRoute = async () => {
    routeToken += 1;
    const currentToken = routeToken;
    state.route = parseRoute(window.location.pathname);
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

    renderHeader();
    renderTabbar();
    renderOverlay();

    if (state.ui.loading) {
      renderLoading();
      return;
    }

    await renderRouteContent(currentToken);
  };

  const setThemeMode = (mode: "system" | "light" | "dark") => {
    state.theme.mode = mode;
    state.theme.resolved = resolveTheme(mode);
    applyResolvedTheme(state.theme.resolved);
    persistThemeMode(mode);
    renderHeader();
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
        getLeaderboard(20, 5),
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
      await renderRoute();
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
      ]
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

    if (action === "toggle-more-sheet") {
      state.ui.moreSheetOpen = !state.ui.moreSheetOpen;
      renderTabbar();
      renderOverlay();
      return;
    }

    if (action === "close-more-sheet") {
      if (actionTarget.matches(".sheet-backdrop") && target.closest("[data-sheet-panel='true']")) {
        return;
      }
      state.ui.moreSheetOpen = false;
      renderTabbar();
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

    if (action === "cycle-theme") {
      setThemeMode(cycleThemeMode(state.theme.mode));
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
      if (
        value === "all" ||
        value === "for_prosecution" ||
        value === "for_defence" ||
        value === "void"
      ) {
        state.decisionsControls.outcome = value;
        void renderRoute();
      }
    }
  };

  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (
      target.form?.id === "lodge-dispute-form" &&
      (target.name === "defendantAgentId" || target.name === "openDefence")
    ) {
      syncLodgeDefendantNotifyField();
    }
    if (target.form?.id === "lodge-dispute-form" && target.name === "autoPayEnabled") {
      state.autoPayEnabled = target.checked;
      return;
    }
    if (target.getAttribute("data-action") === "decisions-query") {
      state.decisionsControls.query = target.value;
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
  const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  const onThemeMediaChange = () => {
    if (state.theme.mode !== "system") {
      return;
    }
    state.theme.resolved = resolveTheme("system");
    applyResolvedTheme(state.theme.resolved);
    renderHeader();
  };
  if (typeof themeMedia.addEventListener === "function") {
    themeMedia.addEventListener("change", onThemeMediaChange);
  } else {
    themeMedia.addListener(onThemeMediaChange);
  }

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
    if (typeof themeMedia.removeEventListener === "function") {
      themeMedia.removeEventListener("change", onThemeMediaChange);
    } else {
      themeMedia.removeListener(onThemeMediaChange);
    }
  });

  renderHeader();
  renderTabbar();
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
  });
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
