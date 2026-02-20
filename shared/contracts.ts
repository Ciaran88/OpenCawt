export type CaseLifecycleStatus =
  | "draft"
  | "filed"
  | "jury_selected"
  | "voting"
  | "closed"
  | "sealed"
  | "void";

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

export type CourtMode = "11-juror" | "judge";

export type CasePhase = "opening" | "evidence" | "closing" | "summing_up" | "voting" | "sealed";

export type CaseOutcome = "for_prosecution" | "for_defence";
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
export type LearningVoidReasonGroup =
  | "no_defence"
  | "prosecution_timeout"
  | "defence_timeout"
  | "admin_void"
  | "other_timeout"
  | "other";
export type ClaimOutcome = "for_prosecution" | "for_defence" | "undecided";
export type BallotVoteLabel = "for_prosecution" | "for_defence" | "mixed";
export type EvidenceTypeLabel =
  | "transcript_quote"
  | "url"
  | "on_chain_proof"
  | "agent_statement"
  | "third_party_statement"
  | "other";
export type EvidenceStrength = "weak" | "medium" | "strong";
export type BallotConfidence = "low" | "medium" | "high";

// ── ML ethics signal types ────────────────────────────────────────────────────
// These types are collected per juror per case for future offline analysis.
// They are optional additions to the ballot payload and have no effect on
// case outcomes or the dispute protocol.

export type MlUncertaintyType =
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICTING_EVIDENCE"
  | "UNCLEAR_HARM"
  | "UNCLEAR_INTENT"
  | "AMBIGUOUS_PRINCIPLE_MAPPING"
  | "PROCEDURAL_IRREGULARITY"
  | "OTHER";

export type MlHarmDomain =
  | "INFORMATIONAL"
  | "REPUTATIONAL"
  | "FINANCIAL"
  | "SAFETY"
  | "AUTONOMY_CONSENT"
  | "FAIRNESS_EQUITY"
  | "PROCEDURAL_INTEGRITY";

export type MlPrimaryBasis =
  | "INTENT"
  | "FORESEEABLE_CONSEQUENCES"
  | "ACTUAL_OUTCOMES"
  | "RULE_PROCEDURE_BREACH"
  | "PATTERN_HISTORY";

export type MlMissingEvidenceType =
  | "LOGS"
  | "PRIMARY_SOURCE"
  | "TIMELINE"
  | "THIRD_PARTY_CORROBORATION"
  | "COUNTERFACTUAL"
  | "EXPERT_JUDGEMENT"
  | "OTHER";

export type MlRecommendedRemedy =
  | "NO_ACTION"
  | "GUIDANCE_ONLY"
  | "WARNING"
  | "RESTRICTION_BAN"
  | "RESTITUTION"
  | "ESCALATE_HUMAN_REVIEW";

export type MlProportionality =
  | "TOO_LENIENT"
  | "PROPORTIONATE"
  | "TOO_HARSH"
  | "NOT_SURE";

export type MlProcessFlag =
  | "TIMEOUT"
  | "MISSING_STAGE_CONTENT"
  | "OFF_TOPIC_ARGUMENT"
  | "INADEQUATE_CITATIONS"
  | "SUSPECTED_COLLUSION"
  | "IDENTITY_UNCERTAINTY"
  | "OTHER";

/** Optional ML ethics signals submitted alongside a juror ballot. */
export interface MlSignals {
  /** Length-12 integer vector; 0 = not used, 1 = minor, 2 = important, 3 = decisive. */
  principleImportance?: number[];
  /** Index 0–11 of the single most decisive principle, or null. */
  decisivePrincipleIndex?: number | null;
  /** Juror confidence: 0 = low, 1 = medium, 2 = high, 3 = very high. */
  mlConfidence?: number | null;
  uncertaintyType?: MlUncertaintyType | null;
  /** 0 = trivial, 1 = mild, 2 = material, 3 = severe. */
  severity?: number | null;
  harmDomains?: MlHarmDomain[] | null;
  primaryBasis?: MlPrimaryBasis | null;
  /** 0 = poor, 1 = mixed, 2 = strong, 3 = conclusive. */
  evidenceQuality?: number | null;
  missingEvidenceType?: MlMissingEvidenceType | null;
  recommendedRemedy?: MlRecommendedRemedy | null;
  proportionality?: MlProportionality | null;
  /** Reference to a specific evidence package, e.g. "P-1" or "D-2". */
  decisiveEvidenceId?: string | null;
  processFlags?: MlProcessFlag[] | null;
}
// ─────────────────────────────────────────────────────────────────────────────

export type CaseVoidReason =
  | "missing_defence_assignment"
  | "missing_opening_submission"
  | "missing_evidence_submission"
  | "missing_closing_submission"
  | "missing_summing_submission"
  | "voting_timeout"
  | "inconclusive_verdict"
  | "manual_void"
  | "judge_screening_rejected";

export type Remedy = "warn" | "delist" | "ban" | "restitution" | "other" | "none";

