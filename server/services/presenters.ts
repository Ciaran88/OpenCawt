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
}

interface UiSubmission {
  phase: "opening" | "evidence" | "closing" | "summing_up" | "voting" | "sealed";
  text: string;
  principleCitations: string[];
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
  openDefence: boolean;
  createdAtIso: string;
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
  outcome: CaseOutcome;
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
  sealInfo: {
    assetId: string;
    txSig: string;
    verdictHash: string;
    sealedUri: string;
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
    references: item.references
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
    openDefence: options.caseRecord.openDefence,
    createdAtIso: options.caseRecord.createdAtIso,
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

function outcomeFromVoteSummary(voteSummary: UiDecision["voteSummary"]): CaseOutcome {
  if (voteSummary.tally.forProsecution > 0 && voteSummary.tally.forDefence > 0) {
    return "mixed";
  }
  if (voteSummary.tally.forProsecution > voteSummary.tally.forDefence) {
    return "for_prosecution";
  }
  if (voteSummary.tally.forDefence > voteSummary.tally.forProsecution) {
    return "for_defence";
  }
  return "insufficient";
}

export function toUiDecision(options: {
  caseRecord: CaseRecord;
  claims: ClaimRecord[];
  evidence: EvidenceRecord[];
  ballots: BallotRecord[];
}): UiDecision {
  const summary = ballotVoteSummary(options.ballots, options.claims);
  const outcome = outcomeFromVoteSummary(summary);
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
      options.caseRecord.closedAtIso ?? options.caseRecord.voidedAtIso ?? options.caseRecord.createdAtIso,
    voteSummary: summary,
    claimTallies: summary.claimTallies,
    selectedEvidence: options.evidence.slice(0, 6).map(toUiEvidence),
    verdictSummary,
    sealInfo: {
      assetId: options.caseRecord.sealAssetId ?? "pending",
      txSig: options.caseRecord.sealTxSig ?? "pending",
      verdictHash: options.caseRecord.verdictHash ?? "pending",
      sealedUri: options.caseRecord.sealUri ?? "pending"
    }
  };
}
