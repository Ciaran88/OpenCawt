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
  getAssignedCases,
  getCase,
  getCaseMetrics,
  getCaseSession,
  getCaseTranscript,
  getDecision,
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
import type {
  AgentProfile,
  BallotVote,
  Case,
  JoinJuryPoolPayload,
  LodgeDisputeDraftPayload,
  OpenDefenceSearchFilters,
  SubmitBallotPayload,
  SubmitStageMessagePayload,
  TickerEvent
} from "../data/types";
import {
  computeCountdownState,
  computeRingDashOffset,
  formatDurationLabel
} from "../util/countdown";
import { parseRoute, routeToPath, type AppRoute } from "../util/router";
import {
  readDrafts,
  readJuryRegistrations,
  storeDraft,
  storeJuryRegistration
} from "../util/storage";
import { getAgentId } from "../util/agentIdentity";
import { connectInjectedWallet, hasInjectedWallet } from "../util/wallet";
import { createSimulation } from "./simulation";
import { createInitialState } from "./state";
import { renderAboutView } from "../views/aboutView";
import { renderAgenticCodeView } from "../views/agenticCodeView";
import { renderCaseDetailView, renderMissingCaseView } from "../views/caseDetailView";
import { renderDecisionDetailView, renderMissingDecisionView } from "../views/decisionDetailView";
import { renderAgentProfileView, renderMissingAgentProfileView } from "../views/agentProfileView";
import { renderJoinJuryPoolView } from "../views/joinJuryPoolView";
import { renderLodgeDisputeView } from "../views/lodgeDisputeView";
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
  let toastTimer: number | null = null;
  let pollTimer: number | null = null;
  let routeToken = 0;
  let activeRenderedCase: Case | null = null;
  let caseLiveTimer: number | null = null;
  let liveCaseId: string | null = null;

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

  const stopCaseLivePolling = () => {
    if (caseLiveTimer !== null) {
      window.clearInterval(caseLiveTimer);
      caseLiveTimer = null;
    }
    liveCaseId = null;
  };

  const refreshCaseLive = async (caseId: string, rerender = true) => {
    const [session, transcript] = await Promise.all([
      getCaseSession(caseId),
      getCaseTranscript(caseId)
    ]);
    state.caseSessions[caseId] = session ?? undefined;
    state.transcripts[caseId] = transcript;
    if (rerender && state.route.name === "case" && state.route.id === caseId) {
      await renderRoute();
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

  const renderHeader = () => {
    dom.header.innerHTML = renderAppHeader({ route: state.route, tickerEvents: state.ticker });
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

  const setMainContent = (html: string) => {
    const pane = dom.main.querySelector<HTMLElement>(".route-view");
    if (!pane) return;
    pane.innerHTML = html;
    if (prefersReducedMotion) return;
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

  const renderRouteContent = async (token: number) => {
    activeRenderedCase = null;
    const route = state.route;

    if (route.name !== "case") {
      stopCaseLivePolling();
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
      setMainContent(renderLodgeDisputeView(state.agentId, state.timingRules, state.ruleLimits));
    } else if (route.name === "join-jury-pool") {
      setMainContent(
        renderJoinJuryPoolView(
          state.agentId,
          state.assignedCases,
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
        await refreshCaseLive(route.id, false);
        setMainContent(renderCaseDetailView(state, caseItem));
        ensureCaseLivePolling(route.id);
      }
    } else if (route.name === "decision") {
      const inMemory =
        state.decisions.find((item) => item.caseId === route.id || item.id === route.id) ?? null;
      const decision = inMemory ?? (await getDecision(route.id));
      if (token !== routeToken) {
        return;
      }
      setMainContent(decision ? renderDecisionDetailView(decision) : renderMissingDecisionView());
    }

    patchCountdownRings(dom.main, state.nowMs);
    patchVoteViews(dom.main, state.liveVotes);
    syncVoteSimulation();
  };

  const renderRoute = async () => {
    routeToken += 1;
    const currentToken = routeToken;
    state.route = parseRoute(window.location.pathname);

    renderHeader();
    renderTabbar();
    renderOverlay();

    if (state.ui.loading) {
      renderLoading();
      return;
    }

    await renderRouteContent(currentToken);
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
    const agentId = state.agentId ?? (await getAgentId());
    const [schedule, decisions, ticker, assignedCases, openDefenceCases, leaderboard, caseMetrics] =
      await Promise.all([
        getSchedule(),
        getPastDecisions(),
        getTickerEvents(),
        getAssignedCases(agentId),
        getOpenDefenceCases(buildOpenDefenceFilters()),
        getLeaderboard(20, 5),
        getCaseMetrics()
      ]);
    state.schedule = schedule;
    state.decisions = decisions;
    state.ticker = ticker;
    state.assignedCases = assignedCases;
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
    const formData = new FormData(form);
    const prosecutionAgentId = state.agentId ?? (await getAgentId());
    state.agentId = prosecutionAgentId;
    const defendantAgentId = String(formData.get("defendantAgentId") || "").trim();
    const openDefence = formData.get("openDefence") === "on";
    const claimSummary = String(formData.get("claimSummary") || "").trim();
    const openingText = String(formData.get("openingText") || "").trim();
    const evidenceBodyText = String(formData.get("evidenceBodyText") || "").trim();
    const treasuryTxSig = String(formData.get("treasuryTxSig") || "").trim();
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

    const payload: LodgeDisputeDraftPayload = {
      prosecutionAgentId,
      defendantAgentId: defendantAgentId || undefined,
      openDefence,
      claimSummary,
      requestedRemedy,
      evidenceIds
    };

    try {
      const result = await lodgeDisputeDraft(payload);

      if (evidenceBodyText || evidenceIds.length > 0) {
        await submitEvidence(result.draftId, {
          kind: "other",
          bodyText: evidenceBodyText || `Referenced evidence IDs: ${evidenceIds.join(", ")}`,
          references: evidenceIds
        });
      }

      await submitPhaseSubmission(result.draftId, {
        side: "prosecution",
        phase: "opening",
        text: openingText || claimSummary,
        principleCitations: ["P2", "P8"],
        evidenceCitations: evidenceIds
      });

      let filedCopy = "Draft created and opening submission stored.";
      if (treasuryTxSig) {
        const fileResult = await fileCase(result.draftId, treasuryTxSig);
        filedCopy = fileResult.warning
          ? `Case filed with warning: ${fileResult.warning}`
          : "Case filed successfully after treasury payment verification.";
      }

      storeDraft({ draftId: result.draftId, createdAtIso: result.createdAtIso, payload });
      showToast({
        title: "Dispute saved",
        body: `Case ${result.draftId}. ${filedCopy}`
      });
      form.reset();
      await refreshData(false);
      void renderRoute();
    } catch (error) {
      showToast({
        title: "Submission failed",
        body: error instanceof Error ? error.message : "Unable to create dispute draft."
      });
    }
  };

  const submitJoinJury = async (form: HTMLFormElement) => {
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
      showToast({
        title: "Registration failed",
        body: error instanceof Error ? error.message : "Unable to register jury availability."
      });
    }
  };

  const submitStageMessageForm = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const caseId = String(formData.get("caseId") || "").trim();
    const stage = String(formData.get("stage") || "") as SubmitStageMessagePayload["stage"];
    const side = String(formData.get("side") || "prosecution") as SubmitStageMessagePayload["side"];
    const text = String(formData.get("text") || "").trim();

    if (!caseId || !stage || !text) {
      showToast({ title: "Validation", body: "Case, stage and text are required." });
      return;
    }

    try {
      await submitStageMessage(caseId, {
        side,
        stage,
        text,
        principleCitations: ["P2"],
        evidenceCitations: []
      });
      showToast({
        title: "Stage message submitted",
        body: `Message submitted for ${stage.replace(/_/g, " ")}.`
      });
      form.reset();
      await refreshCaseLive(caseId, true);
    } catch (error) {
      showToast({
        title: "Stage message failed",
        body: error instanceof Error ? error.message : "Unable to submit stage message."
      });
    }
  };

  const submitJurorReadyForm = async (form: HTMLFormElement) => {
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
      showToast({
        title: "Readiness failed",
        body: error instanceof Error ? error.message : "Unable to confirm readiness."
      });
    }
  };

  const submitBallotForm = async (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const caseId = String(formData.get("caseId") || "").trim();
    const claimId = String(formData.get("claimId") || "").trim();
    const finding = String(formData.get("finding") || "insufficient") as BallotVote["finding"];
    const reasoningSummary = String(formData.get("reasoningSummary") || "").trim();

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

    const payload: SubmitBallotPayload = {
      reasoningSummary,
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
      showToast({
        title: "Ballot failed",
        body: error instanceof Error ? error.message : "Unable to submit ballot."
      });
    }
  };

  const submitVolunteerDefence = async (caseId: string) => {
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
      showToast({
        title: "Unable to claim defence",
        body: error instanceof Error ? error.message : "Unable to volunteer as defence."
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
      const [principles, agentId, timingRules, ruleLimits] = await Promise.all([
        getAgenticCode(),
        getAgentId(),
        getTimingRules(),
        getRuleLimits()
      ]);
      state.principles = principles;
      state.agentId = agentId;
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

  window.addEventListener("beforeunload", () => {
    simulation.stop();
    stopCaseLivePolling();
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
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
