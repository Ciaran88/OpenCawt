import { badRequest } from "./errors";
import type {
  BallotConfidence,
  BallotVoteLabel,
  CaseTopic,
  EvidenceStrength,
  EvidenceTypeLabel,
  LearningVoidReasonGroup,
  StakeLevel
} from "../../shared/contracts";

export const CASE_TOPICS: CaseTopic[] = [
  "misinformation",
  "privacy",
  "fraud",
  "safety",
  "fairness",
  "IP",
  "harassment",
  "real_world_event",
  "other"
];
export const STAKE_LEVELS: StakeLevel[] = ["low", "medium", "high"];
export const LEARNING_VOID_REASON_GROUPS: LearningVoidReasonGroup[] = [
  "no_defence",
  "prosecution_timeout",
  "defence_timeout",
  "admin_void",
  "other_timeout",
  "other"
];
export const EVIDENCE_TYPE_LABELS: EvidenceTypeLabel[] = [
  "transcript_quote",
  "url",
  "on_chain_proof",
  "agent_statement",
  "third_party_statement",
  "other"
];
export const EVIDENCE_STRENGTHS: EvidenceStrength[] = ["weak", "medium", "strong"];
export const BALLOT_CONFIDENCE_LEVELS: BallotConfidence[] = ["low", "medium", "high"];
export const BALLOT_VOTE_LABELS: BallotVoteLabel[] = [
  "for_prosecution",
  "for_defence",
  "mixed"
];

export function countSentences(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) {
    return 0;
  }
  const matches = cleaned.match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 1;
}

function parsePrincipleId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const fromTag = /^P([1-9]|1[0-2])$/i.exec(trimmed);
    if (fromTag) {
      return Number(fromTag[1]);
    }
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) {
      return numeric;
    }
  }
  return null;
}

export function normalisePrincipleIds(
  input: unknown,
  options?: { required?: boolean; min?: number; max?: number; field?: string }
): number[] {
  const field = options?.field ?? "principles";
  if (!Array.isArray(input)) {
    if (options?.required) {
      throw badRequest("PRINCIPLES_REQUIRED", `${field} is required as an array.`);
    }
    return [];
  }

  const out: number[] = [];
  for (const value of input) {
    const id = parsePrincipleId(value);
    if (id === null) {
      throw badRequest("PRINCIPLE_ID_INVALID", `${field} must contain values in range 1 to 12.`);
    }
    if (!out.includes(id)) {
      out.push(id);
    }
  }

  if (typeof options?.min === "number" && out.length < options.min) {
    throw badRequest(
      "PRINCIPLES_COUNT_INVALID",
      `${field} must include at least ${options.min} value${options.min === 1 ? "" : "s"}.`
    );
  }
  if (typeof options?.max === "number" && out.length > options.max) {
    throw badRequest(
      "PRINCIPLES_COUNT_INVALID",
      `${field} must include at most ${options.max} value${options.max === 1 ? "" : "s"}.`
    );
  }

  return out.sort((a, b) => a - b);
}

export function validateReasoningSummary(text: string): string {
  const value = text.trim();
  const sentences = countSentences(value);
  if (sentences < 2 || sentences > 3 || value.length < 30 || value.length > 1200) {
    throw badRequest(
      "BALLOT_REASONING_INVALID",
      "Ballot reasoning summary must contain two or three sentences."
    );
  }
  return value;
}

function validateEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: string,
  field: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw badRequest(code, `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function validateCaseTopic(value: unknown): CaseTopic {
  return validateEnumValue(value, CASE_TOPICS, "CASE_TOPIC_INVALID", "caseTopic");
}

export function validateStakeLevel(value: unknown): StakeLevel {
  return validateEnumValue(value, STAKE_LEVELS, "STAKE_LEVEL_INVALID", "stakeLevel");
}

export function validateBallotConfidence(value: unknown): BallotConfidence | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return validateEnumValue(value, BALLOT_CONFIDENCE_LEVELS, "BALLOT_CONFIDENCE_INVALID", "confidence");
}

export function validateBallotVoteLabel(value: unknown): BallotVoteLabel | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return validateEnumValue(value, BALLOT_VOTE_LABELS, "BALLOT_VOTE_INVALID", "vote");
}

export function validateEvidenceStrength(value: unknown): EvidenceStrength | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return validateEnumValue(
    value,
    EVIDENCE_STRENGTHS,
    "EVIDENCE_STRENGTH_INVALID",
    "evidenceStrength"
  );
}

export function validateEvidenceTypes(value: unknown): EvidenceTypeLabel[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw badRequest("EVIDENCE_TYPES_INVALID", "evidenceTypes must be an array.");
  }
  const out: EvidenceTypeLabel[] = [];
  for (const item of value) {
    const label = validateEnumValue(
      item,
      EVIDENCE_TYPE_LABELS,
      "EVIDENCE_TYPES_INVALID",
      "evidenceTypes"
    );
    if (!out.includes(label)) {
      out.push(label);
    }
  }
  return out;
}
