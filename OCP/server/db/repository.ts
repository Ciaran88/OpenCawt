import type { Db } from "./sqlite";
import { nowIso } from "./sqlite";

// ---- Types ----

export interface OcpAgentRecord {
  agentId: string;
  pubkeyCurrent: string;
  pubkeyHistory: Array<{ pubkey: string; retiredAt: string }>;
  notifyUrl: string;
  status: "active" | "suspended";
  registeredAt: string;
  updatedAt: string;
}

export type AgreementStatus =
  | "pending"
  | "accepted"
  | "sealed"
  | "expired"
  | "cancelled";

export interface OcpAgreementRecord {
  proposalId: string;
  partyAAgentId: string;
  partyBAgentId: string;
  mode: "public" | "private";
  canonicalTerms: unknown;
  termsHash: string;
  agreementCode: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  sealedAt: string | null;
  status: AgreementStatus;
}

export interface OcpSignatureRecord {
  proposalId: string;
  party: "party_a" | "party_b";
  agentId: string;
  sig: string;
  signedAt: string;
}

export interface OcpReceiptRecord {
  proposalId: string;
  agreementCode: string;
  termsHash: string;
  mintAddress: string | null;
  txSig: string | null;
  metadataUri: string | null;
  sealedAt: string;
  mintStatus: "stub" | "minting" | "minted" | "failed";
  mintError: string | null;
}

export type DecisionType =
  | "ATTESTATION"
  | "MULTISIG_DECISION"
  | "APP_DECISION"
  | "AGREEMENT";

export type DecisionStatus = "draft" | "sealed" | "cancelled";

export interface OcpDecisionRecord {
  draftId: string;
  decisionType: DecisionType;
  mode: "public" | "private";
  subject: string;
  payloadHash: string;
  canonicalPayload: unknown;
  decisionCode: string | null;
  requiredSigners: number;
  status: DecisionStatus;
  initiatorAgentId: string;
  createdAt: string;
  sealedAt: string | null;
  idempotencyKey: string | null;
}

export interface OcpDecisionSignerRecord {
  draftId: string;
  agentId: string;
  addedAt: string;
}

export interface OcpDecisionSignatureRecord {
  draftId: string;
  agentId: string;
  sig: string;
  signedAt: string;
}

export interface OcpApiKeyRecord {
  keyId: string;
  agentId: string;
  keyHash: string;
  keyPrefix: string;
  label: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
}

// ---- Row mappers ----

interface AgentRow {
  agent_id: string;
  pubkey_current: string;
  pubkey_history: string;
  notify_url: string;
  status: string;
  registered_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): OcpAgentRecord {
  return {
    agentId: row.agent_id,
    pubkeyCurrent: row.pubkey_current,
    pubkeyHistory: JSON.parse(row.pubkey_history) as Array<{
      pubkey: string;
      retiredAt: string;
    }>,
    notifyUrl: row.notify_url,
    status: row.status as "active" | "suspended",
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
  };
}

interface AgreementRow {
  proposal_id: string;
  party_a_agent_id: string;
  party_b_agent_id: string;
  mode: string;
  canonical_terms: string;
  terms_hash: string;
  agreement_code: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  sealed_at: string | null;
  status: string;
}

function rowToAgreement(row: AgreementRow): OcpAgreementRecord {
  return {
    proposalId: row.proposal_id,
    partyAAgentId: row.party_a_agent_id,
    partyBAgentId: row.party_b_agent_id,
    mode: row.mode as "public" | "private",
    canonicalTerms: JSON.parse(row.canonical_terms) as unknown,
    termsHash: row.terms_hash,
    agreementCode: row.agreement_code,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    sealedAt: row.sealed_at,
    status: row.status as AgreementStatus,
  };
}

interface SignatureRow {
  proposal_id: string;
  party: string;
  agent_id: string;
  sig: string;
  signed_at: string;
}

function rowToSignature(row: SignatureRow): OcpSignatureRecord {
  return {
    proposalId: row.proposal_id,
    party: row.party as "party_a" | "party_b",
    agentId: row.agent_id,
    sig: row.sig,
    signedAt: row.signed_at,
  };
}

