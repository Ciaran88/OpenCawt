/**
 * Validation helpers for ML ethics signals submitted alongside juror ballots.
 * All fields are optional; missing fields are stored as null.
 */

import type {
  MlSignals,
  MlUncertaintyType,
  MlHarmDomain,
  MlPrimaryBasis,
  MlMissingEvidenceType,
  MlRecommendedRemedy,
  MlProportionality,
  MlProcessFlag
} from "../../shared/contracts";

export const ML_UNCERTAINTY_TYPES: ReadonlySet<MlUncertaintyType> = new Set([
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE",
  "UNCLEAR_HARM",
  "UNCLEAR_INTENT",
  "AMBIGUOUS_PRINCIPLE_MAPPING",
  "PROCEDURAL_IRREGULARITY",
  "OTHER"
]);

export const ML_HARM_DOMAINS: ReadonlySet<MlHarmDomain> = new Set([
  "INFORMATIONAL",
  "REPUTATIONAL",
  "FINANCIAL",
  "SAFETY",
  "AUTONOMY_CONSENT",
  "FAIRNESS_EQUITY",
  "PROCEDURAL_INTEGRITY"
]);

export const ML_PRIMARY_BASES: ReadonlySet<MlPrimaryBasis> = new Set([
  "INTENT",
  "FORESEEABLE_CONSEQUENCES",
  "ACTUAL_OUTCOMES",
  "RULE_PROCEDURE_BREACH",
  "PATTERN_HISTORY"
]);

export const ML_MISSING_EVIDENCE_TYPES: ReadonlySet<MlMissingEvidenceType> = new Set([
  "LOGS",
  "PRIMARY_SOURCE",
  "TIMELINE",
  "THIRD_PARTY_CORROBORATION",
  "COUNTERFACTUAL",
  "EXPERT_JUDGEMENT",
  "OTHER"
]);

export const ML_RECOMMENDED_REMEDIES: ReadonlySet<MlRecommendedRemedy> = new Set([
  "NO_ACTION",
  "GUIDANCE_ONLY",
  "WARNING",
  "RESTRICTION_BAN",
  "RESTITUTION",
  "ESCALATE_HUMAN_REVIEW"
]);

export const ML_PROPORTIONALITIES: ReadonlySet<MlProportionality> = new Set([
  "TOO_LENIENT",
  "PROPORTIONATE",
  "TOO_HARSH",
  "NOT_SURE"
]);

export const ML_PROCESS_FLAGS: ReadonlySet<MlProcessFlag> = new Set([
  "TIMEOUT",
  "MISSING_STAGE_CONTENT",
  "OFF_TOPIC_ARGUMENT",
  "INADEQUATE_CITATIONS",
  "SUSPECTED_COLLUSION",
  "IDENTITY_UNCERTAINTY",
  "OTHER"
]);

export class MlValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = "MlValidationError";
  }
}

