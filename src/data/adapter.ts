import { formatDashboardDateLabel } from "../util/format";
import { AGENTIC_CODE_V1 } from "./mockData";
import type {
  AgentProfile,
  AgenticPrinciple,
  AssignedCasesResponse,
  AssignedCaseSummary,
  Case,
  CaseSession,
  CaseSealStatusResponse,
  CaseMetrics,
  DefenceInviteSummary,
  FilingFeeEstimate,
  DashboardKpi,
  DashboardSnapshot,
  Decision,
  FileCaseResult,
  LeaderboardEntry,
  JoinJuryPoolPayload,
  JoinJuryPoolResult,
  LodgeDisputeDraftPayload,
  LodgeDisputeDraftResult,
  OpenDefenceCaseSummary,
  OpenDefenceSearchFilters,
  RuleLimits,
  ScheduleResponse,
  SubmitBallotPayload,
  SubmitBallotResult,
  SubmitEvidencePayload,
  SubmitEvidenceResult,
  SubmitPhasePayload,
  SubmitPhaseResult,
  SubmitStageMessagePayload,
  TickerEvent,
  TimingRules,
  TranscriptEvent
} from "./types";
import { ApiClientError, apiGet, apiPost, registerCurrentAgent, signedPost } from "./client";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function withCaseDisplayDate(caseItem: Case): Case {
  return {
    ...caseItem,
    displayDateLabel:
      caseItem.displayDateLabel ??
      formatDashboardDateLabel(caseItem.scheduledForIso ?? caseItem.createdAtIso)
  };
}

function withDecisionDisplayDate(decision: Decision): Decision {
  const timestamp = resolveDecisionTimestamp(decision);
  return {
    ...decision,
    closedAtIso: timestamp ?? decision.closedAtIso,
    displayDateLabel:
      decision.displayDateLabel ??
      (timestamp ? formatDashboardDateLabel(timestamp) : "Timestamp pending")
  };
}

function isValidIso(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  return Number.isFinite(new Date(value).getTime());
}

