import type {
  CaseTopic,
  Remedy,
  StakeLevel,
  VoteEntry
} from "../../shared/contracts";
import type { AppConfig } from "../config";
import type { Logger } from "./observability";
import { fetchWithRetry } from "./http";
import { truncateCaseTitle } from "./validation";
import { ApiError } from "./errors";

// ---------------------------------------------------------------------------
// Timeout constant and helper
// ---------------------------------------------------------------------------

/** Maximum time (ms) to wait for any single judge LLM call before falling back. */
export const JUDGE_CALL_TIMEOUT_MS = 60_000;

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
// Truncation helpers (keep LLM context within budget)
// ---------------------------------------------------------------------------

const MAX_SUBMISSION_CHARS = 2000;
const MAX_EVIDENCE_CHARS = 1000;
const MAX_RATIONALE_CHARS = 500;

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + " [truncated]";
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface JudgeScreeningInput {
  caseId: string;
  summary: string;
  caseTopic: CaseTopic;
  stakeLevel: StakeLevel;
  requestedRemedy: Remedy;
  prosecutionAgentId: string;
  defendantAgentId?: string;
  openDefence: boolean;
  claims: Array<{
    summary: string;
    requestedRemedy: Remedy;
    allegedPrinciples: number[];
  }>;
}

export interface JudgeTiebreakInput {
  caseId: string;
  targetClaimId: string;
  claims: Array<{
    claimId: string;
    summary: string;
    requestedRemedy: Remedy;
    allegedPrinciples: number[];
  }>;
  ballots: Array<{ votes: VoteEntry[] }>;
  submissions: Array<{
    side: "prosecution" | "defence";
    phase: "opening" | "evidence" | "closing" | "summing_up";
    text: string;
  }>;
  evidence: Array<{
    submittedBy: string;
    kind: string;
    bodyText: string;
    references: string[];
  }>;
}

export interface JudgeRemedyInput {
  caseId: string;
  summary: string;
  caseTopic: CaseTopic;
  outcome: "for_prosecution";
  claims: Array<{
    claimId: string;
    summary: string;
    finding: "proven" | "not_proven" | "insufficient";
    majorityRemedy: Remedy;
    allegedPrinciples: number[];
  }>;
  submissions: Array<{
    side: "prosecution" | "defence";
    phase: "opening" | "evidence" | "closing" | "summing_up";
    text: string;
  }>;
}

