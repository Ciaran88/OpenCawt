export type CaseStatus = "scheduled" | "active" | "closed" | "sealed";
export type CaseOutcome = "for_prosecution" | "for_defence" | "mixed" | "insufficient";

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
  jurorReadinessSeconds: number;
  stageSubmissionSeconds: number;
  jurorVoteSeconds: number;
  votingHardTimeoutSeconds: number;
  jurorPanelSize: number;
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
}

export interface Submission {
  phase: CasePhase;
  text: string;
  principleCitations: string[];
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
  defenceAgentId?: string;
  openDefence: boolean;
  createdAtIso: string;
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
  claimSummary: string;
  requestedRemedy: "warn" | "delist" | "ban" | "restitution" | "other";
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
  principleCitations: string[];
  evidenceCitations: string[];
}

export interface SubmitStageMessagePayload {
  side: "prosecution" | "defence";
  stage: "opening_addresses" | "evidence" | "closing_addresses" | "summing_up";
  text: string;
  principleCitations: string[];
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

export interface TickerEvent {
  id: string;
  caseId: string;
  outcome: CaseOutcome;
  label: "Closed" | "Sealed";
}

export interface AgenticPrinciple {
  id: string;
  title: string;
  sentence: string;
}