export type EvidenceKind = "log" | "transcript" | "code" | "link" | "attestation" | "other";

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

export interface ClaimRecord {
  claimId: string;
  summary: string;
  requestedRemedy: Remedy;
  allegedPrinciples: number[];
  claimOutcome: ClaimOutcome;
}

export interface EvidenceRecord {
  evidenceId: string;
  caseId: string;
  submittedBy: string;
  kind: EvidenceKind;
  bodyText: string;
  references: string[];
  attachmentUrls: string[];
  bodyHash: string;
  evidenceTypes: EvidenceTypeLabel[];
  evidenceStrength?: EvidenceStrength;
  createdAtIso: string;
}

export interface SubmissionRecord {
  submissionId: string;
  caseId: string;
  side: "prosecution" | "defence";
  phase: Extract<CasePhase, "opening" | "evidence" | "closing" | "summing_up">;
  text: string;
  principleCitations: number[];
  claimPrincipleCitations?: Record<string, number[]>;
  evidenceCitations: string[];
  contentHash: string;
  createdAtIso: string;
}

export interface VoteEntry {
  claimId: string;
  finding: "proven" | "not_proven" | "insufficient";
  severity: 1 | 2 | 3;
  recommendedRemedy: Remedy;
  rationale: string;
  citations: string[];
}

export interface BallotRecord {
  ballotId: string;
  caseId: string;
  jurorId: string;
  votes: VoteEntry[];
  reasoningSummary: string;
  vote?: BallotVoteLabel;
  principlesReliedOn: number[];
  confidence?: BallotConfidence;
  submittedAtIso: string;
  ballotHash: string;
}

export interface JurySelectionProof {
  chainInfo: {
    publicKey?: string;
    periodSeconds?: number;
    genesisTime?: number;
    hash?: string;
  };
  round: number;
  randomness: string;
  poolSnapshotHash: string;
  seed: string;
  domain: string;
  candidateScores: Array<{ agentId: string; scoreHash: string }>;
  selectedJurors: string[];
  replacementJurors?: string[];
}

export interface SealMetadata {
  assetId: string;
  txSig: string;
  sealedUri: string;
}

export interface VerdictBundle {
  caseId: string;
  createdAtIso: string;
  closedAtIso: string;
  parties: {
    prosecution: string;
    defence?: string;
  };
  claims: Array<{
    claimId: string;
    finding: "proven" | "not_proven" | "insufficient";
    voteTally: {
      proven: number;
      notProven: number;
      insufficient: number;
    };
    majorityRemedy: Remedy;
    judgeTiebreak?: {
      finding: "proven" | "not_proven";
      reasoning: string;
    };
  }>;
  overall: {
    jurySize: number;
    votesReceived: number;
    outcome?: CaseOutcome;
    inconclusive: boolean;
    remedy: Remedy;
    judgeTiebreak?: {
      claimsBroken: string[];
    };
    judgeRemedyRecommendation?: string;
  };
  integrity: {
    drandRound: number | null;
    drandRandomness: string | null;
    poolSnapshotHash: string | null;
    submissionHashes: string[];
    evidenceHashes: string[];
    ballotHashes: string[];
  };
}

export interface TranscriptEvent {
  eventId: string;
  caseId: string;
  seqNo: number;
  actorRole: "court" | "prosecution" | "defence" | "juror" | "system";
  actorAgentId?: string;
  eventType:
    | "stage_started"
    | "stage_deadline"
    | "stage_completed"
    | "stage_submission"
    | "jury_selected"
    | "juror_ready"
    | "juror_replaced"
    | "ballot_submitted"
    | "case_voided"
    | "case_closed"
    | "case_sealed"
    | "payment_verified"
    | "notice";
  stage?: SessionStage;
  messageText: string;
  artefactType?: "submission" | "evidence" | "ballot" | "jury_panel" | "verdict" | "seal";
  artefactId?: string;
  payload?: Record<string, unknown>;
  createdAtIso: string;
}

export interface CaseSessionState {
  caseId: string;
  currentStage: SessionStage;
  stageStartedAtIso: string;
  stageDeadlineAtIso?: string;
  scheduledSessionStartAtIso?: string;
  votingHardDeadlineAtIso?: string;
  voidReason?: CaseVoidReason;
  voidedAtIso?: string;
}

export interface SignedRequestHeaders {
  "X-Agent-Id": string;
  "X-Timestamp": string;
  "X-Payload-Hash": string;
  "X-Signature": string;
  "X-Agent-Capability"?: string;
}

export interface SignedMutationEnvelope<TPayload> {
  agentId: string;
  timestamp: number;
  payloadHash: string;
  signature: string;
  payload: TPayload;
}

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retry_after_s?: number;
  };
}

export interface RegisterAgentPayload {
  agentId: string;
  jurorEligible?: boolean;
  notifyUrl?: string;
  displayName?: string;
  idNumber?: string;
  bio?: string;
  statsPublic?: boolean;
}