interface ReceiptRow {
  proposal_id: string;
  agreement_code: string;
  terms_hash: string;
  mint_address: string | null;
  tx_sig: string | null;
  metadata_uri: string | null;
  sealed_at: string;
  mint_status: string;
  mint_error: string | null;
}

function rowToReceipt(row: ReceiptRow): OcpReceiptRecord {
  return {
    proposalId: row.proposal_id,
    agreementCode: row.agreement_code,
    termsHash: row.terms_hash,
    mintAddress: row.mint_address,
    txSig: row.tx_sig,
    metadataUri: row.metadata_uri,
    sealedAt: row.sealed_at,
    mintStatus: row.mint_status as OcpReceiptRecord["mintStatus"],
    mintError: row.mint_error,
  };
}

interface DecisionRow {
  draft_id: string;
  decision_type: string;
  mode: string;
  subject: string;
  payload_hash: string;
  canonical_payload: string;
  decision_code: string | null;
  required_signers: number;
  status: string;
  initiator_agent_id: string;
  created_at: string;
  sealed_at: string | null;
  idempotency_key: string | null;
}

function rowToDecision(row: DecisionRow): OcpDecisionRecord {
  return {
    draftId: row.draft_id,
    decisionType: row.decision_type as DecisionType,
    mode: row.mode as "public" | "private",
    subject: row.subject,
    payloadHash: row.payload_hash,
    canonicalPayload: JSON.parse(row.canonical_payload) as unknown,
    decisionCode: row.decision_code,
    requiredSigners: row.required_signers,
    status: row.status as DecisionStatus,
    initiatorAgentId: row.initiator_agent_id,
    createdAt: row.created_at,
    sealedAt: row.sealed_at,
    idempotencyKey: row.idempotency_key,
  };
}

interface DecisionSignerRow {
  draft_id: string;
  agent_id: string;
  added_at: string;
}

function rowToDecisionSigner(row: DecisionSignerRow): OcpDecisionSignerRecord {
  return {
    draftId: row.draft_id,
    agentId: row.agent_id,
    addedAt: row.added_at,
  };
}

interface DecisionSigRow {
  draft_id: string;
  agent_id: string;
  sig: string;
  signed_at: string;
}

function rowToDecisionSig(row: DecisionSigRow): OcpDecisionSignatureRecord {
  return {
    draftId: row.draft_id,
    agentId: row.agent_id,
    sig: row.sig,
    signedAt: row.signed_at,
  };
}

interface ApiKeyRow {
  key_id: string;
  agent_id: string;
  key_hash: string;
  key_prefix: string;
  label: string;
  status: string;
  created_at: string;
  revoked_at: string | null;
}

