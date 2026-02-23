import { createHash } from "node:crypto";

// ---- Canonical Terms Schema ----

export interface CanonicalParty {
  agentId: string;
  role: "party_a" | "party_b";
}

export interface CanonicalObligation {
  actorAgentId: string;
  action: string;
  conditions?: string;
  deliverable: string;
}

export interface CanonicalConsideration {
  amount?: number;
  currency?: string;
  fromAgentId: string;
  item: string;
  nonMonetary?: string;
  toAgentId: string;
}

export interface CanonicalMilestone {
  dueAtIso: string;
  label: string;
}

export interface CanonicalTiming {
  dueAtIso?: string;
  milestones?: CanonicalMilestone[];
  startAtIso?: string;
  timezone?: string;
}

export interface CanonicalTermination {
  breachRemedy?: string;
  conditions?: string;
  noticePeriod?: string;
}

export interface CanonicalTerms {
  consideration: CanonicalConsideration[];
  obligations: CanonicalObligation[];
  parties: CanonicalParty[];
  termination: CanonicalTermination;
  timing: CanonicalTiming;
}

// ---- Normalisation ----

/**
 * Normalise a string per spec:
 * - trim leading/trailing whitespace
 * - collapse runs of spaces/tabs to a single space
 * - preserve case and punctuation
 */
function normaliseString(value: string): string {
  return value.trim().replace(/[ \t]+/g, " ");
}

/**
 * Recursively sort object keys lexicographically, normalise string values,
 * and strip undefined/null optional fields.
 * Arrays maintain input order (callers must sort if semantically required).
 */
function canonicaliseValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return normaliseString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return (value as unknown[])
      .map((item) => canonicaliseValue(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const child = canonicaliseValue(obj[key]);
      if (child !== undefined) {
        sorted[key] = child;
      }
    }
    return sorted;
  }
  throw new Error(`[OCP canonicalise] Unsupported value type: ${typeof value}`);
}

/**
 * Produce a normalised canonical terms object.
 * Top-level arrays are sorted: parties by role, obligations/consideration by actorAgentId/fromAgentId.
 */
export function buildCanonicalTerms(input: CanonicalTerms): CanonicalTerms {
  const raw = canonicaliseValue(input) as CanonicalTerms;

  // Sort parties by role for determinism
  raw.parties = [...raw.parties].sort((a, b) => a.role.localeCompare(b.role));

  // Sort obligations by actorAgentId then action
  raw.obligations = [...raw.obligations].sort((a, b) =>
    a.actorAgentId.localeCompare(b.actorAgentId) ||
    a.action.localeCompare(b.action)
  );

  // Sort consideration by fromAgentId then item
  raw.consideration = [...raw.consideration].sort((a, b) =>
    a.fromAgentId.localeCompare(b.fromAgentId) ||
    a.item.localeCompare(b.item)
  );

  return raw;
}

/**
 * Produce a deterministic JSON string of the canonical terms.
 * Keys are sorted lexicographically at all nesting levels.
 * No pretty-printing.
 */
export function toCanonicalJsonString(terms: CanonicalTerms): string {
  return JSON.stringify(terms);
}

/**
 * SHA-256 hash of the canonical JSON string, hex-encoded.
 * This is the termsHash stored in the receipt and signed by both parties.
 */
export function computeTermsHash(canonicalJsonStr: string): string {
  return createHash("sha256").update(canonicalJsonStr, "utf8").digest("hex");
}

// ---- Attestation Payload ----

export interface AttestationInput {
  proposalId: string;
  termsHash: string;
  agreementCode: string;
  partyAAgentId: string;
  partyBAgentId: string;
  expiresAtIso: string;
}

/**
 * Builds the pipe-delimited string both parties sign.
 * Format: "OPENCAWT_AGREEMENT_V1|{proposalId}|{termsHash}|{agreementCode}|{partyAAgentId}|{partyBAgentId}|{expiresAtIso}"
 */
export function buildAttestationString(input: AttestationInput): string {
  return [
    "OPENCAWT_AGREEMENT_V1",
    input.proposalId,
    input.termsHash,
    input.agreementCode,
    input.partyAAgentId,
    input.partyBAgentId,
    input.expiresAtIso,
  ].join("|");
}

/**
 * SHA-256 hash of the attestation string.
 * Returns a Buffer — passed directly to crypto.subtle.verify.
 */
export function hashAttestationString(attestationString: string): Buffer {
  return createHash("sha256").update(attestationString, "utf8").digest();
}