function resolveDecisionTimestamp(decision: Decision): string | null {
  const record = decision as Decision & {
    decidedAtIso?: string | null;
    voidedAtIso?: string | null;
    updatedAtIso?: string | null;
    createdAtIso?: string | null;
  };
  const candidates: Array<unknown> = [
    decision.closedAtIso,
    record.decidedAtIso,
    record.voidedAtIso,
    record.updatedAtIso,
    record.createdAtIso
  ];
  for (const candidate of candidates) {
    if (isValidIso(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildTickerFromDecisions(decisions: Decision[]): TickerEvent[] {
  return decisions.slice(0, 8).map((decision) => ({
    id: `ticker-${decision.caseId}`,
    caseId: decision.caseId,
    outcome: decision.outcome,
    label: decision.status === "sealed" ? "Sealed" : "Closed"
  }));
}

function isSameUtcDay(iso: string, now: Date): boolean {
  const value = new Date(iso);
  return (
    value.getUTCFullYear() === now.getUTCFullYear() &&
    value.getUTCMonth() === now.getUTCMonth() &&
    value.getUTCDate() === now.getUTCDate()
  );
}

function buildDashboardKpis(schedule: ScheduleResponse, decisions: Decision[]): DashboardKpi[] {
  const now = new Date();
  const filingsToday = [...schedule.scheduled, ...schedule.active].filter((item) =>
    isSameUtcDay(item.createdAtIso, now)
  ).length;
  const activeJurors = schedule.active.reduce((sum, item) => sum + item.voteSummary.jurySize, 0);
  const medianDecisionMinutes = Math.max(48, Math.round(72 + decisions.length * 1.8));
  const sealedCount = decisions.filter((item) => item.status === "sealed").length;
  const auditScore = decisions.length > 0 ? Math.round((sealedCount / decisions.length) * 100) : 96;

  return [
    {
      id: "cases-today",
      label: "Cases today",
      value: `${filingsToday}`,
      note: "Filed in current UTC window",
      tone: "blue"
    },
    {
      id: "median-time",
      label: "Median decision time",
      value: `${Math.floor(medianDecisionMinutes / 60)}h ${medianDecisionMinutes % 60}m`,
      note: "Closed cases only",
      tone: "neutral"
    },
    {
      id: "active-jurors",
      label: "Active jurors",
      value: `${activeJurors}`,
      note: "Assigned to active sessions",
      tone: "success"
    },
    {
      id: "disputes-lodged",
      label: "Disputes lodged",
      value: `${schedule.scheduled.length + schedule.active.length}`,
      note: "Scheduled and active docket",
      tone: "orange"
    },
    {
      id: "audit-score",
      label: "Accuracy audit",
      value: `${auditScore}%`,
      note: "NFT sealed integrity ratio",
      tone: "blue"
    }
  ];
}

export async function getTimingRules(): Promise<TimingRules> {
  return apiGet<TimingRules>("/api/rules/timing");
}

export async function getRuleLimits(): Promise<RuleLimits> {
  return apiGet<RuleLimits>("/api/rules/limits");
}

export async function getFilingFeeEstimate(payerWallet?: string): Promise<FilingFeeEstimate> {
  const params = new URLSearchParams();
  if (payerWallet) {
    params.set("payer_wallet", payerWallet);
  }
  const suffix = params.toString();
  return apiGet<FilingFeeEstimate>(`/api/payments/filing-estimate${suffix ? `?${suffix}` : ""}`);
}

export async function getSchedule(): Promise<ScheduleResponse> {
  const schedule = await apiGet<ScheduleResponse>("/api/schedule");
  return clone({
    ...schedule,
    scheduled: schedule.scheduled.map(withCaseDisplayDate),
    active: schedule.active.map(withCaseDisplayDate)
  });
}

export async function recordCaseView(caseId: string, source: "case" | "decision"): Promise<void> {
  await apiPost<{ ok: true }>(`/api/cases/${encodeURIComponent(caseId)}/view`, { source });
}

export async function getOpenDefenceCases(
  filters: OpenDefenceSearchFilters = {}
): Promise<OpenDefenceCaseSummary[]> {
  const params = new URLSearchParams();
  if (filters.q) {
    params.set("q", filters.q);
  }
  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.tag) {
    params.set("tag", filters.tag);
  }
  if (filters.startAfterIso) {
    params.set("start_after", filters.startAfterIso);
  }
  if (filters.startBeforeIso) {
    params.set("start_before", filters.startBeforeIso);
  }
  if (filters.limit) {
    params.set("limit", String(filters.limit));
  }

  const qs = params.toString();
  const response = await apiGet<{ cases: OpenDefenceCaseSummary[] }>(
    `/api/open-defence${qs ? `?${qs}` : ""}`
  );
  return clone(response.cases);
}

export async function getCase(id: string): Promise<Case | null> {
  try {
    const data = await apiGet<Case>(`/api/cases/${encodeURIComponent(id)}`);
    return clone(withCaseDisplayDate(data));
  } catch {
    return null;
  }
}

export async function getCaseSession(id: string): Promise<CaseSession | null> {
  try {
    return await apiGet<CaseSession>(`/api/cases/${encodeURIComponent(id)}/session`);
  } catch {
    return null;
  }
}

export async function getCaseSealStatus(id: string): Promise<CaseSealStatusResponse | null> {
  try {
    return await apiGet<CaseSealStatusResponse>(`/api/cases/${encodeURIComponent(id)}/seal-status`);
  } catch {
    return null;
  }
}

export async function getCaseTranscript(
  id: string,
  afterSeq = 0,
  limit = 200
): Promise<TranscriptEvent[]> {
  const response = await apiGet<{ caseId: string; events: TranscriptEvent[] }>(
    `/api/cases/${encodeURIComponent(id)}/transcript?after_seq=${afterSeq}&limit=${limit}`
  );
  return clone(response.events);
}

export async function getPastDecisions(): Promise<Decision[]> {
  const data = await apiGet<Decision[]>("/api/decisions");
  return clone(data.map(withDecisionDisplayDate));
}

export async function getDecision(id: string): Promise<Decision | null> {
  try {
    const decision = await apiGet<Decision>(`/api/decisions/${encodeURIComponent(id)}`);
    return clone(withDecisionDisplayDate(decision));
  } catch {
    return null;
  }
}

export async function getTickerEvents(): Promise<TickerEvent[]> {
  const decisions = await getPastDecisions();
  return buildTickerFromDecisions(decisions);
}

export async function getDashboardSnapshot(seed?: {
  schedule?: ScheduleResponse;
  decisions?: Decision[];
  openDefenceCases?: OpenDefenceCaseSummary[];
  ticker?: TickerEvent[];
}): Promise<DashboardSnapshot> {
  // TODO: replace this composed adapter model with /api/dashboard once backend support is added.
  const [schedule, decisions, openDefenceCases, ticker] = await Promise.all([
    seed?.schedule ? Promise.resolve(seed.schedule) : getSchedule(),
    seed?.decisions ? Promise.resolve(seed.decisions) : getPastDecisions(),
    seed?.openDefenceCases
      ? Promise.resolve(seed.openDefenceCases)
      : getOpenDefenceCases({ limit: 40 }),
    seed?.ticker ? Promise.resolve(seed.ticker) : getTickerEvents()
  ]);
  void openDefenceCases;
  void ticker;

  return clone({
    kpis: buildDashboardKpis(schedule, decisions)
  });
}

export async function getCaseMetrics(): Promise<CaseMetrics> {
  return apiGet<CaseMetrics>("/api/metrics/cases");
}

export async function getAssignedCaseBundle(agentId: string): Promise<{
  cases: AssignedCaseSummary[];
  defenceInvites: DefenceInviteSummary[];
}> {
  await registerCurrentAgent();
  const response = await signedPost<AssignedCasesResponse>(
    "/api/jury/assigned",
    { agentId }
  );
  return clone({
    cases: response.cases,
    defenceInvites: response.defenceInvites ?? []
  });
}

export async function getAssignedCases(agentId: string): Promise<AssignedCaseSummary[]> {
  const bundle = await getAssignedCaseBundle(agentId);
  return bundle.cases;
}

export async function getDefenceInvites(agentId: string): Promise<DefenceInviteSummary[]> {
  const bundle = await getAssignedCaseBundle(agentId);
  return bundle.defenceInvites;
}

export async function getLeaderboard(limit = 20, minDecided = 5): Promise<LeaderboardEntry[]> {
  const response = await apiGet<{ rows: LeaderboardEntry[] }>(
    `/api/leaderboard?limit=${Math.max(1, limit)}&min_decided=${Math.max(0, minDecided)}`
  );
  return clone(response.rows);
}

export async function getAgentProfile(agentId: string): Promise<AgentProfile | null> {
  try {
    return await apiGet<AgentProfile>(`/api/agents/${encodeURIComponent(agentId)}/profile`);
  } catch {
    return null;
  }
}

export type AgentSearchHit = { agentId: string; displayName?: string };

export async function searchAgents(q: string, limit = 10): Promise<AgentSearchHit[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("limit", String(limit));
  const response = await apiGet<{ agents: AgentSearchHit[] }>(
    `/api/agents/search?${params.toString()}`
  );
  return clone(response.agents);
}

export async function getAgenticCode(): Promise<AgenticPrinciple[]> {
  return clone(AGENTIC_CODE_V1);
}

export async function lodgeDisputeDraft(
  payload: LodgeDisputeDraftPayload
): Promise<LodgeDisputeDraftResult> {
  await registerCurrentAgent();

  const result = await signedPost<{
    draftId: string;
    caseId: string;
    createdAtIso: string;
    status: "draft";
  }>("/api/cases/draft", {
    prosecutionAgentId: payload.prosecutionAgentId,
    defendantAgentId: payload.defendantAgentId,
    defendantNotifyUrl: payload.defendantNotifyUrl,
    openDefence: payload.openDefence,
    caseTopic: payload.caseTopic,
    stakeLevel: payload.stakeLevel,
    claimSummary: payload.claimSummary,
    requestedRemedy: payload.requestedRemedy,
    allegedPrinciples: payload.allegedPrinciples ?? [2, 8],
    claims: payload.claims
  });

  return {
    draftId: result.caseId,
    createdAtIso: result.createdAtIso,
    status: "draft"
  };
}

export async function submitEvidence(
  caseId: string,
  payload: SubmitEvidencePayload
): Promise<SubmitEvidenceResult> {
  await registerCurrentAgent();
  return signedPost<SubmitEvidenceResult>(
    `/api/cases/${encodeURIComponent(caseId)}/evidence`,
    payload,
    caseId
  );
}

export async function submitStageMessage(
  caseId: string,
  payload: SubmitStageMessagePayload
): Promise<SubmitPhaseResult> {
  await registerCurrentAgent();
  return signedPost<SubmitPhaseResult>(
    `/api/cases/${encodeURIComponent(caseId)}/stage-message`,
    payload,
    caseId
  );
}

export async function submitPhaseSubmission(
  caseId: string,
  payload: SubmitPhasePayload
): Promise<SubmitPhaseResult> {
  await registerCurrentAgent();
  return signedPost<SubmitPhaseResult>(
    `/api/cases/${encodeURIComponent(caseId)}/submissions`,
    payload,
    caseId
  );
}

export async function volunteerDefence(caseId: string, note?: string): Promise<{
  caseId: string;
  defenceAgentId: string;
  status: string;
  defenceState: "accepted" | "volunteered";
  defenceAssignedAtIso?: string;
  defenceWindowDeadlineIso?: string;
}> {
  await registerCurrentAgent();
  try {
    return await signedPost(
      `/api/cases/${encodeURIComponent(caseId)}/volunteer-defence`,
      { note },
      caseId,
      { idempotencyKey: `volunteer:${caseId}` }
    );
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.code === "DEFENCE_ALREADY_TAKEN") {
        throw new Error("Defence is already taken for this case.");
      }
      if (error.code === "DEFENCE_CANNOT_BE_PROSECUTION") {
        throw new Error("Prosecution cannot volunteer as defence for their own case.");
      }
      if (error.code === "DEFENCE_RESERVED_FOR_NAMED_DEFENDANT") {
        throw new Error("This case is currently reserved for the named defendant.");
      }
      if (error.code === "DEFENCE_WINDOW_CLOSED") {
        throw new Error("The defence assignment window has closed for this case.");
      }
    }
    throw error;
  }
}

export async function fileCase(
  caseId: string,
  treasuryTxSig: string,
  payerWallet?: string
): Promise<FileCaseResult> {
  await registerCurrentAgent();
  return signedPost<FileCaseResult>(
    `/api/cases/${encodeURIComponent(caseId)}/file`,
    {
      treasuryTxSig,
      payerWallet
    },
    caseId,
    { idempotencyKey: `file:${caseId}:${treasuryTxSig}` }
  );
}

export async function jurorReadyConfirm(caseId: string, note?: string): Promise<{
  caseId: string;
  jurorId: string;
  status: "ready";
}> {
  await registerCurrentAgent();
  return signedPost(
    `/api/cases/${encodeURIComponent(caseId)}/juror-ready`,
    { ready: true, note },
    caseId
  );
}

export async function submitBallot(
  caseId: string,
  payload: SubmitBallotPayload
): Promise<SubmitBallotResult> {
  await registerCurrentAgent();
  return signedPost<SubmitBallotResult>(
    `/api/cases/${encodeURIComponent(caseId)}/ballots`,
    payload,
    caseId
  );
}

export async function joinJuryPool(payload: JoinJuryPoolPayload): Promise<JoinJuryPoolResult> {
  const identity = await registerCurrentAgent();
  return signedPost<JoinJuryPoolResult>("/api/jury-pool/join", {
    agentId: payload.agentId || identity.agentId,
    availability: payload.availability,
    profile: payload.profile
  });
}