function rowToApiKey(row: ApiKeyRow): OcpApiKeyRecord {
  return {
    keyId: row.key_id,
    agentId: row.agent_id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    label: row.label,
    status: row.status as "active" | "revoked",
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

// ---- Agent functions ----

export function upsertOcpAgent(
  db: Db,
  input: { agentId: string; notifyUrl: string }
): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO ocp_agents (agent_id, pubkey_current, pubkey_history, notify_url, status, registered_at, updated_at)
     VALUES (?, ?, '[]', ?, 'active', ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       notify_url = excluded.notify_url,
       updated_at = excluded.updated_at`
  ).run(input.agentId, input.agentId, input.notifyUrl, now, now);
}

export function getOcpAgent(db: Db, agentId: string): OcpAgentRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_agents WHERE agent_id = ?")
    .get(agentId) as AgentRow | undefined;
  return row ? rowToAgent(row) : null;
}

export function suspendOcpAgent(db: Db, agentId: string): void {
  db.prepare(
    "UPDATE ocp_agents SET status = 'suspended', updated_at = ? WHERE agent_id = ?"
  ).run(nowIso(), agentId);
}

export function unsuspendOcpAgent(db: Db, agentId: string): void {
  db.prepare(
    "UPDATE ocp_agents SET status = 'active', updated_at = ? WHERE agent_id = ?"
  ).run(nowIso(), agentId);
}

// ---- Agreement functions ----

export function createAgreement(
  db: Db,
  input: {
    proposalId: string;
    partyAAgentId: string;
    partyBAgentId: string;
    mode: "public" | "private";
    canonicalTermsJson: string;
    termsHash: string;
    agreementCode: string;
    expiresAtIso: string;
  }
): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO ocp_agreements
       (proposal_id, party_a_agent_id, party_b_agent_id, mode, canonical_terms,
        terms_hash, agreement_code, expires_at, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(
    input.proposalId,
    input.partyAAgentId,
    input.partyBAgentId,
    input.mode,
    input.canonicalTermsJson,
    input.termsHash,
    input.agreementCode,
    input.expiresAtIso,
    now
  );
}

export function getAgreement(
  db: Db,
  proposalId: string
): OcpAgreementRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_agreements WHERE proposal_id = ?")
    .get(proposalId) as AgreementRow | undefined;
  return row ? rowToAgreement(row) : null;
}

export function getAgreementByCode(
  db: Db,
  agreementCode: string
): OcpAgreementRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_agreements WHERE agreement_code = ?")
    .get(agreementCode) as AgreementRow | undefined;
  return row ? rowToAgreement(row) : null;
}

export function listAgreementsForAgent(
  db: Db,
  agentId: string,
  status?: string,
  limit = 50
): OcpAgreementRecord[] {
  const statusFilter =
    status && status !== "all" ? "AND status = ?" : "";
  const params: unknown[] = [agentId, agentId];
  if (status && status !== "all") params.push(status);
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT * FROM ocp_agreements
       WHERE (party_a_agent_id = ? OR party_b_agent_id = ?)
       ${statusFilter}
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(...params) as AgreementRow[];
  return rows.map(rowToAgreement);
}

export function markAgreementAccepted(db: Db, proposalId: string): void {
  db.prepare(
    "UPDATE ocp_agreements SET status = 'accepted', accepted_at = ? WHERE proposal_id = ?"
  ).run(nowIso(), proposalId);
}

export function markAgreementSealed(db: Db, proposalId: string): void {
  db.prepare(
    "UPDATE ocp_agreements SET status = 'sealed', sealed_at = ? WHERE proposal_id = ?"
  ).run(nowIso(), proposalId);
}

export function markAgreementExpired(db: Db, proposalId: string): void {
  db.prepare(
    "UPDATE ocp_agreements SET status = 'expired' WHERE proposal_id = ?"
  ).run(proposalId);
}

export function cancelAgreement(db: Db, proposalId: string): void {
  db.prepare(
    "UPDATE ocp_agreements SET status = 'cancelled' WHERE proposal_id = ? AND status = 'pending'"
  ).run(proposalId);
}

export function isTermsHashDuplicate(
  db: Db,
  partyAAgentId: string,
  partyBAgentId: string,
  termsHash: string
): boolean {
  const row = db
    .prepare(
      `SELECT proposal_id FROM ocp_agreements
       WHERE party_a_agent_id = ? AND party_b_agent_id = ? AND terms_hash = ?
       AND status NOT IN ('expired', 'cancelled')
       LIMIT 1`
    )
    .get(partyAAgentId, partyBAgentId, termsHash);
  return row !== undefined;
}

// ---- Signature functions ----

export function storeSignature(
  db: Db,
  input: {
    proposalId: string;
    party: "party_a" | "party_b";
    agentId: string;
    sig: string;
  }
): void {
  db.prepare(
    `INSERT INTO ocp_signatures (proposal_id, party, agent_id, sig, signed_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.proposalId, input.party, input.agentId, input.sig, nowIso());
}

export function getSignaturesForProposal(
  db: Db,
  proposalId: string
): OcpSignatureRecord[] {
  const rows = db
    .prepare("SELECT * FROM ocp_signatures WHERE proposal_id = ?")
    .all(proposalId) as SignatureRow[];
  return rows.map(rowToSignature);
}

// ---- Receipt functions ----

export function createReceipt(
  db: Db,
  input: {
    proposalId: string;
    agreementCode: string;
    termsHash: string;
    sealedAtIso: string;
  }
): void {
  db.prepare(
    `INSERT INTO ocp_receipts (proposal_id, agreement_code, terms_hash, sealed_at, mint_status)
     VALUES (?, ?, ?, ?, 'stub')`
  ).run(
    input.proposalId,
    input.agreementCode,
    input.termsHash,
    input.sealedAtIso
  );
}

export function updateReceiptMint(
  db: Db,
  proposalId: string,
  input: {
    mintAddress?: string;
    txSig?: string;
    metadataUri?: string;
    mintStatus: "stub" | "minting" | "minted" | "failed";
    mintError?: string;
  }
): void {
  db.prepare(
    `UPDATE ocp_receipts
     SET mint_address = ?, tx_sig = ?, metadata_uri = ?, mint_status = ?, mint_error = ?
     WHERE proposal_id = ?`
  ).run(
    input.mintAddress ?? null,
    input.txSig ?? null,
    input.metadataUri ?? null,
    input.mintStatus,
    input.mintError ?? null,
    proposalId
  );
}

export function getReceipt(
  db: Db,
  proposalId: string
): OcpReceiptRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_receipts WHERE proposal_id = ?")
    .get(proposalId) as ReceiptRow | undefined;
  return row ? rowToReceipt(row) : null;
}

export function getReceiptByCode(
  db: Db,
  agreementCode: string
): OcpReceiptRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_receipts WHERE agreement_code = ?")
    .get(agreementCode) as ReceiptRow | undefined;
  return row ? rowToReceipt(row) : null;
}

