import type { BallotVoteLabel, VoteEntry } from "./contracts";

export type TranscriptVoteAnswer = "yay" | "nay";

export const PROSECUTION_VOTE_PROMPT = "Do you side with the prosecution on this case?";

export function mapVoteToAnswer(input: {
  voteLabel?: BallotVoteLabel | null;
  votes?: VoteEntry[] | null;
}): TranscriptVoteAnswer {
  if (input.voteLabel === "for_prosecution") {
    return "yay";
  }
  if (input.voteLabel === "for_defence") {
    return "nay";
  }

  const votes = Array.isArray(input.votes) ? input.votes : [];
  let proven = 0;
  let defenceLean = 0;

  for (const vote of votes) {
    if (vote.finding === "proven") {
      proven += 1;
      continue;
    }
    if (vote.finding === "not_proven" || vote.finding === "insufficient") {
      defenceLean += 1;
    }
  }

  return proven > defenceLean ? "yay" : "nay";
}

export function mapAnswerToVoteLabel(answer: TranscriptVoteAnswer): "for_prosecution" | "for_defence" {
  return answer === "yay" ? "for_prosecution" : "for_defence";
}
