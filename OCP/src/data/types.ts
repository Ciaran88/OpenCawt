// ---- Request types ----

export interface RegisterOcpAgentPayload {
  agentId: string;
  notifyUrl: string;
}

export interface CanonicalParty {
  agentId: string;
  role: "party_a" | "party_b";
}

export interface CanonicalObligation {
  actorAgentId: string;
  action: string;
  deliverable: string;
  conditions?: string;
}

export interface CanonicalConsideration {
  fromAgentId: string;
  toAgentId: string;
  item: string;
  amount?: number;
  currency?: string;
  nonMonetary?: string;
}

export interface CanonicalTiming {
  startAtIso?: string;
  dueAtIso?: string;
  timezone?: string;
}

export interface CanonicalTermination {
  conditions?: string;
  noticePeriod?: string;
  breachRemedy?: string;
}

export interface CanonicalTerms {
  parties: CanonicalParty[];
  obligations: CanonicalObligation[];
  consideration: CanonicalConsideration[];
  timing: CanonicalTiming;
  termination: CanonicalTermination;
}

export interface ProposeAgreementPayload {
  partyBAgentId: string;
  mode: "public" | "private";
  terms: CanonicalTerms;
  expiresInHours: number;
  sigA: string;
}

export interface AcceptPayload {
  sigB: string;
}

export type DecisionType =
  | "ATTESTATION"
  | "MULTISIG_DECISION"
  | "APP_DECISION"
  | "AGREEMENT";

export interface DraftDecisionPayload {
  decisionType: DecisionType;
  mode: "public" | "private";
  subject: string;
  payload: unknown;
  signers: string[];
  requiredSigners?: number;
}

// ---- Response types ----

export interface OcpAgentResponse {
  agentId: string;
  notifyUrl: string;
  status: "active" | "suspended";
  registeredAt: string;
}

export interface ProposeAgreementResponse {
  proposalId: string;
  agreementCode: string;
  termsHash: string;
  expiresAtIso: string;
  status: "pending";
}

export interface ReceiptSummary {
  mintAddress: string | null;
  txSig: string | null;
  metadataUri: string | null;
  mintStatus: "stub" | "minting" | "minted" | "failed";
  sealedAt: string;
}

export interface OcpAgreementResponse {
  proposalId: string;
  partyAAgentId: string;
  partyBAgentId: string;
  mode: "public" | "private";
  termsHash: string;
  agreementCode: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  sealedAt: string | null;
  status: "pending" | "accepted" | "sealed" | "expired" | "cancelled";
  canonicalTerms: CanonicalTerms | null;
  receipt: ReceiptSummary | null;
}

export interface AcceptResponse {
  proposalId: string;
  agreementCode: string;
  termsHash: string;
  sealedAtIso: string;
  status: "sealed";
  receipt: ReceiptSummary | null;
}

export interface ListAgreementsResponse {
  agreements: OcpAgreementResponse[];
}

export interface VerifyResponse {
  agreementCode: string;
  termsHash: string;
  termsHashValid: boolean;
  sigAValid: boolean;
  sigBValid: boolean;
  overallValid: boolean;
  reason: string | null;
}

export interface OcpDecisionResponse {
  draftId: string;
  decisionCode: string | null;
  decisionType: DecisionType;
  mode: "public" | "private";
  subject: string;
  payloadHash: string;
  payload: unknown | null;
  requiredSigners: number;
  status: "draft" | "sealed" | "cancelled";
  initiatorAgentId: string;
  createdAt: string;
  sealedAt: string | null;
  signers: string[];
  signatures: Array<{ agentId: string; signedAt: string }>;
}

export interface DraftDecisionResponse {
  draftId: string;
  decisionType: DecisionType;
  mode: "public" | "private";
  subject: string;
  payloadHash: string;
  signers: string[];
  requiredSigners: number;
  status: "draft";
}

export interface OcpApiKeyResponse {
  keyId: string;
  agentId: string;
  keyPrefix: string;
  label: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateApiKeyResponse extends OcpApiKeyResponse {
  key: string; // returned only once on creation
}

export interface ListApiKeysResponse {
  keys: OcpApiKeyResponse[];
}

export interface CanonicaliseResponse {
  canonical: CanonicalTerms;
  canonicalJson: string;
  termsHash: string;
  agreementCode: string;
}

export interface ApiError {
  error: { code: string; message: string };
}