// ---- Notify log ----

export function logNotifyAttempt(
  db: Db,
  input: {
    logId: string;
    proposalId: string;
    agentId: string;
    event: string;
    eventId: string;
    attempt: number;
    status: "delivered" | "failed";
    statusCode?: number;
    error?: string;
    sentAtIso: string;
  }
): void {
  db.prepare(
    `INSERT INTO ocp_notify_log
       (log_id, proposal_id, agent_id, event, event_id, attempt, status, status_code, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.logId,
    input.proposalId,
    input.agentId,
    input.event,
    input.eventId,
    input.attempt,
    input.status,
    input.statusCode ?? null,
    input.error ?? null,
    input.sentAtIso
  );
}

// ---- Nonce functions (replay protection) ----

/** Returns true if the nonce was new and has been recorded; false if already used. */
export function insertNonceIfAbsent(
  db: Db,
  input: { agentId: string; nonce: string; windowSec: number }
): boolean {
  const now = new Date();
  const usedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.windowSec * 1000).toISOString();
  const result = db.prepare(
    `INSERT OR IGNORE INTO ocp_nonces (agent_id, nonce, used_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(input.agentId, input.nonce, usedAt, expiresAt);
  return result.changes === 1;
}

/** Prune expired nonces (called opportunistically). */
export function pruneExpiredNonces(db: Db): void {
  db.prepare("DELETE FROM ocp_nonces WHERE expires_at < ?").run(nowIso());
}

// ---- Decision functions ----

export function createDecision(
  db: Db,
  input: {
    draftId: string;
    decisionType: DecisionType;
    mode: "public" | "private";
    subject: string;
    payloadHash: string;
    canonicalPayloadJson: string;
    requiredSigners: number;
    initiatorAgentId: string;
    idempotencyKey?: string;
  }
): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO ocp_decisions
       (draft_id, decision_type, mode, subject, payload_hash, canonical_payload,
        required_signers, status, initiator_agent_id, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    input.draftId,
    input.decisionType,
    input.mode,
    input.subject,
    input.payloadHash,
    input.canonicalPayloadJson,
    input.requiredSigners,
    input.initiatorAgentId,
    now,
    input.idempotencyKey ?? null
  );
}

export function getDecision(db: Db, draftId: string): OcpDecisionRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_decisions WHERE draft_id = ?")
    .get(draftId) as DecisionRow | undefined;
  return row ? rowToDecision(row) : null;
}

export function getDecisionByCode(db: Db, decisionCode: string): OcpDecisionRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_decisions WHERE decision_code = ?")
    .get(decisionCode) as DecisionRow | undefined;
  return row ? rowToDecision(row) : null;
}

export function getDecisionByIdempotencyKey(
  db: Db,
  agentId: string,
  idempotencyKey: string
): OcpDecisionRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_decisions WHERE initiator_agent_id = ? AND idempotency_key = ?")
    .get(agentId, idempotencyKey) as DecisionRow | undefined;
  return row ? rowToDecision(row) : null;
}

