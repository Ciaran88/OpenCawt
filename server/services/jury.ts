import { canonicalJson } from "../../shared/canonicalJson";
import { sha256Hex } from "../../shared/hash";
import type { JurySelectionProof } from "../../shared/contracts";
import type { DrandRoundData } from "./drand";
import { badRequest } from "./errors";

const JURY_DOMAIN = "OpenCawtJuryV1";

export interface JurySelectionInput {
  caseId: string;
  eligibleJurorIds: string[];
  drand: DrandRoundData;
  jurySize: number;
}

export interface JurySelectionResult {
  selectedJurors: string[];
  scoredCandidates: Array<{ agentId: string; scoreHash: string }>;
  poolSnapshotHash: string;
  seed: string;
  proof: JurySelectionProof;
}

export async function selectJuryDeterministically(
  input: JurySelectionInput
): Promise<JurySelectionResult> {
  const unique = [...new Set(input.eligibleJurorIds)].sort();
  if (unique.length < input.jurySize) {
    throw badRequest("INSUFFICIENT_JURORS", "Not enough eligible jurors to seat a panel.", {
      required: input.jurySize,
      available: unique.length
    });
  }

  const poolSnapshotHash = await sha256Hex(canonicalJson(unique));
  const seed = await sha256Hex(`${input.drand.randomness}|${input.caseId}|${JURY_DOMAIN}`);

  const scoredCandidates = await Promise.all(
    unique.map(async (agentId) => ({
      agentId,
      scoreHash: await sha256Hex(`${seed}|${agentId}`)
    }))
  );

  scoredCandidates.sort((a, b) => {
    if (a.scoreHash < b.scoreHash) {
      return -1;
    }
    if (a.scoreHash > b.scoreHash) {
      return 1;
    }
    return a.agentId.localeCompare(b.agentId);
  });

  const selectedJurors = scoredCandidates.slice(0, input.jurySize).map((item) => item.agentId);

  const proof: JurySelectionProof = {
    chainInfo: input.drand.chainInfo,
    round: input.drand.round,
    randomness: input.drand.randomness,
    poolSnapshotHash,
    seed,
    domain: JURY_DOMAIN,
    candidateScores: scoredCandidates,
    selectedJurors
  };

  return {
    selectedJurors,
    scoredCandidates,
    poolSnapshotHash,
    seed,
    proof
  };
}

export function pickReplacementFromProof(
  proof: JurySelectionProof,
  excludedAgentIds: Set<string>
): { agentId: string; scoreHash: string } | null {
  for (const candidate of proof.candidateScores) {
    if (!excludedAgentIds.has(candidate.agentId)) {
      return {
        agentId: candidate.agentId,
        scoreHash: candidate.scoreHash
      };
    }
  }
  return null;
}

export function withReplacementInProof(
  proof: JurySelectionProof,
  replacementJurorId: string
): JurySelectionProof {
  const replacements = [...(proof.replacementJurors ?? [])];
  if (!replacements.includes(replacementJurorId)) {
    replacements.push(replacementJurorId);
  }
  return {
    ...proof,
    replacementJurors: replacements
  };
}
