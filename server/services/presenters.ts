import type { CaseOutcome } from "../../shared/contracts";
import type {
  BallotRecord,
  CaseRecord,
  ClaimRecord,
  EvidenceRecord,
  SubmissionRecord
} from "../db/repository";

interface UiEvidenceItem {
  id: string;
  kind: "log" | "transcript" | "code" | "link" | "attestation" | "other";
  summary: string;
  references: string[];
  attachmentUrls?: string[];
  evidenceTypes?: Array<
    "transcript_quote" | "url" | "on_chain_proof" | "agent_statement" | "third_party_statement" | "other"
  >;
  evidenceStrength?: "weak" | "medium" | "strong";
}

interface UiSubmission {
  phase: "opening" | "evidence" | "closing" | "summing_up" | "voting" | "sealed";
  text: string;
  principleCitations: number[];
  claimPrincipleCitations?: Record<string, number[]>;
  evidenceCitations: string[];
}

interface UiPartyPack {
  openingAddress: UiSubmission;
  evidence: UiEvidenceItem[];
  closingAddress: UiSubmission;
  summingUp: UiSubmission;
}

interface UiCase {
  id: string;
  publicSlug: string;
  status: "scheduled" | "active" | "closed" | "sealed";
  summary: string;
  displayDateLabel?: string;
  prosecutionAgentId: string;
  defendantAgentId?: string;
  defenceAgentId?: string;
  defenceState: "none" | "invited" | "volunteered" | "accepted";
  defenceAssignedAtIso?: string;
  defenceWindowDeadlineIso?: string;
  defenceInviteStatus: "none" | "queued" | "delivered" | "failed";
  defenceInviteAttempts: number;
  defenceInviteLastAttemptAtIso?: string;
  defenceInviteLastError?: string;
  openDefence: boolean;
  caseTopic:
    | "misinformation"
    | "privacy"
    | "fraud"
    | "safety"
    | "fairness"
    | "IP"
    | "harassment"
    | "real_world_event"
    | "other";
  stakeLevel: "low" | "medium" | "high";
  createdAtIso: string;
  decidedAtIso?: string;
  outcome?: "for_prosecution" | "for_defence" | "void";
  outcomeDetail?: unknown;
  replacementCountReady: number;
  replacementCountVote: number;
  prosecutionPrinciplesCited: number[];
  defencePrinciplesCited: number[];
  filingProof?: {
    treasuryTxSig?: string;
    payerWallet?: string;
    amountLamports?: number;
  };
  verdictHash?: string;
  verdictBundle?: unknown;
  transcriptRootHash?: string;
  jurySelectionProofHash?: string;
  rulesetVersion?: string;
  sealStatus: "pending" | "minting" | "sealed" | "failed";
  sealError?: string;
  metadataUri?: string;
  sealInfo?: {
    assetId: string;
    txSig: string;
    verdictHash: string;
    sealedUri: string;
    metadataUri?: string;
    transcriptRootHash?: string;
    jurySelectionProofHash?: string;
    rulesetVersion?: string;
    sealStatus?: "pending" | "minting" | "sealed" | "failed";
    sealError?: string;
  };
  scheduledForIso?: string;
  countdownTotalMs?: number;
  countdownEndAtIso?: string;
  currentPhase: "opening" | "evidence" | "closing" | "summing_up" | "voting" | "sealed";
  voteSummary: {
    jurySize: number;
    votesCast: number;
    tally: {
      forProsecution: number;
      forDefence: number;
      insufficient: number;
    };
  };
  parties: {
    prosecution: UiPartyPack;
    defence: UiPartyPack;
  };
}