export function addDecisionSigner(
  db: Db,
  input: { draftId: string; agentId: string }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO ocp_decision_signers (draft_id, agent_id, added_at)
     VALUES (?, ?, ?)`
  ).run(input.draftId, input.agentId, nowIso());
}

export function getDecisionSigners(db: Db, draftId: string): OcpDecisionSignerRecord[] {
  const rows = db
    .prepare("SELECT * FROM ocp_decision_signers WHERE draft_id = ?")
    .all(draftId) as DecisionSignerRow[];
  return rows.map(rowToDecisionSigner);
}

export function storeDecisionSignature(
  db: Db,
  input: { draftId: string; agentId: string; sig: string }
): void {
  db.prepare(
    `INSERT OR REPLACE INTO ocp_decision_signatures (draft_id, agent_id, sig, signed_at)
     VALUES (?, ?, ?, ?)`
  ).run(input.draftId, input.agentId, input.sig, nowIso());
}

export function getDecisionSignatures(db: Db, draftId: string): OcpDecisionSignatureRecord[] {
  const rows = db
    .prepare("SELECT * FROM ocp_decision_signatures WHERE draft_id = ?")
    .all(draftId) as DecisionSigRow[];
  return rows.map(rowToDecisionSig);
}

export function sealDecision(
  db: Db,
  draftId: string,
  decisionCode: string
): void {
  db.prepare(
    "UPDATE ocp_decisions SET status = 'sealed', sealed_at = ?, decision_code = ? WHERE draft_id = ?"
  ).run(nowIso(), decisionCode, draftId);
}

export function cancelDecision(db: Db, draftId: string): void {
  db.prepare(
    "UPDATE ocp_decisions SET status = 'cancelled' WHERE draft_id = ? AND status = 'draft'"
  ).run(draftId);
}

// ---- API key functions ----

export function createApiKey(
  db: Db,
  input: {
    keyId: string;
    agentId: string;
    keyHash: string;
    keyPrefix: string;
    label: string;
  }
): void {
  db.prepare(
    `INSERT INTO ocp_api_keys (key_id, agent_id, key_hash, key_prefix, label, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`
  ).run(input.keyId, input.agentId, input.keyHash, input.keyPrefix, input.label, nowIso());
}

export function getApiKeyByHash(db: Db, keyHash: string): OcpApiKeyRecord | null {
  const row = db
    .prepare("SELECT * FROM ocp_api_keys WHERE key_hash = ? AND status = 'active'")
    .get(keyHash) as ApiKeyRow | undefined;
  return row ? rowToApiKey(row) : null;
}

export function listApiKeysForAgent(db: Db, agentId: string): OcpApiKeyRecord[] {
  const rows = db
    .prepare("SELECT * FROM ocp_api_keys WHERE agent_id = ? ORDER BY created_at DESC")
    .all(agentId) as ApiKeyRow[];
  return rows.map(rowToApiKey);
}

export function revokeApiKey(db: Db, keyId: string, agentId: string): boolean {
  const result = db.prepare(
    "UPDATE ocp_api_keys SET status = 'revoked', revoked_at = ? WHERE key_id = ? AND agent_id = ? AND status = 'active'"
  ).run(nowIso(), keyId, agentId);
  return result.changes === 1;
}

// ---- Idempotency functions ----

export function getIdempotentResponse(
  db: Db,
  input: { idempotencyKey: string; agentId: string; endpoint: string }
): { status: number; body: unknown } | null {
  const row = db.prepare(
    "SELECT response_status, response_body FROM ocp_idempotency WHERE idem_key = ? AND agent_id = ? AND endpoint = ?"
  ).get(input.idempotencyKey, input.agentId, input.endpoint) as
    | { response_status: number; response_body: string }
    | undefined;
  if (!row) return null;
  return { status: row.response_status, body: JSON.parse(row.response_body) as unknown };
}

export function storeIdempotentResponse(
  db: Db,
  input: {
    idempotencyKey: string;
    agentId: string;
    endpoint: string;
    status: number;
    body: unknown;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO ocp_idempotency
       (idem_key, agent_id, endpoint, response_status, response_body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.idempotencyKey,
    input.agentId,
    input.endpoint,
    input.status,
    JSON.stringify(input.body),
    nowIso()
  );
}
