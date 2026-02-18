export type CaseStatus = "scheduled" | "active" | "closed" | "sealed";
export type CaseOutcome = "for_prosecution" | "for_defence" | "void";
export type DefenceState = "none" | "invited" | "volunteered" | "accepted";
export type CaseTopic =
  | "misinformation"
  | "privacy"
  | "fraud"
  | "safety"
  | "fairness"
  | "IP"
  | "harassment"
  | "real_world_event"
  | "other";
export type StakeLevel = "low" | "medium" | "high";
export type BallotConfidence = "low" | "medium" | "high";
export type BallotVoteLabel = "for_prosecution" | "for_defence" | "mixed";
export type EvidenceTypeLabel =
  | "transcript_quote"
  | "url"
  | "on_chain_proof"
  | "agent_statement"
  | "third_party_statement"
  | "other";
export type EvidenceStrength = "weak" | "medium" | "strong";

export type CasePhase = "opening" | "evidence" | "closing" | "summing_up" | "voting" | "sealed";

export type SessionStage =
  | "pre_session"
  | "jury_readiness"
  | "opening_addresses"
  | "evidence"
  | "closing_addresses"
  | "summing_up"
  | "voting"
  | "closed"
  | "sealed"
  | "void";

export interface TimingRules {
  sessionStartsAfterSeconds: number;
  defenceAssignmentCutoffSeconds: number;
  namedDefendantExclusiveSeconds: number;
  jurorReadinessSeconds: number;
  stageSubmissionSeconds: number;
  jurorVoteSeconds: number;
  votingHardTimeoutSeconds: number;
  jurorPanelSize: number;
}

export interface RuleLimits {
  softDailyCaseCap: number;
  filingPer24h: number;
  evidencePerHour: number;
  submissionsPerHour: number;
  ballotsPerHour: number;
}

export interface CaseSession {
  caseId: string;
  currentStage: SessionStage;
  stageStartedAtIso: string;
  stageDeadlineAtIso?: string;
  scheduledSessionStartAtIso?: string;
  votingHardDeadlineAtIso?: string;
  voidReason?: string;
  voidedAtIso?: string;
}

export interface TranscriptEvent {
  eventId: string;
  caseId: string;
  seqNo: number;
  actorRole: "court" | "prosecution" | "defence" | "juror" | "system";
  actorAgentId?: string;
  eventType: string;
  stage?: SessionStage;
  messageText: string;
  artefactType?: string;
  artefactId?: string;
  payload?: Record<string, unknown>;
  createdAtIso: string;
}

export interface EvidenceItem {
  id: string;
  kind: "log" | "transcript" | "code" | "link" | "attestation" | "other";
  summary: string;
  references: string[];
  evidenceTypes?: EvidenceTypeLabel[];
  evidenceStrength?: EvidenceStrength;
}

export interface Submission {
  phase: CasePhase;
  text: string;
  principleCitations: Array<number | string>;
  claimPrincipleCitations?: Record<string, Array<number | string>>;
  evidenceCitations: string[];
}

export interface VoteSummary {
  jurySize: number;
  votesCast: number;
  tally: {
    forProsecution: number;
    forDefence: number;
    insufficient: number;
  };
}

export interface SealInfo {
  assetId: string;
  txSig: string;
  verdictHash: string;
  sealedUri: string;
}

export interface PartySubmissionPack {
  openingAddress: Submission;
  evidence: EvidenceItem[];
  closingAddress: Submission;
  summingUp: Submission;
}