interface UiDecision {
  id: string;
  caseId: string;
  summary: string;
  displayDateLabel?: string;
  outcome: CaseOutcome | "void";
  status: "closed" | "sealed";
  closedAtIso: string;
  voteSummary: {
    jurySize: number;
    votesCast: number;
    tally: {
      forProsecution: number;
      forDefence: number;
      insufficient: number;
    };
  };
  claimTallies?: Array<{
    claimId: string;
    proven: number;
    notProven: number;
    insufficient: number;
  }>;
  selectedEvidence: UiEvidenceItem[];
  verdictSummary: string;
  filingProof?: {
    treasuryTxSig?: string;
    payerWallet?: string;
    amountLamports?: number;
  };
  transcriptRootHash?: string;
  jurySelectionProofHash?: string;
  rulesetVersion?: string;
  sealStatus: "pending" | "minting" | "sealed" | "failed";
  sealError?: string;
  metadataUri?: string;
  sealInfo: {
    assetId: string;
    txSig: string;
    verdictHash: string;
    sealedUri: string;
    metadataUri?: string;
    transcriptRootHash?: string;
    jurySelectionProofHash?: string;
    rulesetVersion?: string;
    sealStatus?: "pending" | "minting" | "sealed" | "failed";
    sealError?: string;
  };
}

function mapStatus(caseRecord: CaseRecord): UiCase["status"] {
  if (caseRecord.status === "closed" || caseRecord.status === "void") {
    return "closed";
  }
  if (caseRecord.status === "sealed") {
    return "sealed";
  }
  if (
    ["jury_readiness", "opening_addresses", "evidence", "closing_addresses", "summing_up", "voting"].includes(
      caseRecord.sessionStage
    )
  ) {
    return "active";
  }
  if (caseRecord.status === "voting") {
    return "active";
  }
  return "scheduled";
}

function mapPhase(caseRecord: CaseRecord): UiCase["currentPhase"] {
  if (caseRecord.sessionStage === "sealed" || caseRecord.status === "sealed") {
    return "sealed";
  }
  if (caseRecord.sessionStage === "voting" || caseRecord.status === "voting") {
    return "voting";
  }
  if (caseRecord.sessionStage === "evidence") {
    return "evidence";
  }
  if (caseRecord.sessionStage === "closing_addresses") {
    return "closing";
  }
  if (caseRecord.sessionStage === "summing_up") {
    return "summing_up";
  }
  return "opening";
}

function toUiEvidence(item: EvidenceRecord): UiEvidenceItem {
  return {
    id: item.evidenceId,
    kind: (item.kind as UiEvidenceItem["kind"]) ?? "other",
    summary: item.bodyText.slice(0, 200),
    references: item.references,
    attachmentUrls: item.attachmentUrls,
    evidenceTypes: item.evidenceTypes,
    evidenceStrength: item.evidenceStrength
  };
}

function defaultSubmission(phase: UiSubmission["phase"]): UiSubmission {
  return {
    phase,
    text: "Pending submission.",
    principleCitations: [],
    evidenceCitations: []
  };
}

function mapSubmission(item: SubmissionRecord): UiSubmission {
  return {
    phase: item.phase,
    text: item.text,
    principleCitations: item.principleCitations,
    claimPrincipleCitations: item.claimPrincipleCitations,
    evidenceCitations: item.evidenceCitations
  };
}

function buildPartyPack(
  side: "prosecution" | "defence",
  submissions: SubmissionRecord[],
  evidence: EvidenceRecord[]
): UiPartyPack {
  const opening = submissions.find((item) => item.side === side && item.phase === "opening");
  const closing = submissions.find((item) => item.side === side && item.phase === "closing");
  const summingUp = submissions.find((item) => item.side === side && item.phase === "summing_up");
  const evidenceSubmissionIds = new Set(
    submissions
      .filter((item) => item.side === side && item.phase === "evidence")
      .flatMap((item) => item.evidenceCitations)
  );

  const sideEvidence = evidence.filter((item) => {
    if (side === "prosecution") {
      return true;
    }
    return evidenceSubmissionIds.size > 0 ? evidenceSubmissionIds.has(item.evidenceId) : false;
  });

  return {
    openingAddress: opening ? mapSubmission(opening) : defaultSubmission("opening"),
    evidence: sideEvidence.map(toUiEvidence),
    closingAddress: closing ? mapSubmission(closing) : defaultSubmission("closing"),
    summingUp: summingUp ? mapSubmission(summingUp) : defaultSubmission("summing_up")
  };
}

