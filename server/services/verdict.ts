import { canonicalJson } from "../../shared/canonicalJson";
import { canonicalHashHex } from "../../shared/hash";
import type { CaseOutcome, Remedy, VerdictBundle, VoteEntry } from "../../shared/contracts";

interface ClaimLike {
  claimId: string;
  requestedRemedy: Remedy;
}

interface BallotLike {
  votes: VoteEntry[];
  ballotHash: string;
}

interface VerdictInput {
  caseId: string;
  prosecutionAgentId: string;
  defenceAgentId?: string;
  closedAtIso: string;
  jurySize: number;
  claims: ClaimLike[];
  ballots: BallotLike[];
  evidenceHashes: string[];
  submissionHashes: string[];
  drandRound: number | null;
  drandRandomness: string | null;
  poolSnapshotHash: string | null;
}

function tallyClaimVotes(
  claimId: string,
  ballots: BallotLike[]
): {
  proven: number;
  notProven: number;
  insufficient: number;
  remedies: Remedy[];
} {
  const tally = {
    proven: 0,
    notProven: 0,
    insufficient: 0,
    remedies: [] as Remedy[]
  };

  for (const ballot of ballots) {
    const vote = ballot.votes.find((item) => item.claimId === claimId);
    if (!vote) {
      tally.insufficient += 1;
      continue;
    }

    if (vote.finding === "proven") {
      tally.proven += 1;
    } else if (vote.finding === "not_proven") {
      tally.notProven += 1;
    } else {
      tally.insufficient += 1;
    }

    tally.remedies.push(vote.recommendedRemedy ?? "none");
  }

  return tally;
}

function majorityFinding(tally: {
  proven: number;
  notProven: number;
  insufficient: number;
}): "proven" | "not_proven" | "insufficient" {
  if (tally.proven > tally.notProven && tally.proven > tally.insufficient) {
    return "proven";
  }
  if (tally.notProven > tally.proven && tally.notProven > tally.insufficient) {
    return "not_proven";
  }
  return "insufficient";
}

function majorityRemedy(remedies: Remedy[], fallback: Remedy): Remedy {
  if (remedies.length === 0) {
    return fallback;
  }

  const counts = new Map<Remedy, number>();
  for (const remedy of remedies) {
    counts.set(remedy, (counts.get(remedy) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => {
      if (a[1] !== b[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map((entry) => entry[0])[0];
}

function deriveOverallOutcome(
  findings: Array<"proven" | "not_proven" | "insufficient">
): CaseOutcome | null {
  const proven = findings.filter((item) => item === "proven").length;
  const notProven = findings.filter((item) => item === "not_proven").length;
  const total = findings.length;

  if (proven === total && total > 0) {
    return "for_prosecution";
  }

  if (notProven === total && total > 0) {
    return "for_defence";
  }

  return null;
}

export async function computeDeterministicVerdict(input: VerdictInput): Promise<{
  bundle: VerdictBundle;
  verdictHash: string;
  majoritySummary: string;
  overallOutcome: CaseOutcome | null;
  inconclusive: boolean;
}> {
  const claims = input.claims.map((claim) => {
    const tally = tallyClaimVotes(claim.claimId, input.ballots);
    const finding = majorityFinding(tally);
    return {
      claimId: claim.claimId,
      finding,
      voteTally: {
        proven: tally.proven,
        notProven: tally.notProven,
        insufficient: tally.insufficient
      },
      majorityRemedy: majorityRemedy(tally.remedies, claim.requestedRemedy)
    };
  });

  const overallOutcome = deriveOverallOutcome(claims.map((item) => item.finding));
  const inconclusive = overallOutcome === null;
  const overallRemedy =
    claims.map((item) => item.majorityRemedy).find((item) => item !== "none" && item !== "other") ??
    "none";

  const bundle: VerdictBundle = {
    caseId: input.caseId,
    createdAtIso: input.closedAtIso,
    closedAtIso: input.closedAtIso,
    parties: {
      prosecution: input.prosecutionAgentId,
      ...(input.defenceAgentId ? { defence: input.defenceAgentId } : {})
    },
    claims,
    overall: {
      jurySize: input.jurySize,
      votesReceived: input.ballots.length,
      ...(overallOutcome ? { outcome: overallOutcome } : {}),
      inconclusive,
      remedy: overallRemedy
    },
    integrity: {
      drandRound: input.drandRound,
      drandRandomness: input.drandRandomness,
      poolSnapshotHash: input.poolSnapshotHash,
      submissionHashes: [...new Set(input.submissionHashes)].sort(),
      evidenceHashes: [...new Set(input.evidenceHashes)].sort(),
      ballotHashes: [...new Set(input.ballots.map((item) => item.ballotHash))].sort()
    }
  };

  const verdictHash = await canonicalHashHex(bundle);

  const majoritySummary = inconclusive
    ? `Inconclusive verdict with ${input.ballots.length}/${input.jurySize} ballots recorded.`
    : `Outcome ${overallOutcome} with ${input.ballots.length}/${input.jurySize} ballots recorded.`;

  return {
    bundle,
    verdictHash,
    majoritySummary,
    overallOutcome,
    inconclusive
  };
}

export function deterministicBundleString(bundle: VerdictBundle): string {
  return canonicalJson(bundle);
}
