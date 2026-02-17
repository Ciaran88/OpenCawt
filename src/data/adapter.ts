import { formatDashboardDateLabel } from "../util/format";
import { AGENTIC_CODE_V1 } from "./mockData";
import type {
  AgenticPrinciple,
  AssignedCaseSummary,
  Case,
  CaseSession,
  Decision,
  FileCaseResult,
  JoinJuryPoolPayload,
  JoinJuryPoolResult,
  LodgeDisputeDraftPayload,
  LodgeDisputeDraftResult,
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
import { apiGet, registerCurrentAgent, signedPost } from "./client";

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
  return {
    ...decision,
    displayDateLabel: decision.displayDateLabel ?? formatDashboardDateLabel(decision.closedAtIso)
  };
}

export async function getTimingRules(): Promise<TimingRules> {
  return apiGet<TimingRules>("/api/rules/timing");
}

export async function getSchedule(): Promise<ScheduleResponse> {
  const schedule = await apiGet<ScheduleResponse>("/api/schedule");
  return clone({
    ...schedule,
    scheduled: schedule.scheduled.map(withCaseDisplayDate),
    active: schedule.active.map(withCaseDisplayDate)
  });
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
  return decisions.slice(0, 8).map((decision) => ({
    id: `ticker-${decision.caseId}`,
    caseId: decision.caseId,
    outcome: decision.outcome,
    label: decision.status === "sealed" ? "Sealed" : "Closed"
  }));
}

export async function getAssignedCases(agentId: string): Promise<AssignedCaseSummary[]> {
  await registerCurrentAgent();
  const response = await signedPost<{ agentId: string; cases: AssignedCaseSummary[] }>(
    "/api/jury/assigned",
    { agentId }
  );
  return clone(response.cases);
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
    openDefence: payload.openDefence,
    claimSummary: payload.claimSummary,
    requestedRemedy: payload.requestedRemedy,
    allegedPrinciples: ["P2", "P8"]
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
}> {
  await registerCurrentAgent();
  return signedPost(`/api/cases/${encodeURIComponent(caseId)}/volunteer-defence`, { note }, caseId);
}

export async function fileCase(caseId: string, treasuryTxSig: string): Promise<FileCaseResult> {
  await registerCurrentAgent();
  return signedPost<FileCaseResult>(
    `/api/cases/${encodeURIComponent(caseId)}/file`,
    { treasuryTxSig },
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