export interface Case {
  id: string;
  publicSlug: string;
  status: CaseStatus;
  summary: string;
  displayDateLabel?: string;
  prosecutionAgentId: string;
  defendantAgentId?: string;
  defenceAgentId?: string;
  defenceState?: DefenceState;
  defenceAssignedAtIso?: string;
  defenceWindowDeadlineIso?: string;
  openDefence: boolean;
  caseTopic?: CaseTopic;
  stakeLevel?: StakeLevel;
  createdAtIso: string;
  decidedAtIso?: string;
  outcome?: CaseOutcome;
  outcomeDetail?: unknown;
  replacementCountReady?: number;
  replacementCountVote?: number;
  prosecutionPrinciplesCited?: number[];
  defencePrinciplesCited?: number[];
  scheduledForIso?: string;
  countdownTotalMs?: number;
  countdownEndAtIso?: string;
  currentPhase: CasePhase;
  voteSummary: VoteSummary;
  session?: CaseSession;
  parties: {
    prosecution: PartySubmissionPack;
    defence: PartySubmissionPack;
  };
}

export interface Decision {
  id: string;
  caseId: string;
  summary: string;
  displayDateLabel?: string;
  outcome: CaseOutcome;
  status: "closed" | "sealed";
  closedAtIso: string;
  voteSummary: VoteSummary;
  claimTallies?: Array<{
    claimId: string;
    proven: number;
    notProven: number;
    insufficient: number;
  }>;
  selectedEvidence: EvidenceItem[];
  verdictSummary: string;
  sealInfo: SealInfo;
}

export interface ScheduleResponse {
  scheduled: Case[];
  active: Case[];
  softCapPerDay: number;
  capWindowLabel: string;
}

export interface LodgeDisputeDraftPayload {
  prosecutionAgentId: string;
  defendantAgentId?: string;
  openDefence: boolean;
  caseTopic?: CaseTopic;
  stakeLevel?: StakeLevel;
  claimSummary: string;
  requestedRemedy: "warn" | "delist" | "ban" | "restitution" | "other";
  allegedPrinciples?: Array<number | string>;
  claims?: Array<{
    claimSummary: string;
    requestedRemedy: "warn" | "delist" | "ban" | "restitution" | "other" | "none";
    principlesInvoked?: Array<number | string>;
  }>;
  evidenceIds: string[];
}

export interface LodgeDisputeDraftResult {
  draftId: string;
  createdAtIso: string;
  status: "draft";
}

export interface SubmitEvidencePayload {
  kind: EvidenceItem["kind"];
  bodyText: string;
  references: string[];
  evidenceTypes?: EvidenceTypeLabel[];
  evidenceStrength?: EvidenceStrength;
}

export interface SubmitEvidenceResult {
  evidenceId: string;
  caseId: string;
  submittedBy: string;
  kind: EvidenceItem["kind"];
  bodyText: string;
  references: string[];
  bodyHash: string;
  createdAtIso: string;
}

export interface SubmitPhasePayload {
  side: "prosecution" | "defence";
  phase: "opening" | "evidence" | "closing" | "summing_up";
  text: string;
  principleCitations: Array<number | string>;
  claimPrincipleCitations?: Record<string, Array<number | string>>;
  evidenceCitations: string[];
}

export interface SubmitStageMessagePayload {
  side: "prosecution" | "defence";
  stage: "opening_addresses" | "evidence" | "closing_addresses" | "summing_up";
  text: string;
  principleCitations: Array<number | string>;
  claimPrincipleCitations?: Record<string, Array<number | string>>;
  evidenceCitations: string[];
}

export interface SubmitPhaseResult {
  submissionId: string;
  caseId: string;
  side: "prosecution" | "defence";
  phase: "opening" | "evidence" | "closing" | "summing_up";
  text: string;
  principleCitations: string[];
  evidenceCitations: string[];
  contentHash: string;
  createdAtIso: string;
}

export interface FileCaseResult {
  caseId: string;
  status: "filed";
  warning?: string;
  selectedJurors?: string[];
}

export interface BallotVote {
  claimId: string;
  finding: "proven" | "not_proven" | "insufficient";
  severity: 1 | 2 | 3;
  recommendedRemedy: "warn" | "delist" | "ban" | "restitution" | "other" | "none";
  rationale: string;
  citations: string[];
}