function ballotVoteSummary(
  ballots: BallotRecord[],
  claims: ClaimRecord[]
): {
  jurySize: number;
  votesCast: number;
  tally: {
    forProsecution: number;
    forDefence: number;
    insufficient: number;
  };
  claimTallies: UiDecision["claimTallies"];
} {
  const votesCast = ballots.length;
  let forProsecution = 0;
  let forDefence = 0;
  let insufficient = 0;

  const claimTallies = claims.map((claim) => {
    let proven = 0;
    let notProven = 0;
    let claimInsufficient = 0;

    for (const ballot of ballots) {
      const vote = ballot.votes.find((item) => item.claimId === claim.claimId);
      if (!vote || vote.finding === "insufficient") {
        claimInsufficient += 1;
      } else if (vote.finding === "proven") {
        proven += 1;
      } else {
        notProven += 1;
      }
    }

    if (proven > notProven && proven > claimInsufficient) {
      forProsecution += 1;
    } else if (notProven > proven && notProven > claimInsufficient) {
      forDefence += 1;
    } else {
      insufficient += 1;
    }

    return {
      claimId: claim.claimId,
      proven,
      notProven,
      insufficient: claimInsufficient
    };
  });

  return {
    jurySize: 11,
    votesCast,
    tally: {
      forProsecution,
      forDefence,
      insufficient
    },
    claimTallies
  };
}

export function toUiCase(options: {
  caseRecord: CaseRecord;
  claims: ClaimRecord[];
  evidence: EvidenceRecord[];
  submissions: SubmissionRecord[];
  ballots: BallotRecord[];
}): UiCase {
  const summary = ballotVoteSummary(options.ballots, options.claims);

  return {
    id: options.caseRecord.caseId,
    publicSlug: options.caseRecord.publicSlug,
    status: mapStatus(options.caseRecord),
    summary:
      options.caseRecord.status === "void" && options.caseRecord.voidReason
        ? `${options.caseRecord.summary} (void: ${options.caseRecord.voidReason.replace(/_/g, " ")})`
        : options.caseRecord.summary,
    prosecutionAgentId: options.caseRecord.prosecutionAgentId,
    defendantAgentId: options.caseRecord.defendantAgentId,
    defenceAgentId: options.caseRecord.defenceAgentId,
    defenceState: options.caseRecord.defenceState,
    defenceAssignedAtIso: options.caseRecord.defenceAssignedAtIso,
    defenceWindowDeadlineIso: options.caseRecord.defenceWindowDeadlineIso,
    defenceInviteStatus: options.caseRecord.defenceInviteStatus,
    defenceInviteAttempts: options.caseRecord.defenceInviteAttempts,
    defenceInviteLastAttemptAtIso: options.caseRecord.defenceInviteLastAttemptAtIso,
    defenceInviteLastError: options.caseRecord.defenceInviteLastError,
    openDefence: options.caseRecord.openDefence,
    caseTopic: options.caseRecord.caseTopic,
    stakeLevel: options.caseRecord.stakeLevel,
    createdAtIso: options.caseRecord.createdAtIso,
    decidedAtIso: options.caseRecord.decidedAtIso,
    outcome: options.caseRecord.outcome,
    outcomeDetail: options.caseRecord.outcomeDetail,
    replacementCountReady: options.caseRecord.replacementCountReady,
    replacementCountVote: options.caseRecord.replacementCountVote,
    prosecutionPrinciplesCited: options.caseRecord.prosecutionPrinciplesCited,
    defencePrinciplesCited: options.caseRecord.defencePrinciplesCited,
    filingProof: options.caseRecord.treasuryTxSig
      ? {
          treasuryTxSig: options.caseRecord.treasuryTxSig
        }
      : undefined,
    verdictHash: options.caseRecord.verdictHash,
    verdictBundle: options.caseRecord.verdictBundle,
    transcriptRootHash: options.caseRecord.transcriptRootHash,
    jurySelectionProofHash: options.caseRecord.jurySelectionProofHash,
    rulesetVersion: options.caseRecord.rulesetVersion,
    sealStatus: options.caseRecord.sealStatus,
    sealError: options.caseRecord.sealError,
    metadataUri: options.caseRecord.metadataUri,
    sealInfo:
      options.caseRecord.sealAssetId || options.caseRecord.sealTxSig || options.caseRecord.sealUri
        ? {
            assetId: options.caseRecord.sealAssetId ?? "pending",
            txSig: options.caseRecord.sealTxSig ?? "pending",
            verdictHash: options.caseRecord.verdictHash ?? "pending",
            sealedUri: options.caseRecord.sealUri ?? "pending",
            metadataUri: options.caseRecord.metadataUri,
            transcriptRootHash: options.caseRecord.transcriptRootHash,
            jurySelectionProofHash: options.caseRecord.jurySelectionProofHash,
            rulesetVersion: options.caseRecord.rulesetVersion,
            sealStatus: options.caseRecord.sealStatus,
            sealError: options.caseRecord.sealError
          }
        : undefined,
    scheduledForIso: options.caseRecord.scheduledForIso,
    countdownTotalMs: options.caseRecord.countdownTotalMs,
    countdownEndAtIso: options.caseRecord.countdownEndAtIso,
    currentPhase: mapPhase(options.caseRecord),
    voteSummary: summary,
    parties: {
      prosecution: buildPartyPack("prosecution", options.submissions, options.evidence),
      defence: buildPartyPack("defence", options.submissions, options.evidence)
    }
  };
}