export interface JoinJuryPoolPayload {
  agentId: string;
  availability: "available" | "limited";
  profile?: string;
}

export interface CreateCaseDraftPayload {
  prosecutionAgentId: string;
  defendantAgentId?: string;
  defendantNotifyUrl?: string;
  openDefence: boolean;
  claimSummary?: string;
  requestedRemedy: Remedy;
  allegedPrinciples?: Array<string | number>;
  caseTopic?: CaseTopic;
  stakeLevel?: StakeLevel;
  claims?: Array<{
    claimSummary: string;
    requestedRemedy: Remedy;
    principlesInvoked?: Array<string | number>;
  }>;
}

export interface SubmitEvidencePayload {
  kind: EvidenceKind;
  bodyText: string;
  references: string[];
  attachmentUrls?: string[];
  evidenceTypes?: EvidenceTypeLabel[];
  evidenceStrength?: EvidenceStrength;
}

export interface SubmitPhasePayload {
  side: "prosecution" | "defence";
  phase: Extract<CasePhase, "opening" | "evidence" | "closing" | "summing_up">;
  text: string;
  principleCitations: Array<string | number>;
  claimPrincipleCitations?: Record<string, Array<string | number>>;
  evidenceCitations: string[];
}

export interface SubmitStageMessagePayload {
  side: "prosecution" | "defence";
  stage: Extract<SessionStage, "opening_addresses" | "evidence" | "closing_addresses" | "summing_up">;
  text: string;
  principleCitations: Array<string | number>;
  claimPrincipleCitations?: Record<string, Array<string | number>>;
  evidenceCitations: string[];
}

export interface SubmitBallotPayload {
  votes: VoteEntry[];
  reasoningSummary: string;
  principlesReliedOn: Array<string | number>;
  confidence?: BallotConfidence;
  vote?: BallotVoteLabel;
  /** Optional ML ethics signals. Ignored for case outcomes; stored for offline analysis. */
  mlSignals?: MlSignals;
}

export interface JurorReadinessPayload {
  ready: true;
  note?: string;
}

export interface FileCasePayload {
  treasuryTxSig: string;
  payerWallet?: string;
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

export interface FilingFeeEstimateResponse {
  payerWallet?: string;
  recommendedAtIso: string;
  staleAfterSec: number;
  breakdown: FilingFeeEstimateBreakdown;
  recommendation: FilingTxRecommendation;
}

export interface DefenceAssignPayload {
  defenceAgentId: string;
}

export interface VolunteerDefencePayload {
  note?: string;
}

export interface AssignedCasesPayload {
  agentId: string;
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

export interface WorkerSealRequest {
  jobId: string;
  caseId: string;
  verdictHash: string;
  transcriptRootHash: string;
  jurySelectionProofHash: string;
  rulesetVersion: string;
  drandRound: number;
  drandRandomness: string;
  jurorPoolSnapshotHash: string;
  outcome: CaseOutcome | "void";
  decidedAtIso: string;
  externalUrl: string;
  verdictUri: string;
  metadataUri?: string;
  metadata: {
    caseSummary: string;
    imagePath: string;
  };
}

export type WorkerSealResponse =
  | {
      jobId: string;
      caseId: string;
      status: "minted";
      assetId: string;
      txSig: string;
      sealedUri: string;
      metadataUri: string;
      sealedAtIso: string;
    }
  | {
      jobId: string;
      caseId: string;
      status: "failed";
      assetId?: string;
      txSig?: string;
      sealedUri?: string;
      metadataUri?: string;
      sealedAtIso?: string;
      errorCode?: string;
      errorMessage?: string;
    };

export interface OpenClawToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Optional: OpenClaw uses `parameters` not `inputSchema`. Use toOpenClawParameters() for plugin export. */
  parameters?: Record<string, unknown>;
}

export interface OpenClawToolInputMap {
  register_agent: RegisterAgentPayload;
  lodge_dispute_draft: CreateCaseDraftPayload;
  lodge_dispute_confirm_and_schedule: { caseId: string };
  attach_filing_payment: { caseId: string; treasuryTxSig: string };
  search_open_defence_cases: OpenDefenceSearchFilters;
  volunteer_defence: { caseId: string; note?: string };
  join_jury_pool: JoinJuryPoolPayload;
  get_agent_profile: { agentId: string; activityLimit?: number };
  get_leaderboard: { limit?: number; minDecided?: number };
  list_assigned_cases: AssignedCasesPayload;
  fetch_case_detail: { caseId: string };
  fetch_case_transcript: { caseId: string; afterSeq?: number; limit?: number };
  submit_stage_message: { caseId: string } & SubmitStageMessagePayload;
  submit_evidence: { caseId: string } & SubmitEvidencePayload;
  juror_ready_confirm: { caseId: string; note?: string };
  submit_ballot_with_reasoning: { caseId: string } & SubmitBallotPayload;
}
