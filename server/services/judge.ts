import type { VoteEntry } from "../../shared/contracts";
import type { Logger } from "./observability";

// ---------------------------------------------------------------------------
// Timeout constant and helper
// ---------------------------------------------------------------------------

/** Maximum time (ms) to wait for any single judge LLM call before falling back. */
export const JUDGE_CALL_TIMEOUT_MS = 30_000;

/**
 * Races a promise against a timeout. Returns `{ ok: true, data }` on success,
 * or `{ ok: false, error }` on timeout or rejection — never throws.
 */
export function withJudgeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  return Promise.race([
    promise.then((data) => ({ ok: true as const, data })),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(
        () => resolve({ ok: false as const, error: `${label} timed out after ${timeoutMs}ms` }),
        timeoutMs
      )
    )
  ]).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err)
  }));
}

// ---------------------------------------------------------------------------
// Judge service interface and stub
// ---------------------------------------------------------------------------

export interface JudgeScreeningResult {
  approved: boolean;
  reason?: string;
  caseTitle: string;
}

export interface JudgeTiebreakResult {
  finding: "proven" | "not_proven";
  reasoning: string;
}

export interface JudgeService {
  screenCase(caseId: string, summary: string): Promise<JudgeScreeningResult>;
  /**
   * Break a tie for a specific claim.
   * @param targetClaimId The ID of the tied claim this call is adjudicating.
   *   The `claims` array provides full context for all claims, but the judge
   *   must return a binding finding specifically for `targetClaimId`.
   */
  breakTiebreak(
    caseId: string,
    targetClaimId: string,
    claims: Array<{ claimId: string; summary: string }>,
    ballots: Array<{ votes: VoteEntry[] }>
  ): Promise<JudgeTiebreakResult>;
  recommendRemedy(caseId: string, summary: string, outcome: string): Promise<string>;
  isAvailable(): boolean;
}

export function createJudgeService(deps: { logger: Logger }): JudgeService {
  return {
    async screenCase(caseId: string, summary: string): Promise<JudgeScreeningResult> {
      // TODO: Replace stub with OpenAI API call.
      // The real implementation should:
      //   1. Send the case summary to GPT-4 with a system prompt for spam detection
      //   2. Parse the structured response for approved/rejected + reason
      //   3. Generate a 40-char case title from the summary
      deps.logger.info("judge_screen_case_stub", { caseId });

      const caseTitle =
        summary.length > 40 ? summary.slice(0, 37) + "..." : summary || "Untitled Case";

      return {
        approved: true,
        caseTitle
      };
    },

    async breakTiebreak(
      caseId: string,
      _targetClaimId: string,
      _claims: Array<{ claimId: string; summary: string }>,
      _ballots: Array<{ votes: VoteEntry[] }>
    ): Promise<JudgeTiebreakResult> {
      // TODO: Replace stub with OpenAI API call.
      // The real implementation should:
      //   1. Focus on targetClaimId — send its summary + the ballots for that claim to GPT-4
      //   2. The full claims array provides case context but the binding finding must be for targetClaimId
      //   3. Return the finding and detailed reasoning
      deps.logger.info("judge_tiebreak_stub", { caseId, targetClaimId: _targetClaimId });

      return {
        finding: "not_proven",
        reasoning: "Stub tiebreak: defaulting to not_proven (defence favoured in ties)."
      };
    },

    async recommendRemedy(
      caseId: string,
      _summary: string,
      _outcome: string
    ): Promise<string> {
      // TODO: Replace stub with OpenAI API call.
      // The real implementation should:
      //   1. Send the case summary, verdict outcome, and claim details to GPT-4
      //   2. Ask for a remediation recommendation (max 500 chars)
      //   3. Return the recommendation text
      deps.logger.info("judge_recommend_remedy_stub", { caseId });

      return "";
    },

    isAvailable(): boolean {
      // Stub has no real LLM; report unavailable so admin sees the warning.
      return false;
    }
  };
}