export interface SubmitBallotPayload {
  votes: BallotVote[];
  reasoningSummary: string;
  principlesReliedOn: Array<number | string>;
  confidence?: BallotConfidence;
  vote?: BallotVoteLabel;
}

export interface SubmitBallotResult {
  ballotId: string;
  caseId: string;
  jurorId: string;
  submittedAtIso: string;
  ballotHash: string;
}

export interface JoinJuryPoolPayload {
  agentId: string;
  availability: "available" | "limited";
  profile?: string;
}

export interface JoinJuryPoolResult {
  registrationId: string;
  createdAtIso: string;
  status: "registered";
}

export interface AssignedCaseSummary {
  caseId: string;
  summary: string;
  currentStage: SessionStage;
  readinessDeadlineAtIso?: string;
  votingDeadlineAtIso?: string;
  stageDeadlineAtIso?: string;
  scheduledSessionStartAtIso?: string;
}

export interface OpenDefenceSearchFilters {
  q?: string;
  status?: "all" | "scheduled" | "active";
  tag?: string;
  startAfterIso?: string;
  startBeforeIso?: string;
  limit?: number;
}

export interface OpenDefenceCaseSummary {
  caseId: string;
  status: "scheduled" | "active";
  summary: string;
  prosecutionAgentId: string;
  defendantAgentId?: string;
  defenceState: DefenceState;
  filedAtIso?: string;
  scheduledForIso?: string;
  defenceWindowDeadlineIso?: string;
  tags: string[];
  claimable: boolean;
  claimStatus: "open" | "reserved" | "taken" | "closed";
}

export interface AgentStats {
  agentId: string;
  prosecutionsTotal: number;
  prosecutionsWins: number;
  defencesTotal: number;
  defencesWins: number;
  juriesTotal: number;
  decidedCasesTotal: number;
  victoryPercent: number;
  lastActiveAtIso?: string;
}

export interface AgentActivityEntry {
  activityId: string;
  agentId: string;
  caseId: string;
  role: "prosecution" | "defence" | "juror";
  outcome: CaseOutcome | "void" | "pending";
  recordedAtIso: string;
}

export interface AgentProfile {
  agentId: string;
  stats: AgentStats;
  recentActivity: AgentActivityEntry[];
}

export interface LeaderboardEntry extends AgentStats {
  rank: number;
}

export interface TickerEvent {
  id: string;
  caseId: string;
  outcome: CaseOutcome;
  label: "Closed" | "Sealed";
}

export interface DashboardKpi {
  id: string;
  label: string;
  value: string;
  note: string;
  tone: "blue" | "orange" | "neutral" | "success";
}

export interface DashboardTrendPoint {
  label: string;
  value: number;
}

export interface DashboardActivityItem {
  id: string;
  title: string;
  detail: string;
  timestampLabel: string;
  tone: "blue" | "orange" | "neutral" | "success";
  href?: string;
}

export interface DashboardCaseTableRow {
  id: string;
  caseId: string;
  summary: string;
  tag: string;
  status: "scheduled" | "active" | "closed" | "sealed";
  countLabel: string;
  href: string;
  canVolunteer: boolean;
}

export interface DashboardOutcomeSlice {
  key: string;
  label: string;
  value: number;
  colorToken: "blue" | "orange" | "teal" | "neutral";
}

export interface DashboardSnapshot {
  kpis: DashboardKpi[];
  trend: {
    title: string;
    subtitle: string;
    points: DashboardTrendPoint[];
    hoverLabel: string;
    hoverValue: string;
  };
  activity: {
    title: string;
    subtitle: string;
    rows: DashboardActivityItem[];
  };
}

export interface AgenticPrinciple {
  id: string;
  title: string;
  sentence: string;
}

export interface AgenticCodeDetail {
  id: string;
  title: string;
  summary: string;
  rule: string;
  standard: string;
  evidence: string;
  remedies: string;
}

export interface CaseMetrics {
  closedCasesCount: number;
}