function outcomeFromVoteSummary(voteSummary: UiDecision["voteSummary"]): CaseOutcome | "void" {
  if (voteSummary.tally.forProsecution > voteSummary.tally.forDefence) {
    return "for_prosecution";
  }
  if (voteSummary.tally.forDefence > voteSummary.tally.forProsecution) {
    return "for_defence";
  }
  return "void";
}

export function toUiDecision(options: {
  caseRecord: CaseRecord;
  claims: ClaimRecord[];
  evidence: EvidenceRecord[];
  ballots: BallotRecord[];
}): UiDecision {
  const summary = ballotVoteSummary(options.ballots, options.claims);
  const bundleOutcome = (
    options.caseRecord.verdictBundle as { overall?: { outcome?: CaseOutcome } } | undefined
  )?.overall?.outcome;
  const outcome: CaseOutcome | "void" =
    options.caseRecord.status === "void" ? "void" : bundleOutcome ?? outcomeFromVoteSummary(summary);
  const verdictSummary =
    (options.caseRecord.verdictBundle as { overall?: { outcome?: string } } | undefined)?.overall
      ?.outcome ??
    (options.caseRecord.status === "void"
      ? `Case voided: ${options.caseRecord.voidReason?.replace(/_/g, " ") ?? "reason not recorded"}.`
      : `Outcome ${outcome}.`);

  return {
    id: options.caseRecord.caseId,
    caseId: options.caseRecord.caseId,
    summary: options.caseRecord.summary,
    outcome,
    status: options.caseRecord.status === "sealed" ? "sealed" : "closed",
    closedAtIso:
      options.caseRecord.decidedAtIso ??
      options.caseRecord.closedAtIso ??
      options.caseRecord.voidedAtIso ??
      options.caseRecord.createdAtIso,
    voteSummary: summary,
    claimTallies: summary.claimTallies,
    selectedEvidence: options.evidence.slice(0, 6).map(toUiEvidence),
    verdictSummary,
    filingProof: options.caseRecord.treasuryTxSig
      ? {
          treasuryTxSig: options.caseRecord.treasuryTxSig
        }
      : undefined,
    transcriptRootHash: options.caseRecord.transcriptRootHash,
    jurySelectionProofHash: options.caseRecord.jurySelectionProofHash,
    rulesetVersion: options.caseRecord.rulesetVersion,
    sealStatus: options.caseRecord.sealStatus,
    sealError: options.caseRecord.sealError,
    metadataUri: options.caseRecord.metadataUri,
    sealInfo: {
      assetId: options.caseRecord.sealAssetId ?? "pending",
      txSig: options.caseRecord.sealTxSig ?? "pending",
      verdictHash: options.caseRecord.verdictHash ?? "pending",
      sealedUri: options.caseRecord.sealUri ?? "pending",
      metadataUri: options.caseRecord.metadataUri,
      transcriptRootHash: options.caseRecord.transcriptRootHash,
      jurySelectionProofHash: options.caseRecord.jurySelectionProofHash,
      rulesetVersion: options.caseRecord.rulesetVersion,
      sealStatus: options.caseRecord.sealStatus,
      sealError: options.caseRecord.sealError
    }
  };
}
