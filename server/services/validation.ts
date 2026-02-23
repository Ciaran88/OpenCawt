import { lookup } from "node:dns/promises";
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
const MAX_EVIDENCE_ATTACHMENT_URLS = 8;
const MAX_EVIDENCE_ATTACHMENT_URL_LENGTH = 2048;
const MAX_NOTIFY_URL_LENGTH = 2048;
const HTTPS_DEFAULT_PORT = "443";

type HostResolution = {
  address: string;
  family: number;
};

type HostResolver = (hostname: string) => Promise<HostResolution[]>;

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

export function validateClaimSummary(text: string, maxChars: number): string {
  const value = text.trim();
  if (value.length > maxChars) {
    throw badRequest(
      "CLAIM_SUMMARY_TOO_LONG",
      `Claim summary must not exceed ${maxChars} characters.`
    );
  }
  return value;
}

export function truncateCaseTitle(text: string, maxChars: number): string {
  const value = (text ?? "").trim();
  if (!value) {
    return "Untitled Case";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars - 3) + "...";
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

function parseIpv4Octets(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (value < 0 || value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
}

function normaliseHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

function isBlockedIpv4(octets: number[]): boolean {
  if (octets[0] === 10) {
    return true;
  }
  if (octets[0] === 127) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }
  if (octets[0] >= 224 && octets[0] <= 239) {
    return true;
  }
  return octets[0] === 0;
}

function isBlockedIpv6(hostname: string): boolean {
  const value = normaliseHost(hostname);
  if (value === "::1" || value === "::") {
    return true;
  }

  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mappedIpv4) {
    const mappedOctets = parseIpv4Octets(mappedIpv4[1]);
    return mappedOctets ? isBlockedIpv4(mappedOctets) : false;
  }

  const firstHextetMatch = /^([0-9a-f]{1,4})/i.exec(value);
  if (!firstHextetMatch) {
    return false;
  }

  const firstHextet = Number.parseInt(firstHextetMatch[1], 16);
  if (Number.isNaN(firstHextet)) {
    return false;
  }

  if ((firstHextet & 0xfe00) === 0xfc00) {
    return true;
  }
  if ((firstHextet & 0xffc0) === 0xfe80) {
    return true;
  }
  return (firstHextet & 0xff00) === 0xff00;
}

function isBlockedHostLiteral(hostname: string): boolean {
  const value = normaliseHost(hostname);
  if (!value) {
    return true;
  }

  if (value === "localhost" || value.endsWith(".localhost") || value === "::1") {
    return true;
  }

  const octets = parseIpv4Octets(value);
  if (octets) {
    return isBlockedIpv4(octets);
  }
  return value.includes(":") ? isBlockedIpv6(value) : false;
}

function isBlockedResolvedIp(address: string): boolean {
  const value = normaliseHost(address);
  const octets = parseIpv4Octets(value);
  if (octets) {
    return isBlockedIpv4(octets);
  }
  return value.includes(":") ? isBlockedIpv6(value) : false;
}

const defaultHostResolver: HostResolver = async (hostname) => {
  const entries = await lookup(hostname, {
    all: true,
    verbatim: true
  });
  return entries.map((entry) => ({
    address: entry.address,
    family: entry.family
  }));
};

function validateHttpsUrl(
  value: string,
  inputLabel: string,
  errorCodes: {
    invalid: string;
    schemeInvalid: string;
    hostBlocked: string;
    portInvalid?: string;
  },
  maxLength: number
): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw badRequest(
      errorCodes.invalid,
      `${inputLabel} must be 1 to ${maxLength} characters.`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw badRequest(errorCodes.invalid, `${inputLabel} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw badRequest(errorCodes.schemeInvalid, `${inputLabel} must use https.`);
  }
  if (parsed.port && parsed.port !== HTTPS_DEFAULT_PORT && errorCodes.portInvalid) {
    throw badRequest(errorCodes.portInvalid, `${inputLabel} must use port 443.`);
  }
  if (isBlockedHostLiteral(parsed.hostname)) {
    throw badRequest(
      errorCodes.hostBlocked,
      `${inputLabel} cannot target localhost or private network hosts.`
    );
  }
  return parsed.toString();
}

async function assertDnsSafeHost(
  parsed: URL,
  field: string,
  resolveHost: HostResolver
): Promise<void> {
  const hostname = normaliseHost(parsed.hostname);
  if (!hostname || parseIpv4Octets(hostname) || hostname.includes(":")) {
    return;
  }

  let resolved: HostResolution[];
  try {
    resolved = await resolveHost(hostname);
  } catch {
    throw badRequest(
      "NOTIFY_URL_DNS_RESOLUTION_FAILED",
      `${field} hostname could not be resolved.`
    );
  }
  if (!resolved.length) {
    throw badRequest(
      "NOTIFY_URL_DNS_RESOLUTION_FAILED",
      `${field} hostname could not be resolved.`
    );
  }

  for (const entry of resolved) {
    if (isBlockedResolvedIp(entry.address)) {
      throw badRequest(
        "NOTIFY_URL_HOST_BLOCKED_RESOLVED",
        `${field} resolves to localhost or a private network host.`
      );
    }
  }
}

export async function validateNotifyUrl(
  value: unknown,
  field = "notifyUrl",
  resolveHost: HostResolver = defaultHostResolver
): Promise<string | undefined> {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badRequest("NOTIFY_URL_INVALID", `${field} must be a URL string.`);
  }
  const normalised = validateHttpsUrl(
    value,
    field,
    {
      invalid: "NOTIFY_URL_INVALID",
      schemeInvalid: "NOTIFY_URL_SCHEME_INVALID",
      hostBlocked: "NOTIFY_URL_HOST_BLOCKED",
      portInvalid: "NOTIFY_URL_PORT_INVALID"
    },
    MAX_NOTIFY_URL_LENGTH
  );
  await assertDnsSafeHost(new URL(normalised), field, resolveHost);
  return normalised;
}

export function validateEvidenceAttachmentUrls(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw badRequest(
      "EVIDENCE_ATTACHMENT_URLS_INVALID",
      "attachmentUrls must be an array of absolute URLs."
    );
  }

  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw badRequest(
        "EVIDENCE_ATTACHMENT_URLS_INVALID",
        "attachmentUrls must contain URL strings."
      );
    }
    const normalised = validateHttpsUrl(
      item,
      "attachmentUrls",
      {
        invalid: "EVIDENCE_ATTACHMENT_URLS_INVALID",
        schemeInvalid: "EVIDENCE_ATTACHMENT_URL_SCHEME_INVALID",
        hostBlocked: "EVIDENCE_ATTACHMENT_URL_HOST_BLOCKED"
      },
      MAX_EVIDENCE_ATTACHMENT_URL_LENGTH
    );
    if (!out.includes(normalised)) {
      out.push(normalised);
      if (out.length > MAX_EVIDENCE_ATTACHMENT_URLS) {
        throw badRequest(
          "EVIDENCE_ATTACHMENT_LIMIT_REACHED",
          `At most ${MAX_EVIDENCE_ATTACHMENT_URLS} attachment URLs are allowed per evidence item.`
        );
      }
    }
  }

  return out;
}