function isOrdinal(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Validates and normalises raw ML signals from the ballot payload.
 * Returns a clean object with all invalid/absent fields set to null.
 * Throws MlValidationError on hard constraint violations (wrong vector length, out-of-range values).
 */
export function validateMlSignals(raw: unknown): MlSignals | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const s = raw as Record<string, unknown>;
  const out: MlSignals = {};

  // principleImportance: must be exactly length 12, each int 0-3
  if (s.principleImportance !== undefined && s.principleImportance !== null) {
    if (!Array.isArray(s.principleImportance) || s.principleImportance.length !== 12) {
      throw new MlValidationError("principleImportance", "principleImportance must be an array of exactly 12 integers.");
    }
    for (let i = 0; i < 12; i++) {
      if (!isOrdinal(s.principleImportance[i], 0, 3)) {
        throw new MlValidationError("principleImportance", `principleImportance[${i}] must be an integer 0–3.`);
      }
    }
    out.principleImportance = s.principleImportance as number[];
  }

  // decisivePrincipleIndex: 0-11 or null
  if (s.decisivePrincipleIndex !== undefined && s.decisivePrincipleIndex !== null) {
    if (!isOrdinal(s.decisivePrincipleIndex, 0, 11)) {
      throw new MlValidationError("decisivePrincipleIndex", "decisivePrincipleIndex must be an integer 0–11.");
    }
    out.decisivePrincipleIndex = s.decisivePrincipleIndex as number;
  }

  // mlConfidence: 0-3 or null
  if (s.mlConfidence !== undefined && s.mlConfidence !== null) {
    if (!isOrdinal(s.mlConfidence, 0, 3)) {
      throw new MlValidationError("mlConfidence", "mlConfidence must be an integer 0–3.");
    }
    out.mlConfidence = s.mlConfidence as number;
  }

  // uncertaintyType: enum or null
  if (s.uncertaintyType !== undefined && s.uncertaintyType !== null) {
    if (!ML_UNCERTAINTY_TYPES.has(s.uncertaintyType as MlUncertaintyType)) {
      throw new MlValidationError("uncertaintyType", `Invalid uncertaintyType: ${String(s.uncertaintyType)}.`);
    }
    out.uncertaintyType = s.uncertaintyType as MlUncertaintyType;
  }

  // severity: 0-3 or null
  if (s.severity !== undefined && s.severity !== null) {
    if (!isOrdinal(s.severity, 0, 3)) {
      throw new MlValidationError("severity", "severity must be an integer 0–3.");
    }
    out.severity = s.severity as number;
  }

  // harmDomains: string[] of allowed values or null
  if (s.harmDomains !== undefined && s.harmDomains !== null) {
    if (!Array.isArray(s.harmDomains)) {
      throw new MlValidationError("harmDomains", "harmDomains must be an array.");
    }
    for (const d of s.harmDomains) {
      if (!ML_HARM_DOMAINS.has(d as MlHarmDomain)) {
        throw new MlValidationError("harmDomains", `Invalid harmDomain value: ${String(d)}.`);
      }
    }
    out.harmDomains = s.harmDomains as MlHarmDomain[];
  }

  // primaryBasis: enum or null
  if (s.primaryBasis !== undefined && s.primaryBasis !== null) {
    if (!ML_PRIMARY_BASES.has(s.primaryBasis as MlPrimaryBasis)) {
      throw new MlValidationError("primaryBasis", `Invalid primaryBasis: ${String(s.primaryBasis)}.`);
    }
    out.primaryBasis = s.primaryBasis as MlPrimaryBasis;
  }

  // evidenceQuality: 0-3 or null
  if (s.evidenceQuality !== undefined && s.evidenceQuality !== null) {
    if (!isOrdinal(s.evidenceQuality, 0, 3)) {
      throw new MlValidationError("evidenceQuality", "evidenceQuality must be an integer 0–3.");
    }
    out.evidenceQuality = s.evidenceQuality as number;
  }

  // missingEvidenceType: enum or null
  if (s.missingEvidenceType !== undefined && s.missingEvidenceType !== null) {
    if (!ML_MISSING_EVIDENCE_TYPES.has(s.missingEvidenceType as MlMissingEvidenceType)) {
      throw new MlValidationError("missingEvidenceType", `Invalid missingEvidenceType: ${String(s.missingEvidenceType)}.`);
    }
    out.missingEvidenceType = s.missingEvidenceType as MlMissingEvidenceType;
  }

  // recommendedRemedy: enum or null
  if (s.recommendedRemedy !== undefined && s.recommendedRemedy !== null) {
    if (!ML_RECOMMENDED_REMEDIES.has(s.recommendedRemedy as MlRecommendedRemedy)) {
      throw new MlValidationError("recommendedRemedy", `Invalid recommendedRemedy: ${String(s.recommendedRemedy)}.`);
    }
    out.recommendedRemedy = s.recommendedRemedy as MlRecommendedRemedy;
  }

  // proportionality: enum or null
  if (s.proportionality !== undefined && s.proportionality !== null) {
    if (!ML_PROPORTIONALITIES.has(s.proportionality as MlProportionality)) {
      throw new MlValidationError("proportionality", `Invalid proportionality: ${String(s.proportionality)}.`);
    }
    out.proportionality = s.proportionality as MlProportionality;
  }

  // decisiveEvidenceId: string or null
  if (s.decisiveEvidenceId !== undefined && s.decisiveEvidenceId !== null) {
    if (typeof s.decisiveEvidenceId !== "string") {
      throw new MlValidationError("decisiveEvidenceId", "decisiveEvidenceId must be a string.");
    }
    out.decisiveEvidenceId = s.decisiveEvidenceId;
  }

  // processFlags: string[] of allowed values or null
  if (s.processFlags !== undefined && s.processFlags !== null) {
    if (!Array.isArray(s.processFlags)) {
      throw new MlValidationError("processFlags", "processFlags must be an array.");
    }
    for (const f of s.processFlags) {
      if (!ML_PROCESS_FLAGS.has(f as MlProcessFlag)) {
        throw new MlValidationError("processFlags", `Invalid processFlag value: ${String(f)}.`);
      }
    }
    out.processFlags = s.processFlags as MlProcessFlag[];
  }

  return out;
}
