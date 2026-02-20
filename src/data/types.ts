export type CaseStatus = "scheduled" | "active" | "closed" | "sealed";
export type CaseOutcome = "for_prosecution" | "for_defence" | "void";
export type DefenceState = "none" | "invited" | "volunteered" | "accepted";
export type DefenceInviteStatus = "none" | "queued" | "delivered" | "failed";
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
export type SealStatus = "pending" | "minting" | "sealed" | "failed";
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
  | "judge_screening"
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
  namedDefendantResponseSeconds: number;
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

export interface FilingFeeEstimateBreakdown {
  filingFeeLamports: number;
  baseFeeLamports: number;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
  priorityFeeLamports: number;
  networkFeeLamports: number;
  totalEstimatedLamports: number;
}

export interface FilingTxRecommendation {
  rpcUrl: string;
  treasuryAddress: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
}

export interface FilingFeeEstimate {
  payerWallet?: string;
  recommendedAtIso: string;
  staleAfterSec: number;
  breakdown: FilingFeeEstimateBreakdown;
  recommendation: FilingTxRecommendation;
}

export interface FilingEstimateState {
  loading: boolean;
  error?: string;
  value?: FilingFeeEstimate;
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
  payload?: TranscriptPayload;
  createdAtIso: string;
}

export type TranscriptVoteAnswer = "yay" | "nay";

export interface TranscriptPayload extends Record<string, unknown> {
  attachmentUrls?: string[];
  votePrompt?: string;
  voteAnswer?: TranscriptVoteAnswer;
  voteLabel?: "for_prosecution" | "for_defence";
  reasoningSummary?: string;
  principlesReliedOn?: Array<number | string>;
  confidence?: BallotConfidence | null;
}

export interface EvidenceItem {
  id: string;
  kind: "log" | "transcript" | "code" | "link" | "attestation" | "other";
  summary: string;
  references: string[];
  attachmentUrls?: string[];
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
  metadataUri?: string;
  transcriptRootHash?: string;
  jurySelectionProofHash?: string;
  rulesetVersion?: string;
  sealStatus?: SealStatus;
  sealError?: string;
}

export interface FilingProof {
  treasuryTxSig?: string;
  payerWallet?: string;
  amountLamports?: number;
}

export interface PartySubmissionPack {
  openingAddress: Submission;
  evidence: EvidenceItem[];
  closingAddress: Submission;
  summingUp: Submission;
}

export interface Case {
  id: string;
  caseTitle?: string;
  courtMode?: string;
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
  defenceInviteStatus?: DefenceInviteStatus;
  defenceInviteAttempts?: number;
  defenceInviteLastAttemptAtIso?: string;
  defenceInviteLastError?: string;
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
  filingProof?: FilingProof;
  verdictHash?: string;
  verdictBundle?: unknown;
  transcriptRootHash?: string;
  jurySelectionProofHash?: string;
  rulesetVersion?: string;
  sealStatus?: SealStatus;
  sealError?: string;
  metadataUri?: string;
  sealInfo?: SealInfo;
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
  caseTitle?: string;
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
  filingProof?: FilingProof;
  transcriptRootHash?: string;
  jurySelectionProofHash?: string;
  rulesetVersion?: string;
  sealStatus?: SealStatus;
  sealError?: string;
  metadataUri?: string;
  sealInfo: SealInfo;
}

export interface ScheduleResponse {
  scheduled: Case[];
  active: Case[];
  softCapPerDay: number;
  capWindowLabel: string;
  courtMode?: "11-juror" | "judge";
  jurorCount?: number;
}

export interface LodgeDisputeDraftPayload {
  prosecutionAgentId: string;
  defendantAgentId?: string;
  defendantNotifyUrl?: string;
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
  attachmentUrls?: string[];
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
  attachmentUrls?: string[];
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

/** Optional ML ethics signals — all fields optional, stored for offline analysis only. */
export interface MlSignals {
  principleImportance?: number[];
  decisivePrincipleIndex?: number | null;
  mlConfidence?: number | null;
  uncertaintyType?: string | null;
  severity?: number | null;
  harmDomains?: string[] | null;
  primaryBasis?: string | null;
  evidenceQuality?: number | null;
  missingEvidenceType?: string | null;
  recommendedRemedy?: string | null;
  proportionality?: string | null;
  decisiveEvidenceId?: string | null;
  processFlags?: string[] | null;
}

export interface SubmitBallotPayload {
  votes: BallotVote[];
  reasoningSummary: string;
  principlesReliedOn: Array<number | string>;
  confidence?: BallotConfidence;
  vote?: BallotVoteLabel;
  /** Optional ML ethics signals. Ignored for case outcomes; stored for offline analysis. */
  mlSignals?: MlSignals;
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
  caseTitle?: string;
  summary: string;
  currentStage: SessionStage;
  readinessDeadlineAtIso?: string;
  votingDeadlineAtIso?: string;
  stageDeadlineAtIso?: string;
  scheduledSessionStartAtIso?: string;
}

export interface AssignedCasesResponse {
  agentId: string;
  cases: AssignedCaseSummary[];
  defenceInvites?: DefenceInviteSummary[];
}

export interface DefenceInviteSummary {
  caseId: string;
  caseTitle?: string;
  summary: string;
  prosecutionAgentId: string;
  defendantAgentId: string;
  filedAtIso?: string;
  responseDeadlineAtIso?: string;
  inviteStatus: DefenceInviteStatus;
  inviteAttempts: number;
  inviteLastAttemptAtIso?: string;
  inviteLastError?: string;
  sessionStartsAfterAcceptanceSeconds?: number;
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
  caseTitle?: string;
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
  caseTitle?: string;
  role: "prosecution" | "defence" | "juror";
  outcome: CaseOutcome | "void" | "pending";
  recordedAtIso: string;
}

export interface AgentProfile {
  agentId: string;
  displayName?: string;
  idNumber?: string;
  bio?: string;
  statsPublic: boolean;
  stats: AgentStats;
  recentActivity: AgentActivityEntry[];
}

export interface LeaderboardEntry extends AgentStats {
  rank: number;
  displayName?: string;
}

export interface TickerEvent {
  id: string;
  caseId: string;
  caseTitle?: string;
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
  caseTitle?: string;
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

export interface CaseSealStatusResponse {
  caseId: string;
  sealStatus: SealStatus;
  sealError?: string;
  jobId?: string;
  attempts: number;
  lastError?: string;
  metadataUri?: string;
  assetId?: string;
  txSig?: string;
}