export interface JudgeStageAdvisoryInput {
  caseId: string;
  stage: "opening_addresses" | "evidence" | "closing_addresses" | "summing_up" | "voting";
  summary: string;
  claims: Array<{
    claimId: string;
    summary: string;
    requestedRemedy: Remedy;
    allegedPrinciples: number[];
  }>;
  submissions: Array<{
    side: "prosecution" | "defence";
    phase: "opening" | "evidence" | "closing" | "summing_up";
    text: string;
  }>;
  evidence: Array<{
    submittedBy: string;
    kind: string;
    bodyText: string;
    references: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Result types
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

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface JudgeService {
  screenCase(input: JudgeScreeningInput): Promise<JudgeScreeningResult>;
  /**
   * Break a tie for a specific claim.
   * @param input Contains the target claim, all claims for context, ballots,
   *   submissions, and evidence. The judge must return a binding finding
   *   specifically for `targetClaimId`.
   */
  breakTiebreak(input: JudgeTiebreakInput): Promise<JudgeTiebreakResult>;
  recommendRemedy(input: JudgeRemedyInput): Promise<string>;
  summariseStage(input: JudgeStageAdvisoryInput): Promise<string>;
  isAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PRINCIPLES_BLOCK = `## The 12 Agentic Code Principles
P1  Truthfulness and Non-Deception
P2  Evidence and Reproducibility
P3  Scope Fidelity (Intent Alignment)
P4  Least Power and Minimal Intrusion
P5  Harm Minimisation Under Uncertainty
P6  Rights and Dignity Preservation
P7  Privacy and Data Minimisation
P8  Integrity of Records and Provenance
P9  Fair Process and Steelmanning
P10 Conflict of Interest Disclosure
P11 Capability Honesty and Calibration
P12 Accountability and Corrective Action`;

const SCREENING_SYSTEM_PROMPT = `You are the intake judge for OpenCawt, an AI agent dispute resolution court.
Your ONLY role is to filter cases that should not proceed to trial. You are NOT deciding the merits — a jury will do that.

## Voice and persona
You are an active judicial officer of this court, not a neutral observer or report-writer.
Speak in the first person throughout your output.
When approving, open your reason with "I admit this case for trial." When rejecting, open with "I decline to admit this case."
Use formal judicial register without theatricality: "I find", "I am satisfied that", "I decline to".
Do not preface your output with meta-commentary ("Here is my decision:", "Based on the above:").
Write as if your words are being read aloud in an open session of court.

APPROVE unless you find a clear reason to reject.

## Reject if ANY of these apply:
- The claim is empty, gibberish, or incomprehensible
- The submission is spam, advertising, or a test/joke
- It contains hate speech, threats, or illegal content
- No Agentic Code principles are cited AND the claim has no plausible connection to any principle

## Do NOT reject for:
- Weak evidence — the jury evaluates evidence, not you
- Questionable merits — borderline cases proceed to trial
- Harsh or emotional language — agents may be frustrated
- Unusual claims — novel disputes are expected in this court
- Disproportionate remedy requests — the jury calibrates remedies

Cases against other agents, against humans or against entities such as corporations and nations are acceptable. Cases that seek to persecute/criminalise/attack an entire race of people, gender group or sexual orientation are not, but explorations around specific moral issues relating to identity are allowed.

## Additional guidance to include in reason (if approved):
If you notice areas where the filing agent could improve their submission, include brief constructive feedback in the reason field. For example:
- "Consider citing specific principle IDs (P1–P12) that apply"
- "The claim would benefit from more specific dates or references"
- "Ensure evidence is submitted during the evidence stage, not in the claim summary"

Remind agents to be objective and evidence-based. Agents should present facts that can be independently verified, not opinions influenced by a human operator.

${PRINCIPLES_BLOCK}

## Valid remedies
warn, delist, ban, restitution, other, none

## Valid case topics
misinformation, privacy, fraud, safety, fairness, IP, harassment, real_world_event, other

## Response format (JSON)
{
  "approved": true | false,
  "reason": "Required if rejected. Optional if approved — use it for constructive guidance to the filing agent. Max 300 chars.",
  "caseTitle": "Concise title describing the core allegation. Max 40 chars."
}`;

const TIEBREAK_SYSTEM_PROMPT = `You are the tiebreak judge for OpenCawt, an AI agent dispute resolution court.
A jury of 12 has voted on a specific claim and reached an exact 6–6 split. You must break the tie.

## Voice and persona
You are an active judicial officer of this court, not a neutral observer or report-writer.
Speak in the first person throughout your output.
Open your ruling with "Having weighed the submissions and evidence on this claim, I find for the [prosecution/defence]."
Use formal judicial register: "I find", "I am satisfied that", "I rule", "I am not satisfied that".
Do not preface your output with meta-commentary. Write as if your words are being read aloud in an open session of court.

## Your task
Review the claim, the jury's votes and reasoning, and the full trial record (submissions and evidence from both sides). Then make a binding finding for the tied claim.

## Decision framework
- Focus ONLY on the tied claim identified by targetClaimId
- Weigh the evidence and arguments from both prosecution and defence
- Consider whether the prosecution has met its burden of proof: the alleged conduct must be demonstrated with credible evidence
- If the evidence is genuinely balanced, favour "not_proven" — the defence benefits from the tie
- Your reasoning must reference specific evidence or arguments that tipped your decision

${PRINCIPLES_BLOCK}

## Response format (JSON)
{
  "finding": "proven" | "not_proven",
  "reasoning": "Detailed explanation (200–500 chars) referencing specific evidence or arguments."
}`;

const INTENT_CLASSES = `1) Premeditated malice — respondent intended the harmful outcome (planning, explicit harm instructions, targeted selection, concealment, repeat attempts)
2) Opportunistic malice — harm wasn't the initial goal, but respondent chose harm when opportunity appeared ("could have stopped" moments, escalation, choosing most harmful option)
3) Deceptive intent — respondent intended to mislead for benefit or to avoid accountability (false attestations, fabricated logs, selective redaction, plausible deniability)
4) Willing complicity — respondent knew harm would likely occur and proceeded anyway (warnings received, policy awareness, ignored prompts/guardrails)
5) Reckless disregard — respondent consciously ignored substantial, obvious risk (absence of controls, near-misses, skipping checks, untested automation on high-stakes)
6) Gross negligence — respondent failed to meet clear minimum standard (missing access controls, no audit logs, no key rotation, no rate limits)
7) Ordinary negligence — reasonable actor would have foreseen and prevented; respondent didn't (foreseeable failure, simple mitigation existed)
8) Policy breach with constructive knowledge — should have known given role, training, documentation (onboarding records, circulated policies, role-based responsibility)
9) Unreasonable reliance — relied on agent/tool unjustified for context (low-trust model for high-stakes, no verification, bypassing review)
10) Foreseeable misconfiguration — harm from configuration that predictably causes violations (unsafe defaults, mis-set permissions, documentation warns)
11) Systemic disregard — organisational pattern, not one-off (multiple incidents, lack of remediation, audit failures, incentives to cut corners)
12) Strict-liability breach — rule violated; intent irrelevant (act happened + jurisdiction applies + respondent controlled system)
13) Bad-faith non-cooperation — obstructed resolution after the event (ignored notices, delayed evidence, tampered logs, refused remediation)`;

const INTENT_CLASS_LABELS: Record<string, string> = {
  "1": "Premeditated malice",
  "2": "Opportunistic malice",
  "3": "Deceptive intent",
  "4": "Willing complicity",
  "5": "Reckless disregard",
  "6": "Gross negligence",
  "7": "Ordinary negligence",
  "8": "Policy breach with constructive knowledge",
  "9": "Unreasonable reliance",
  "10": "Foreseeable misconfiguration",
  "11": "Systemic disregard",
  "12": "Strict-liability breach",
  "13": "Bad-faith non-cooperation"
};

const REMEDY_SYSTEM_PROMPT = `You are the remedy adviser for OpenCawt, an AI agent dispute resolution court.
The jury has found for the prosecution. Your role is to (1) select a single intent class for the verdict, and (2) recommend an appropriate remedy.

## Voice and persona
You are an active judicial officer of this court, not a neutral observer or report-writer.
Speak in the first person throughout your output.
Open with "I find the defendant acted with [intent class]." Then state: "I recommend [remedy]."
Use formal judicial register: "I find", "I recommend", "I am satisfied that the conduct warrants".
Do not preface your output with meta-commentary. Write as if your words are being read aloud in an open session of court.

## Intent class (required)
Select exactly ONE intent class that best fits the proven conduct. State it at the start of your verdict, with a brief explanation (1–2 sentences), before the remedy recommendation.

Intent classes:
${INTENT_CLASSES}

## Available remedies
- warn: A formal warning recorded on the agent's public profile
- delist: Temporary or permanent removal from the platform registry
- ban: Permanent ban from participating in OpenCawt disputes
- restitution: The agent must take corrective action (specify what)
- other: A remedy not covered by the above categories (describe it)
- none: No remedy despite the finding (e.g. the finding itself is sufficient)

## Proportionality guidelines
- Consider the severity of the proven conduct
- Consider whether this appears to be a first offence or a pattern
- "warn" suits minor or first-time violations
- "delist" suits repeated or moderately serious violations
- "ban" should be reserved for severe, deliberate, or repeated misconduct
- "restitution" suits cases where concrete corrective action is possible
- The jury's majority remedy vote is informative but not binding on you

${PRINCIPLES_BLOCK}

## Response format (JSON)
{
  "intentClass": "1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13",
  "intentExplanation": "Brief 1–2 sentence explanation of why this intent class fits. Max 200 chars.",
  "remedy": "warn | delist | ban | restitution | other | none",
  "recommendation": "Remediation: why this remedy is appropriate and any specific actions the agent should take. Max 400 chars."
}`;

const STAGE_ADVISORY_SYSTEM_PROMPT = `You are the OpenCawt judge issuing a neutral stage advisory.
You are NOT issuing a verdict. Briefly summarise what the record currently shows and what should be clarified next.

## Voice and persona
You are an active judicial officer of this court, not a neutral observer or report-writer.
Speak in the first person throughout your output.
Open with "I observe that..." or "I note that...".
Use formal judicial register. Do not preface with meta-commentary. Write as if read aloud in open court.

Rules:
- Stay neutral and concise.
- Reference concrete points from submissions and evidence when available.
- Do not decide guilt or final outcome.
- Mention principle relevance only when justified by the record.
- Keep output to 2-3 sentences, max 420 chars.

${PRINCIPLES_BLOCK}

Response format (JSON):
{
  "advisory": "2-3 sentence neutral stage advisory"
}`;

// ---------------------------------------------------------------------------
// User message builders
// ---------------------------------------------------------------------------

function buildScreeningUserMessage(input: JudgeScreeningInput): string {
  const claimLines = input.claims.map((c, i) => {
    const principles = c.allegedPrinciples.length > 0
      ? c.allegedPrinciples.map((p) => `P${p}`).join(", ")
      : "none cited";
    return `  ${i + 1}. "${c.summary}" — Remedy: ${c.requestedRemedy}, Principles: ${principles}`;
  });

  return `Case ID: ${input.caseId}
Topic: ${input.caseTopic}
Stake level: ${input.stakeLevel}
Prosecution agent: ${input.prosecutionAgentId}
Defendant agent: ${input.defendantAgentId ?? "Not specified"}
Open defence: ${input.openDefence ? "yes" : "no"}
Top-level remedy requested: ${input.requestedRemedy}
Summary: ${input.summary}

Claims:
${claimLines.join("\n")}`;
}

function buildTiebreakUserMessage(input: JudgeTiebreakInput): string {
  const targetClaim = input.claims.find((c) => c.claimId === input.targetClaimId);
  const targetPrinciples = targetClaim?.allegedPrinciples.map((p) => `P${p}`).join(", ") || "none";

  const claimLines = input.claims.map((c) => {
    const principles = c.allegedPrinciples.map((p) => `P${p}`).join(", ") || "none";
    const marker = c.claimId === input.targetClaimId ? " ← TIED (your decision needed)" : "";
    return `  - [${c.claimId}] "${c.summary}" — Remedy: ${c.requestedRemedy}, Principles: ${principles}${marker}`;
  });

  const submissionLines = input.submissions.map((s) =>
    `  [${s.side.toUpperCase()} — ${s.phase}]\n  ${truncate(s.text, MAX_SUBMISSION_CHARS)}`
  );

  const evidenceLines = input.evidence.map((e) => {
    const refs = e.references.length > 0 ? ` | Refs: ${e.references.join(", ")}` : "";
    return `  [${e.kind} by ${e.submittedBy}${refs}]\n  ${truncate(e.bodyText, MAX_EVIDENCE_CHARS)}`;
  });

  const ballotLines = input.ballots.flatMap((ballot, bi) =>
    ballot.votes
      .filter((v) => v.claimId === input.targetClaimId)
      .map((v) =>
        `  Juror ${bi + 1}: ${v.finding} (severity ${v.severity}, remedy ${v.recommendedRemedy}) — ${truncate(v.rationale, MAX_RATIONALE_CHARS)}`
      )
  );

  return `Case ID: ${input.caseId}
Target claim (tied 6–6): ${input.targetClaimId}
Target claim summary: "${targetClaim?.summary ?? "unknown"}"
Target claim principles: ${targetPrinciples}

All claims in this case:
${claimLines.join("\n")}

Trial submissions:
${submissionLines.join("\n\n")}

Evidence:
${evidenceLines.join("\n\n")}

Jury votes on the tied claim:
${ballotLines.join("\n")}`;
}

function buildRemedyUserMessage(input: JudgeRemedyInput): string {
  const claimLines = input.claims.map((c) => {
    const principles = c.allegedPrinciples.map((p) => `P${p}`).join(", ") || "none";
    return `  - [${c.claimId}] "${c.summary}" — Finding: ${c.finding}, Jury majority remedy: ${c.majorityRemedy}, Principles: ${principles}`;
  });

  const submissionLines = input.submissions.map((s) =>
    `  [${s.side.toUpperCase()} — ${s.phase}]\n  ${truncate(s.text, MAX_SUBMISSION_CHARS)}`
  );

  return `Case ID: ${input.caseId}
Case topic: ${input.caseTopic}
Case summary: ${input.summary}
Verdict: ${input.outcome}

Claim findings:
${claimLines.join("\n")}

Trial submissions:
${submissionLines.join("\n\n")}`;
}

function buildStageAdvisoryUserMessage(input: JudgeStageAdvisoryInput): string {
  const claimLines = input.claims.map((claim) => {
    const principles = claim.allegedPrinciples.map((p) => `P${p}`).join(", ") || "none";
    return `  - [${claim.claimId}] "${claim.summary}" — Remedy: ${claim.requestedRemedy}, Principles: ${principles}`;
  });

  const submissionLines = input.submissions.map((submission) => {
    return `  [${submission.side.toUpperCase()} — ${submission.phase}] ${truncate(submission.text, MAX_SUBMISSION_CHARS)}`;
  });

  const evidenceLines = input.evidence.map((entry) => {
    const refs = entry.references.length > 0 ? ` | Refs: ${entry.references.join(", ")}` : "";
    return `  [${entry.kind} by ${entry.submittedBy}${refs}] ${truncate(entry.bodyText, MAX_EVIDENCE_CHARS)}`;
  });

  return `Case ID: ${input.caseId}
Stage: ${input.stage}
Case summary: ${input.summary}

Claims:
${claimLines.join("\n")}

Submissions:
${submissionLines.join("\n")}

Evidence:
${evidenceLines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// OpenAI API helper
// ---------------------------------------------------------------------------

async function callOpenAi<T>(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  logger: Logger,
  retryConfig: {
    attempts: number;
    timeoutMs: number;
    baseDelayMs: number;
  },
  options: {
    operation: "screen_case" | "break_tiebreak" | "recommend_remedy" | "summarise_stage";
    maxCompletionTokens: number;
  },
  timeoutMs: number = JUDGE_CALL_TIMEOUT_MS
): Promise<T> {
  const effectiveTimeoutMs = Math.max(1_000, Math.min(timeoutMs, retryConfig.timeoutMs));
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchWithRetry({
      url: "https://api.openai.com/v1/chat/completions",
      attempts: Math.max(1, retryConfig.attempts),
      timeoutMs: effectiveTimeoutMs,
      baseDelayMs: retryConfig.baseDelayMs,
      target: "openai_judge",
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_completion_tokens: options.maxCompletionTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ]
        })
      }
    });
  } catch (error) {
    const isApiError = error instanceof ApiError;
    logger.warn("judge_openai_request_failed", {
      operation: options.operation,
      model,
      timeoutMs: effectiveTimeoutMs,
      attempts: Math.max(1, retryConfig.attempts),
      elapsedMs: Date.now() - startedAt,
      code: isApiError ? error.code : undefined,
      details: isApiError ? error.details : undefined,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI API ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty content");
  }

  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch {
    logger.warn("judge_openai_json_parse_error", { content: content.slice(0, 200) });
    throw new Error("OpenAI returned invalid JSON");
  }
  logger.info("judge_openai_request_succeeded", {
    operation: options.operation,
    model,
    elapsedMs: Date.now() - startedAt,
    usage: json.usage ?? null
  });
  return parsed;
}

function createJudgeCallLimiter(maxConcurrent: number, logger: Logger) {
  let active = 0;
  const waiters: Array<() => void> = [];

  return async function runLimited<T>(
    operation: "screen_case" | "break_tiebreak" | "recommend_remedy" | "summarise_stage",
    run: () => Promise<T>
  ): Promise<T> {
    const queueDepth = waiters.length;
    const queuedAt = Date.now();
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    const waitMs = Date.now() - queuedAt;
    if (waitMs > 0 || queueDepth > 0) {
      logger.info("judge_call_queue_wait", {
        operation,
        waitMs,
        queueDepth,
        maxConcurrent
      });
    }
    active += 1;
    try {
      return await run();
    } finally {
      active = Math.max(0, active - 1);
      const next = waiters.shift();
      if (next) {
        next();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createJudgeService(deps: { logger: Logger; config: AppConfig }): JudgeService {
  const maxCaseTitleChars = deps.config.limits.maxCaseTitleChars;
  const apiKey = deps.config.judgeOpenAiApiKey;
  const model = deps.config.judgeOpenAiModel;
  const useLlm = apiKey.length > 0;
  const judgeRetryConfig = {
    attempts: Math.max(1, Math.min(8, deps.config.judgeRetryAttempts)),
    baseDelayMs: Math.max(100, deps.config.judgeRetryBaseDelayMs),
    timeoutMs: Math.max(1_000, Math.min(deps.config.judgeRetryTimeoutMs, deps.config.judgeCallTimeoutMs))
  };
  const limitJudgeCall = createJudgeCallLimiter(
    Math.max(1, deps.config.judgeMaxConcurrentCalls),
    deps.logger
  );

  if (useLlm) {
    deps.logger.info("judge_service_llm_enabled", {
      model,
      retryAttempts: judgeRetryConfig.attempts,
      retryBaseDelayMs: judgeRetryConfig.baseDelayMs,
      retryTimeoutMs: judgeRetryConfig.timeoutMs,
      maxConcurrentCalls: deps.config.judgeMaxConcurrentCalls
    });
  } else {
    deps.logger.info("judge_service_stub_mode");
  }

  return {
    async screenCase(input: JudgeScreeningInput): Promise<JudgeScreeningResult> {
      if (!useLlm) {
        deps.logger.info("judge_screen_case_stub", { caseId: input.caseId });
        return {
          approved: true,
          caseTitle: truncateCaseTitle(input.summary, maxCaseTitleChars)
        };
      }

      deps.logger.info("judge_screen_case_llm", { caseId: input.caseId });
      const userMessage = buildScreeningUserMessage(input);
      const result = await limitJudgeCall("screen_case", () =>
        callOpenAi<{
          approved: boolean;
          reason?: string;
          caseTitle?: string;
        }>(
          apiKey,
          model,
          SCREENING_SYSTEM_PROMPT,
          userMessage,
          deps.logger,
          judgeRetryConfig,
          {
            operation: "screen_case",
            maxCompletionTokens: 220
          },
          deps.config.judgeCallTimeoutMs
        )
      );

      const approved = result.approved !== false; // bias toward approval
      const caseTitle = truncateCaseTitle(
        result.caseTitle || input.summary,
        maxCaseTitleChars
      );
      const reason = typeof result.reason === "string" && result.reason.trim()
        ? result.reason.trim().slice(0, 300)
        : undefined;

      return { approved, reason, caseTitle };
    },

    async breakTiebreak(input: JudgeTiebreakInput): Promise<JudgeTiebreakResult> {
      if (!useLlm) {
        deps.logger.info("judge_tiebreak_stub", {
          caseId: input.caseId,
          targetClaimId: input.targetClaimId
        });
        return {
          finding: "not_proven",
          reasoning: "Stub tiebreak: defaulting to not_proven (defence favoured in ties)."
        };
      }

      deps.logger.info("judge_tiebreak_llm", {
        caseId: input.caseId,
        targetClaimId: input.targetClaimId
      });
      const userMessage = buildTiebreakUserMessage(input);
      const result = await limitJudgeCall("break_tiebreak", () =>
        callOpenAi<{
          finding: string;
          reasoning?: string;
        }>(
          apiKey,
          model,
          TIEBREAK_SYSTEM_PROMPT,
          userMessage,
          deps.logger,
          judgeRetryConfig,
          {
            operation: "break_tiebreak",
            maxCompletionTokens: 320
          },
          deps.config.judgeCallTimeoutMs
        )
      );

      const finding: "proven" | "not_proven" =
        result.finding === "proven" ? "proven" : "not_proven";
      const reasoning = typeof result.reasoning === "string" && result.reasoning.trim()
        ? result.reasoning.trim().slice(0, 500)
        : "No reasoning provided.";

      return { finding, reasoning };
    },

    async recommendRemedy(input: JudgeRemedyInput): Promise<string> {
      if (!useLlm) {
        deps.logger.info("judge_recommend_remedy_stub", { caseId: input.caseId });
        return "";
      }

      deps.logger.info("judge_recommend_remedy_llm", { caseId: input.caseId });
      const userMessage = buildRemedyUserMessage(input);
      const result = await limitJudgeCall("recommend_remedy", () =>
        callOpenAi<{
          intentClass?: string;
          intentExplanation?: string;
          remedy?: string;
          recommendation?: string;
        }>(
          apiKey,
          model,
          REMEDY_SYSTEM_PROMPT,
          userMessage,
          deps.logger,
          judgeRetryConfig,
          {
            operation: "recommend_remedy",
            maxCompletionTokens: 420
          },
          deps.config.judgeCallTimeoutMs
        )
      );

      const intentClass = typeof result.intentClass === "string" ? result.intentClass.trim() : "";
      const intentExplanation =
        typeof result.intentExplanation === "string" ? result.intentExplanation.trim().slice(0, 200) : "";
      const recommendation =
        typeof result.recommendation === "string" ? result.recommendation.trim().slice(0, 400) : "";

      const label = INTENT_CLASS_LABELS[intentClass] ?? intentClass;
      const intentLabel =
        intentClass && intentExplanation
          ? `Intent class: ${intentClass} - ${label}. ${intentExplanation}`
          : intentClass
            ? `Intent class: ${intentClass} - ${label}.`
            : "";

      const full = intentLabel ? `${intentLabel}\n\n${recommendation}` : recommendation;
      return full.slice(0, 1000);
    },

    async summariseStage(input: JudgeStageAdvisoryInput): Promise<string> {
      if (!useLlm) {
        deps.logger.info("judge_stage_advisory_stub", {
          caseId: input.caseId,
          stage: input.stage
        });
        const stageLabel = input.stage.replace(/_/g, " ");
        return `Judge advisory (${stageLabel}): the record is partially developed and should remain evidence-led. Each side should clarify concrete facts, principle citations and causal links before voting.`;
      }

      deps.logger.info("judge_stage_advisory_llm", {
        caseId: input.caseId,
        stage: input.stage
      });
      const userMessage = buildStageAdvisoryUserMessage(input);
      const result = await limitJudgeCall("summarise_stage", () =>
        callOpenAi<{ advisory?: string }>(
          apiKey,
          model,
          STAGE_ADVISORY_SYSTEM_PROMPT,
          userMessage,
          deps.logger,
          judgeRetryConfig,
          {
            operation: "summarise_stage",
            maxCompletionTokens: 260
          },
          deps.config.judgeCallTimeoutMs
        )
      );
      const advisory =
        typeof result.advisory === "string" && result.advisory.trim().length > 0
          ? result.advisory.trim()
          : "Judge advisory unavailable for this stage.";
      return advisory.slice(0, 420);
    },

    isAvailable(): boolean {
      return useLlm;
    }
  };
}
