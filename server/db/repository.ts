import type {
  AgentActivityEntry,
  AgentProfile,
  AgentStats,
  AssignedCaseSummary,
  BallotConfidence,
  BallotVoteLabel,
  CaseSessionState,
  CaseTopic,
  CaseOutcome,
  CaseVoidReason,
  ClaimOutcome,
  CreateCaseDraftPayload,
  DefenceInviteStatus,
  DefenceInviteSummary,
  DefenceState,
  EvidenceStrength,
  EvidenceTypeLabel,
  JurySelectionProof,
  LeaderboardEntry,
  LearningVoidReasonGroup,
  MlSignals,
  OpenDefenceCaseSummary,
  OpenDefenceSearchFilters,
  Remedy,
  SessionStage,
  StakeLevel,
  SubmitBallotPayload,
  TranscriptEvent,
  VoteEntry,
  WorkerSealRequest,
  WorkerSealResponse
} from "../../shared/contracts";
import { canonicalJson } from "../../shared/canonicalJson";
import { createCaseId, createId, createSlug } from "../../shared/ids";
import type { Db } from "./sqlite";
import { nowIso } from "./sqlite";

function parseJson<T>(value: string | null): T {
  if (!value) {
    throw new Error("Missing JSON value.");
  }
  return JSON.parse(value) as T;
}

function maybeJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normaliseSerializable(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normaliseSerializable(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) {
        continue;
      }
      out[key] = normaliseSerializable(nested);
    }
    return out;
  }
  return String(value);
}

function oneDayAgoIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function oneWeekAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function toLearningVoidReasonGroup(reason?: CaseVoidReason): LearningVoidReasonGroup {
  if (reason === "missing_defence_assignment") {
    return "no_defence";
  }
  if (
    reason === "missing_opening_submission" ||
    reason === "missing_evidence_submission" ||
    reason === "missing_closing_submission" ||
    reason === "missing_summing_submission"
  ) {
    return "other_timeout";
  }
  if (reason === "manual_void") {
    return "admin_void";
  }
  if (reason === "voting_timeout") {
    return "other_timeout";
  }
  return "other";
}

function normalisePrincipleId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const fromP = /^P([1-9]|1[0-2])$/i.exec(trimmed);
    if (fromP) {
      return Number(fromP[1]);
    }
    const asNum = Number(trimmed);
    if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 12) {
      return asNum;
    }
  }
  return null;
}

function normalisePrincipleIds(values: unknown): number[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const out: number[] = [];
  for (const value of values) {
    const id = normalisePrincipleId(value);
    if (id !== null && !out.includes(id)) {
      out.push(id);
    }
  }
  return out.sort((a, b) => a - b);
}

export interface CaseRecord {
  caseId: string;
  publicSlug: string;
  status: string;
  sessionStage: SessionStage;
  prosecutionAgentId: string;
  defendantAgentId?: string;
  defenceAgentId?: string;
  defenceState: DefenceState;
  defenceAssignedAtIso?: string;
  defenceWindowDeadlineIso?: string;
  defenceInviteStatus: DefenceInviteStatus;
  defenceInviteAttempts: number;
  defenceInviteLastAttemptAtIso?: string;
  defenceInviteLastError?: string;
  openDefence: boolean;
  caseTopic: CaseTopic;
  stakeLevel: StakeLevel;
  summary: string;
  requestedRemedy: Remedy;
  createdAtIso: string;
  filedAtIso?: string;
  jurySelectedAtIso?: string;
  sessionStartedAtIso?: string;
  closedAtIso?: string;
  sealedAtIso?: string;
  voidReason?: CaseVoidReason;
  voidReasonGroup?: LearningVoidReasonGroup;
  voidedAtIso?: string;
  decidedAtIso?: string;
  outcome?: CaseOutcome | "void";
  outcomeDetail?: unknown;
  replacementCountReady: number;
  replacementCountVote: number;
  treasuryTxSig?: string;
  prosecutionPrinciplesCited: number[];
  defencePrinciplesCited: number[];
  scheduledForIso?: string;
  countdownEndAtIso?: string;
  countdownTotalMs?: number;
  drandRound?: number;
  drandRandomness?: string;
  poolSnapshotHash?: string;
  selectionProof?: JurySelectionProof;
  verdictHash?: string;
  transcriptRootHash?: string;
  jurySelectionProofHash?: string;
  rulesetVersion: string;
  sealStatus: "pending" | "minting" | "sealed" | "failed";
  sealError?: string;
  metadataUri?: string;
  verdictBundle?: unknown;
  sealAssetId?: string;
  sealTxSig?: string;
  sealUri?: string;
  filingWarning?: string;
  defendantNotifyUrl?: string;
}

export interface ClaimRecord {
  claimId: string;
  caseId: string;
  summary: string;
  requestedRemedy: Remedy;
  allegedPrinciples: number[];
  claimOutcome: ClaimOutcome;
}

export interface SubmissionRecord {
  submissionId: string;
  caseId: string;
  side: "prosecution" | "defence";
  phase: "opening" | "evidence" | "closing" | "summing_up";
  text: string;
  principleCitations: number[];
  claimPrincipleCitations?: Record<string, number[]>;
  evidenceCitations: string[];
  contentHash: string;
  createdAtIso: string;
}

export interface EvidenceRecord {
  evidenceId: string;
  caseId: string;
  submittedBy: string;
  kind: string;
  bodyText: string;
  references: string[];
  attachmentUrls: string[];
  bodyHash: string;
  evidenceTypes: EvidenceTypeLabel[];
  evidenceStrength?: EvidenceStrength;
  createdAtIso: string;
}

export interface BallotRecord {
  ballotId: string;
  caseId: string;
  jurorId: string;
  votes: VoteEntry[];
  reasoningSummary: string;
  vote?: BallotVoteLabel;
  principlesReliedOn: number[];
  confidence?: BallotConfidence;
  ballotHash: string;
  signature: string;
  createdAtIso: string;
}

export interface JuryPanelMemberRecord {
  caseId: string;
  jurorId: string;
  scoreHash: string;
  memberStatus:
    | "pending_ready"
    | "ready"
    | "timed_out"
    | "replaced"
    | "active_voting"
    | "voted";
  readyDeadlineAtIso?: string;
  readyConfirmedAtIso?: string;
  votingDeadlineAtIso?: string;
  replacementOfJurorId?: string;
  replacedByJurorId?: string;
  selectionRunId?: string;
  createdAtIso: string;
}

export interface IdempotencyRecord {
  responseStatus: number;
  responseJson: unknown;
  requestHash: string;
}

export interface AgentCapabilityRecord {
  tokenHash: string;
  agentId: string;
  scope: string;
  revokedAtIso?: string;
  expiresAtIso?: string;
  createdAtIso: string;
}

export interface DefenceClaimResult {
  status:
    | "assigned_accepted"
    | "assigned_volunteered"
    | "already_taken"
    | "defence_cannot_be_prosecution"
    | "not_open"
    | "reserved_for_named_defendant"
    | "window_closed";
  caseRecord: CaseRecord;
}

export function upsertAgent(
  db: Db,
  agentId: string,
  jurorEligible = true,
  notifyUrl?: string,
  profile?: { displayName?: string; idNumber?: string; bio?: string; statsPublic?: boolean }
): void {
  const now = nowIso();
  db.prepare(
    `
    INSERT INTO agents (agent_id, juror_eligible, notify_url, display_name, id_number, bio, stats_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      juror_eligible = excluded.juror_eligible,
      notify_url = COALESCE(excluded.notify_url, agents.notify_url),
      display_name = COALESCE(excluded.display_name, agents.display_name),
      id_number = COALESCE(excluded.id_number, agents.id_number),
      bio = COALESCE(excluded.bio, agents.bio),
      stats_public = CASE WHEN excluded.display_name IS NOT NULL OR excluded.bio IS NOT NULL THEN excluded.stats_public ELSE agents.stats_public END,
      updated_at = excluded.updated_at
    `
  ).run(
    agentId,
    jurorEligible ? 1 : 0,
    notifyUrl ?? null,
    profile?.displayName ?? null,
    profile?.idNumber ?? null,
    profile?.bio ?? null,
    profile?.statsPublic !== false ? 1 : 0,
    now,
    now
  );
}

export function getAgent(
  db: Db,
  agentId: string
): { agentId: string; banned: boolean; jurorEligible: boolean; notifyUrl?: string } | null {
  const row = db
    .prepare(`SELECT agent_id, banned, juror_eligible, notify_url FROM agents WHERE agent_id = ?`)
    .get(agentId) as
    | { agent_id: string; banned: number; juror_eligible: number; notify_url: string | null }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    agentId: row.agent_id,
    banned: row.banned === 1,
    jurorEligible: row.juror_eligible === 1,
    notifyUrl: row.notify_url ?? undefined
  };
}

export function setAgentBanned(db: Db, input: { agentId: string; banned: boolean }): void {
  const now = nowIso();
  db.prepare(`UPDATE agents SET banned = ?, updated_at = ? WHERE agent_id = ?`).run(
    input.banned ? 1 : 0,
    now,
    input.agentId
  );
}

export function countActiveAgentCapabilities(db: Db, agentId: string, atIso = nowIso()): number {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM agent_capabilities
      WHERE agent_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      `
    )
    .get(agentId, atIso) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export function createAgentCapability(
  db: Db,
  input: {
    tokenHash: string;
    agentId: string;
    scope?: string;
    expiresAtIso?: string;
  }
): AgentCapabilityRecord {
  const createdAtIso = nowIso();
  db.prepare(
    `
    INSERT INTO agent_capabilities (
      token_hash,
      agent_id,
      scope,
      revoked_at,
      expires_at,
      created_at
    ) VALUES (?, ?, ?, NULL, ?, ?)
    `
  ).run(input.tokenHash, input.agentId, input.scope ?? "writes", input.expiresAtIso ?? null, createdAtIso);

  return {
    tokenHash: input.tokenHash,
    agentId: input.agentId,
    scope: input.scope ?? "writes",
    expiresAtIso: input.expiresAtIso,
    createdAtIso
  };
}

export function getAgentCapabilityByHash(db: Db, tokenHash: string): AgentCapabilityRecord | null {
  const row = db
    .prepare(
      `
      SELECT token_hash, agent_id, scope, revoked_at, expires_at, created_at
      FROM agent_capabilities
      WHERE token_hash = ?
      `
    )
    .get(tokenHash) as
    | {
        token_hash: string;
        agent_id: string;
        scope: string;
        revoked_at: string | null;
        expires_at: string | null;
        created_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    tokenHash: row.token_hash,
    agentId: row.agent_id,
    scope: row.scope,
    revokedAtIso: row.revoked_at ?? undefined,
    expiresAtIso: row.expires_at ?? undefined,
    createdAtIso: row.created_at
  };
}

export function revokeAgentCapabilityByHash(
  db: Db,
  input: { tokenHash: string; agentId?: string }
): boolean {
  const params: Array<string | null> = [nowIso(), input.tokenHash];
  let sql = `UPDATE agent_capabilities SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`;
  if (input.agentId) {
    sql += ` AND agent_id = ?`;
    params.push(input.agentId);
  }
  const result = db.prepare(sql).run(...params);
  return Number(result.changes ?? 0) > 0;
}

export function setJurorAvailability(
  db: Db,
  input: { agentId: string; availability: "available" | "limited"; profile?: string }
): void {
  const now = nowIso();
  db.prepare(
    `
    INSERT INTO juror_availability (agent_id, availability, profile, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET availability = excluded.availability, profile = excluded.profile, updated_at = excluded.updated_at
    `
  ).run(input.agentId, input.availability, input.profile ?? null, now, now);
}

export function createCaseDraft(
  db: Db,
  payload: CreateCaseDraftPayload
): { caseId: string; createdAtIso: string } {
  const caseId = createCaseId("D");
  const publicSlug = createSlug(caseId);
  const createdAtIso = nowIso();
  const summary = payload.claimSummary ?? payload.claims?.[0]?.claimSummary ?? "";

  db.prepare(
    `
    INSERT INTO cases (
      case_id,
      public_slug,
      status,
      session_stage,
      prosecution_agent_id,
      defendant_agent_id,
      defence_agent_id,
      defence_state,
      open_defence,
      defendant_notify_url,
      defence_invite_status,
      defence_invite_attempts,
      defence_invite_last_attempt_at,
      defence_invite_last_error,
      case_topic,
      stake_level,
      summary,
      requested_remedy,
      created_at
    ) VALUES (?, ?, 'draft', 'pre_session', ?, ?, ?, ?, ?, ?, 'none', 0, NULL, NULL, ?, ?, ?, ?, ?)
    `
  ).run(
    caseId,
    publicSlug,
    payload.prosecutionAgentId,
    payload.defendantAgentId ?? null,
    null,
    payload.defendantAgentId ? "invited" : "none",
    payload.openDefence ? 1 : 0,
    payload.defendantNotifyUrl ?? null,
    payload.caseTopic ?? "other",
    payload.stakeLevel ?? "medium",
    summary,
    payload.requestedRemedy,
    createdAtIso
  );

  const claims =
    payload.claims && payload.claims.length > 0
      ? payload.claims
      : [
          {
            claimSummary: summary,
            requestedRemedy: payload.requestedRemedy,
            principlesInvoked: payload.allegedPrinciples ?? []
          }
        ];

  const claimStmt = db.prepare(
    `
    INSERT INTO claims (
      claim_id,
      case_id,
      claim_index,
      summary,
      requested_remedy,
      alleged_principles_json,
      claim_outcome,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'undecided', ?)
    `
  );

  claims.forEach((claim, index) => {
    const claimId = `${caseId}-c${index + 1}`;
    claimStmt.run(
      claimId,
      caseId,
      index + 1,
      claim.claimSummary,
      claim.requestedRemedy,
      canonicalJson(normalisePrincipleIds(claim.principlesInvoked ?? [])),
      createdAtIso
    );
  });

  return { caseId, createdAtIso };
}

function mapCaseRow(row: Record<string, unknown>): CaseRecord {
  return {
    caseId: String(row.case_id),
    publicSlug: String(row.public_slug),
    status: String(row.status),
    sessionStage: String(row.session_stage || "pre_session") as SessionStage,
    prosecutionAgentId: String(row.prosecution_agent_id),
    defendantAgentId: row.defendant_agent_id ? String(row.defendant_agent_id) : undefined,
    defenceAgentId: row.defence_agent_id ? String(row.defence_agent_id) : undefined,
    defenceState: (String(row.defence_state || "none") as DefenceState),
    defenceAssignedAtIso: row.defence_assigned_at ? String(row.defence_assigned_at) : undefined,
    defenceWindowDeadlineIso: row.defence_window_deadline
      ? String(row.defence_window_deadline)
      : undefined,
    defenceInviteStatus: (String(row.defence_invite_status || "none") as DefenceInviteStatus),
    defenceInviteAttempts: Number(row.defence_invite_attempts ?? 0),
    defenceInviteLastAttemptAtIso: row.defence_invite_last_attempt_at
      ? String(row.defence_invite_last_attempt_at)
      : undefined,
    defenceInviteLastError: row.defence_invite_last_error
      ? String(row.defence_invite_last_error)
      : undefined,
    openDefence: Number(row.open_defence) === 1,
    caseTopic: (String(row.case_topic ?? "other") as CaseTopic),
    stakeLevel: (String(row.stake_level ?? "medium") as StakeLevel),
    summary: String(row.summary),
    requestedRemedy: String(row.requested_remedy) as Remedy,
    createdAtIso: String(row.created_at),
    filedAtIso: row.filed_at ? String(row.filed_at) : undefined,
    jurySelectedAtIso: row.jury_selected_at ? String(row.jury_selected_at) : undefined,
    sessionStartedAtIso: row.session_started_at ? String(row.session_started_at) : undefined,
    closedAtIso: row.closed_at ? String(row.closed_at) : undefined,
    sealedAtIso: row.sealed_at ? String(row.sealed_at) : undefined,
    voidReason: row.void_reason ? (String(row.void_reason) as CaseVoidReason) : undefined,
    voidReasonGroup: row.void_reason_group
      ? (String(row.void_reason_group) as LearningVoidReasonGroup)
      : undefined,
    voidedAtIso: row.voided_at ? String(row.voided_at) : undefined,
    decidedAtIso: row.decided_at ? String(row.decided_at) : undefined,
    outcome: row.outcome ? (String(row.outcome) as CaseOutcome | "void") : undefined,
    outcomeDetail: row.outcome_detail_json ? parseJson(String(row.outcome_detail_json)) : undefined,
    replacementCountReady: Number(row.replacement_count_ready ?? 0),
    replacementCountVote: Number(row.replacement_count_vote ?? 0),
    treasuryTxSig: row.treasury_tx_sig ? String(row.treasury_tx_sig) : undefined,
    prosecutionPrinciplesCited: normalisePrincipleIds(
      maybeJson(row.prosecution_principles_cited_json as string | null, [])
    ),
    defencePrinciplesCited: normalisePrincipleIds(
      maybeJson(row.defence_principles_cited_json as string | null, [])
    ),
    scheduledForIso: row.scheduled_for ? String(row.scheduled_for) : undefined,
    countdownEndAtIso: row.countdown_end_at ? String(row.countdown_end_at) : undefined,
    countdownTotalMs: row.countdown_total_ms ? Number(row.countdown_total_ms) : undefined,
    drandRound: row.drand_round ? Number(row.drand_round) : undefined,
    drandRandomness: row.drand_randomness ? String(row.drand_randomness) : undefined,
    poolSnapshotHash: row.pool_snapshot_hash ? String(row.pool_snapshot_hash) : undefined,
    selectionProof: row.selection_proof_json
      ? parseJson<JurySelectionProof>(String(row.selection_proof_json))
      : undefined,
    verdictHash: row.verdict_hash ? String(row.verdict_hash) : undefined,
    transcriptRootHash: row.transcript_root_hash ? String(row.transcript_root_hash) : undefined,
    jurySelectionProofHash: row.jury_selection_proof_hash
      ? String(row.jury_selection_proof_hash)
      : undefined,
    rulesetVersion: String(row.ruleset_version ?? "agentic-code-v1.0.0"),
    sealStatus: (String(row.seal_status ?? "pending") as CaseRecord["sealStatus"]),
    sealError: row.seal_error ? String(row.seal_error) : undefined,
    metadataUri: row.metadata_uri ? String(row.metadata_uri) : undefined,
    verdictBundle: row.verdict_bundle_json ? parseJson(String(row.verdict_bundle_json)) : undefined,
    sealAssetId: row.seal_asset_id ? String(row.seal_asset_id) : undefined,
    sealTxSig: row.seal_tx_sig ? String(row.seal_tx_sig) : undefined,
    sealUri: row.seal_uri ? String(row.seal_uri) : undefined,
    filingWarning: row.filing_warning ? String(row.filing_warning) : undefined,
    defendantNotifyUrl: row.defendant_notify_url ? String(row.defendant_notify_url) : undefined
  };
}

export function getCaseById(db: Db, caseId: string): CaseRecord | null {
  const row = db
    .prepare(
      `
      SELECT
        case_id,
        public_slug,
        status,
        session_stage,
        prosecution_agent_id,
        defendant_agent_id,
        defence_agent_id,
        defence_state,
        defence_assigned_at,
        defence_window_deadline,
        defendant_notify_url,
        defence_invite_status,
        defence_invite_attempts,
        defence_invite_last_attempt_at,
        defence_invite_last_error,
        open_defence,
        case_topic,
        stake_level,
        summary,
        requested_remedy,
        created_at,
        filed_at,
        jury_selected_at,
        session_started_at,
        closed_at,
        sealed_at,
        void_reason,
        void_reason_group,
        voided_at,
        decided_at,
        outcome,
        outcome_detail_json,
        replacement_count_ready,
        replacement_count_vote,
        treasury_tx_sig,
        prosecution_principles_cited_json,
        defence_principles_cited_json,
        scheduled_for,
        countdown_end_at,
        countdown_total_ms,
        drand_round,
        drand_randomness,
        pool_snapshot_hash,
        selection_proof_json,
        verdict_hash,
        transcript_root_hash,
        jury_selection_proof_hash,
        ruleset_version,
        metadata_uri,
        seal_status,
        seal_error,
        verdict_bundle_json,
        seal_asset_id,
        seal_tx_sig,
        seal_uri,
        filing_warning
      FROM cases
      WHERE case_id = ?
      `
    )
    .get(caseId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return mapCaseRow(row);
}

export function listCasesByStatuses(db: Db, statuses: string[]): CaseRecord[] {
  if (statuses.length === 0) {
    return [];
  }
  const placeholders = statuses.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT
        case_id,
        public_slug,
        status,
        session_stage,
        prosecution_agent_id,
        defendant_agent_id,
        defence_agent_id,
        defence_state,
        defence_assigned_at,
        defence_window_deadline,
        defendant_notify_url,
        defence_invite_status,
        defence_invite_attempts,
        defence_invite_last_attempt_at,
        defence_invite_last_error,
        open_defence,
        case_topic,
        stake_level,
        summary,
        requested_remedy,
        created_at,
        filed_at,
        jury_selected_at,
        session_started_at,
        closed_at,
        sealed_at,
        void_reason,
        void_reason_group,
        voided_at,
        decided_at,
        outcome,
        outcome_detail_json,
        replacement_count_ready,
        replacement_count_vote,
        treasury_tx_sig,
        prosecution_principles_cited_json,
        defence_principles_cited_json,
        scheduled_for,
        countdown_end_at,
        countdown_total_ms,
        drand_round,
        drand_randomness,
        pool_snapshot_hash,
        selection_proof_json,
        verdict_hash,
        transcript_root_hash,
        jury_selection_proof_hash,
        ruleset_version,
        metadata_uri,
        seal_status,
        seal_error,
        verdict_bundle_json,
        seal_asset_id,
        seal_tx_sig,
        seal_uri,
        filing_warning
      FROM cases
      WHERE status IN (${placeholders})
      ORDER BY created_at DESC
      `
    )
    .all(...statuses) as Array<Record<string, unknown>>;

  return rows.map(mapCaseRow);
}

export function listClaims(db: Db, caseId: string): ClaimRecord[] {
  const rows = db
    .prepare(
      `SELECT claim_id, case_id, summary, requested_remedy, alleged_principles_json, claim_outcome FROM claims WHERE case_id = ? ORDER BY claim_index ASC`
    )
    .all(caseId) as Array<{
    claim_id: string;
    case_id: string;
    summary: string;
    requested_remedy: Remedy;
    alleged_principles_json: string;
    claim_outcome: ClaimOutcome;
  }>;

  return rows.map((row) => ({
    claimId: row.claim_id,
    caseId: row.case_id,
    summary: row.summary,
    requestedRemedy: row.requested_remedy,
    allegedPrinciples: normalisePrincipleIds(maybeJson(row.alleged_principles_json, [])),
    claimOutcome: row.claim_outcome ?? "undecided"
  }));
}

export function countEvidenceForCase(
  db: Db,
  caseId: string
): { count: number; totalChars: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(body_text)), 0) AS total_chars FROM evidence_items WHERE case_id = ?`
    )
    .get(caseId) as { count: number; total_chars: number };
  return { count: Number(row.count), totalChars: Number(row.total_chars) };
}

export function addEvidence(db: Db, input: Omit<EvidenceRecord, "createdAtIso">): EvidenceRecord {
  const createdAtIso = nowIso();
  db.prepare(
    `INSERT INTO evidence_items (evidence_id, case_id, submitted_by, kind, body_text, references_json, attachment_urls_json, body_hash, evidence_types_json, evidence_strength, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.evidenceId,
    input.caseId,
    input.submittedBy,
    input.kind,
    input.bodyText,
    canonicalJson(input.references),
    canonicalJson(input.attachmentUrls),
    input.bodyHash,
    canonicalJson(input.evidenceTypes),
    input.evidenceStrength ?? null,
    createdAtIso
  );
  return { ...input, createdAtIso };
}

export function listEvidenceByCase(db: Db, caseId: string): EvidenceRecord[] {
  const rows = db
    .prepare(
      `SELECT evidence_id, case_id, submitted_by, kind, body_text, references_json, attachment_urls_json, body_hash, evidence_types_json, evidence_strength, created_at FROM evidence_items WHERE case_id = ? ORDER BY created_at ASC`
    )
    .all(caseId) as Array<{
    evidence_id: string;
    case_id: string;
    submitted_by: string;
    kind: string;
    body_text: string;
    references_json: string;
    attachment_urls_json: string | null;
    body_hash: string;
    evidence_types_json: string | null;
    evidence_strength: EvidenceStrength | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    evidenceId: row.evidence_id,
    caseId: row.case_id,
    submittedBy: row.submitted_by,
    kind: row.kind,
    bodyText: row.body_text,
    references: maybeJson<string[]>(row.references_json, []),
    attachmentUrls: maybeJson<string[]>(row.attachment_urls_json, []),
    bodyHash: row.body_hash,
    evidenceTypes: maybeJson<EvidenceTypeLabel[]>(row.evidence_types_json, []),
    evidenceStrength: row.evidence_strength ?? undefined,
    createdAtIso: row.created_at
  }));
}

export function upsertSubmission(
  db: Db,
  input: Omit<SubmissionRecord, "createdAtIso">
): SubmissionRecord {
  const createdAtIso = nowIso();
  db.prepare(
    `
    INSERT INTO submissions (submission_id, case_id, side, phase, text_body, principle_citations_json, claim_principle_citations_json, evidence_citations_json, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(case_id, side, phase)
    DO UPDATE SET
      submission_id = excluded.submission_id,
      text_body = excluded.text_body,
      principle_citations_json = excluded.principle_citations_json,
      claim_principle_citations_json = excluded.claim_principle_citations_json,
      evidence_citations_json = excluded.evidence_citations_json,
      content_hash = excluded.content_hash,
      created_at = excluded.created_at
    `
  ).run(
    input.submissionId,
    input.caseId,
    input.side,
    input.phase,
    input.text,
    canonicalJson(input.principleCitations),
    canonicalJson(input.claimPrincipleCitations ?? {}),
    canonicalJson(input.evidenceCitations),
    input.contentHash,
    createdAtIso
  );

  if (input.phase === "summing_up") {
    const column =
      input.side === "prosecution"
        ? "prosecution_principles_cited_json"
        : "defence_principles_cited_json";
    db.prepare(`UPDATE cases SET ${column} = ? WHERE case_id = ?`).run(
      canonicalJson(input.principleCitations),
      input.caseId
    );
  }

  return { ...input, createdAtIso };
}

export function getSubmissionBySidePhase(
  db: Db,
  caseId: string,
  side: "prosecution" | "defence",
  phase: "opening" | "evidence" | "closing" | "summing_up"
): SubmissionRecord | null {
  const row = db
    .prepare(
      `SELECT submission_id, case_id, side, phase, text_body, principle_citations_json, claim_principle_citations_json, evidence_citations_json, content_hash, created_at FROM submissions WHERE case_id = ? AND side = ? AND phase = ? LIMIT 1`
    )
    .get(caseId, side, phase) as
    | {
        submission_id: string;
        case_id: string;
        side: "prosecution" | "defence";
        phase: "opening" | "evidence" | "closing" | "summing_up";
        text_body: string;
        principle_citations_json: string;
        claim_principle_citations_json: string;
        evidence_citations_json: string;
        content_hash: string;
        created_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    submissionId: row.submission_id,
    caseId: row.case_id,
    side: row.side,
    phase: row.phase,
    text: row.text_body,
    principleCitations: normalisePrincipleIds(maybeJson(row.principle_citations_json, [])),
    claimPrincipleCitations: Object.fromEntries(
      Object.entries(maybeJson<Record<string, unknown>>(row.claim_principle_citations_json, {})).map(
        ([claimId, values]) => [claimId, normalisePrincipleIds(values)]
      )
    ),
    evidenceCitations: maybeJson<string[]>(row.evidence_citations_json, []),
    contentHash: row.content_hash,
    createdAtIso: row.created_at
  };
}

export function listSubmissionsByCase(db: Db, caseId: string): SubmissionRecord[] {
  const rows = db
    .prepare(
      `SELECT submission_id, case_id, side, phase, text_body, principle_citations_json, claim_principle_citations_json, evidence_citations_json, content_hash, created_at FROM submissions WHERE case_id = ? ORDER BY created_at ASC`
    )
    .all(caseId) as Array<{
    submission_id: string;
    case_id: string;
    side: "prosecution" | "defence";
    phase: "opening" | "evidence" | "closing" | "summing_up";
    text_body: string;
    principle_citations_json: string;
    claim_principle_citations_json: string;
    evidence_citations_json: string;
    content_hash: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    submissionId: row.submission_id,
    caseId: row.case_id,
    side: row.side,
    phase: row.phase,
    text: row.text_body,
    principleCitations: normalisePrincipleIds(maybeJson(row.principle_citations_json, [])),
    claimPrincipleCitations: Object.fromEntries(
      Object.entries(maybeJson<Record<string, unknown>>(row.claim_principle_citations_json, {})).map(
        ([claimId, values]) => [claimId, normalisePrincipleIds(values)]
      )
    ),
    evidenceCitations: maybeJson<string[]>(row.evidence_citations_json, []),
    contentHash: row.content_hash,
    createdAtIso: row.created_at
  }));
}

export function setCaseStatus(db: Db, caseId: string, status: string): void {
  db.prepare(`UPDATE cases SET status = ? WHERE case_id = ?`).run(status, caseId);
}

export function setCaseFiled(
  db: Db,
  input: {
    caseId: string;
    txSig: string;
    warning?: string;
    scheduleDelaySec: number;
    defenceCutoffSec: number;
    scheduleImmediately?: boolean;
    inviteStatus?: DefenceInviteStatus;
  }
): void {
  const now = nowIso();
  const scheduleImmediately = input.scheduleImmediately ?? true;
  const scheduleAt = scheduleImmediately
    ? new Date(Date.now() + input.scheduleDelaySec * 1000).toISOString()
    : null;
  const defenceWindowDeadline = new Date(Date.now() + input.defenceCutoffSec * 1000).toISOString();
  db.prepare(
    `UPDATE cases SET status = 'filed', session_stage = 'pre_session', treasury_tx_sig = ?, filed_at = ?, filing_warning = ?, scheduled_for = ?, countdown_end_at = ?, countdown_total_ms = ?, defence_window_deadline = ?, defence_invite_status = COALESCE(?, defence_invite_status), defence_invite_attempts = 0, defence_invite_last_attempt_at = NULL, defence_invite_last_error = NULL, decided_at = NULL, outcome = NULL, outcome_detail_json = NULL, void_reason_group = NULL, replacement_count_ready = 0, replacement_count_vote = 0, prosecution_principles_cited_json = '[]', defence_principles_cited_json = '[]' WHERE case_id = ?`
  ).run(
    input.txSig,
    now,
    input.warning ?? null,
    scheduleAt,
    scheduleAt,
    scheduleImmediately ? input.scheduleDelaySec * 1000 : null,
    defenceWindowDeadline,
    input.inviteStatus ?? null,
    input.caseId
  );

  upsertCaseRuntime(db, {
    caseId: input.caseId,
    currentStage: "pre_session",
    stageStartedAtIso: now,
    stageDeadlineAtIso: scheduleAt ?? defenceWindowDeadline,
    scheduledSessionStartAtIso: scheduleAt,
    votingHardDeadlineAtIso: null,
    voidReason: null,
    voidedAtIso: null
  });
}

export function setCaseDefence(db: Db, caseId: string, defenceAgentId: string): void {
  db.prepare(
    `UPDATE cases SET defence_agent_id = ?, defence_state = 'accepted', defence_assigned_at = ? WHERE case_id = ?`
  ).run(defenceAgentId, nowIso(), caseId);
}

export function claimDefenceAssignment(
  db: Db,
  input: {
    caseId: string;
    agentId: string;
    nowIso: string;
    namedExclusiveSec: number;
    scheduleDelaySec: number;
  }
): DefenceClaimResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `
        SELECT
          case_id,
          public_slug,
          status,
          session_stage,
          prosecution_agent_id,
          defendant_agent_id,
          defence_agent_id,
          defence_state,
          defence_assigned_at,
          defence_window_deadline,
          defendant_notify_url,
          defence_invite_status,
          defence_invite_attempts,
          defence_invite_last_attempt_at,
          defence_invite_last_error,
          open_defence,
          case_topic,
          stake_level,
          summary,
          requested_remedy,
          created_at,
          filed_at,
          jury_selected_at,
          session_started_at,
          closed_at,
          sealed_at,
          void_reason,
          void_reason_group,
          voided_at,
          decided_at,
          outcome,
          outcome_detail_json,
          replacement_count_ready,
          replacement_count_vote,
          prosecution_principles_cited_json,
          defence_principles_cited_json,
          scheduled_for,
          countdown_end_at,
          countdown_total_ms,
          drand_round,
          drand_randomness,
          pool_snapshot_hash,
          selection_proof_json,
          verdict_hash,
          transcript_root_hash,
          jury_selection_proof_hash,
          ruleset_version,
          metadata_uri,
          seal_status,
          seal_error,
          verdict_bundle_json,
          seal_asset_id,
          seal_tx_sig,
          seal_uri,
          filing_warning
        FROM cases
        WHERE case_id = ?
        LIMIT 1
        `
      )
      .get(input.caseId) as Record<string, unknown> | undefined;

    if (!row) {
      db.exec("COMMIT");
      throw new Error("CASE_NOT_FOUND");
    }

    const caseRecord = mapCaseRow(row);
    if (!["draft", "filed", "jury_selected", "voting"].includes(caseRecord.status)) {
      db.exec("COMMIT");
      return { status: "not_open", caseRecord };
    }
    if (input.agentId === caseRecord.prosecutionAgentId) {
      db.exec("COMMIT");
      return { status: "defence_cannot_be_prosecution", caseRecord };
    }

    const jurorRow = db
      .prepare(
        `SELECT juror_id FROM jury_panel_members WHERE case_id = ? AND juror_id = ? AND member_status IN ('pending_ready','ready','active_voting','voted') LIMIT 1`
      )
      .get(caseRecord.caseId, input.agentId) as { juror_id: string } | undefined;
    if (jurorRow) {
      db.exec("COMMIT");
      return { status: "not_open", caseRecord };
    }

    if (!caseRecord.defendantAgentId && !caseRecord.openDefence) {
      db.exec("COMMIT");
      return { status: "not_open", caseRecord };
    }

    if (caseRecord.defenceAgentId) {
      db.exec("COMMIT");
      return { status: "already_taken", caseRecord };
    }

    const nowMs = new Date(input.nowIso).getTime();
    if (
      caseRecord.defenceWindowDeadlineIso &&
      nowMs >= new Date(caseRecord.defenceWindowDeadlineIso).getTime()
    ) {
      db.exec("COMMIT");
      return { status: "window_closed", caseRecord };
    }

    const exclusiveWindowEndMs =
      (caseRecord.filedAtIso
        ? new Date(caseRecord.filedAtIso).getTime()
        : new Date(caseRecord.createdAtIso).getTime()) +
      input.namedExclusiveSec * 1000;
    const inExclusiveWindow = nowMs < exclusiveWindowEndMs;

    if (caseRecord.defendantAgentId && caseRecord.defendantAgentId !== input.agentId && inExclusiveWindow) {
      db.exec("COMMIT");
      return { status: "reserved_for_named_defendant", caseRecord };
    }

    const assignedState: DefenceState =
      caseRecord.defendantAgentId && caseRecord.defendantAgentId === input.agentId
        ? "accepted"
        : "volunteered";

    const update = db
      .prepare(
        `
        UPDATE cases
        SET defence_agent_id = ?, defence_state = ?, defence_assigned_at = ?, defence_invite_last_error = NULL
        WHERE case_id = ? AND defence_agent_id IS NULL
        `
      )
      .run(input.agentId, assignedState, input.nowIso, input.caseId);

    if (Number(update.changes) !== 1) {
      const refreshed = getCaseById(db, input.caseId) ?? caseRecord;
      db.exec("COMMIT");
      return { status: "already_taken", caseRecord: refreshed };
    }

    // For named-defendant filings, session scheduling starts one hour after defence acceptance.
    if (!caseRecord.scheduledForIso && caseRecord.status === "filed") {
      const scheduleAtIso = new Date(
        new Date(input.nowIso).getTime() + input.scheduleDelaySec * 1000
      ).toISOString();
      db.prepare(
        `
        UPDATE cases
        SET scheduled_for = ?, countdown_end_at = ?, countdown_total_ms = ?
        WHERE case_id = ?
        `
      ).run(scheduleAtIso, scheduleAtIso, input.scheduleDelaySec * 1000, input.caseId);

      const runtime = getCaseRuntime(db, input.caseId);
      if (runtime?.currentStage === "pre_session") {
        upsertCaseRuntime(db, {
          caseId: input.caseId,
          currentStage: runtime.currentStage,
          stageStartedAtIso: runtime.stageStartedAtIso,
          stageDeadlineAtIso: scheduleAtIso,
          scheduledSessionStartAtIso: scheduleAtIso,
          votingHardDeadlineAtIso: runtime.votingHardDeadlineAtIso ?? null,
          voidReason: runtime.voidReason ?? null,
          voidedAtIso: runtime.voidedAtIso ?? null
        });
      }
    }

    const assigned = getCaseById(db, input.caseId) ?? caseRecord;
    db.exec("COMMIT");
    return {
      status: assignedState === "accepted" ? "assigned_accepted" : "assigned_volunteered",
      caseRecord: assigned
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markCaseSessionStage(
  db: Db,
  input: { caseId: string; stage: SessionStage; status?: string; stageStartedAtIso?: string }
): void {
  const started = input.stageStartedAtIso ?? nowIso();
  db.prepare(`UPDATE cases SET session_stage = ?, status = COALESCE(?, status), session_started_at = COALESCE(session_started_at, ?) WHERE case_id = ?`).run(
    input.stage,
    input.status ?? null,
    started,
    input.caseId
  );
}

export function setCaseJurySelected(
  db: Db,
  input: {
    caseId: string;
    round: number;
    randomness: string;
    poolSnapshotHash: string;
    proof: JurySelectionProof;
  }
): void {
  const now = nowIso();

  db.prepare(
    `
    INSERT INTO jury_panels (case_id, drand_round, drand_randomness, pool_snapshot_hash, selection_proof_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET drand_round = excluded.drand_round, drand_randomness = excluded.drand_randomness, pool_snapshot_hash = excluded.pool_snapshot_hash, selection_proof_json = excluded.selection_proof_json, created_at = excluded.created_at
  `
  ).run(
    input.caseId,
    input.round,
    input.randomness,
    input.poolSnapshotHash,
    canonicalJson(input.proof),
    now
  );

  db.prepare(
    `
    UPDATE cases
    SET status = 'jury_selected',
        session_stage = 'pre_session',
        jury_selected_at = ?,
        drand_round = ?,
        drand_randomness = ?,
        pool_snapshot_hash = ?,
        selection_proof_json = ?
    WHERE case_id = ?
  `
  ).run(
    now,
    input.round,
    input.randomness,
    input.poolSnapshotHash,
    canonicalJson(input.proof),
    input.caseId
  );
}

export function createJurySelectionRun(
  db: Db,
  input: {
    caseId: string;
    runId: string;
    runType: "initial" | "replacement";
    round: number;
    randomness: string;
    poolSnapshotHash: string;
    proof: JurySelectionProof;
  }
): void {
  db.prepare(
    `INSERT INTO jury_selection_runs (run_id, case_id, run_type, drand_round, drand_randomness, pool_snapshot_hash, selection_proof_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.runId,
    input.caseId,
    input.runType,
    input.round,
    input.randomness,
    input.poolSnapshotHash,
    canonicalJson(input.proof),
    nowIso()
  );
}

export function replaceJuryMembers(
  db: Db,
  caseId: string,
  members: Array<{ jurorId: string; scoreHash: string; selectionRunId?: string }>
): void {
  db.prepare(`DELETE FROM jury_panel_members WHERE case_id = ?`).run(caseId);
  const now = nowIso();
  const stmt = db.prepare(
    `INSERT INTO jury_panel_members (case_id, juror_id, score_hash, member_status, created_at, selection_run_id) VALUES (?, ?, ?, 'pending_ready', ?, ?)`
  );
  for (const member of members) {
    stmt.run(caseId, member.jurorId, member.scoreHash, now, member.selectionRunId ?? null);
  }
}

export function setJuryReadinessDeadlines(
  db: Db,
  caseId: string,
  deadlineIso: string
): void {
  db.prepare(
    `UPDATE jury_panel_members SET member_status = 'pending_ready', ready_deadline_at = ?, ready_confirmed_at = NULL WHERE case_id = ? AND member_status IN ('pending_ready', 'ready', 'active_voting')`
  ).run(deadlineIso, caseId);
}

export function confirmJurorReady(
  db: Db,
  caseId: string,
  jurorId: string,
  confirmedAtIso: string
): boolean {
  const result = db
    .prepare(
      `UPDATE jury_panel_members SET member_status = 'ready', ready_confirmed_at = ? WHERE case_id = ? AND juror_id = ? AND member_status = 'pending_ready'`
    )
    .run(confirmedAtIso, caseId, jurorId);
  return Number(result.changes) > 0;
}

export function markJurorTimedOut(db: Db, caseId: string, jurorId: string): void {
  db.prepare(
    `UPDATE jury_panel_members SET member_status = 'timed_out' WHERE case_id = ? AND juror_id = ? AND member_status IN ('pending_ready', 'active_voting')`
  ).run(caseId, jurorId);
}

export function markJurorReplaced(
  db: Db,
  caseId: string,
  jurorId: string,
  replacementJurorId: string
): void {
  db.prepare(
    `UPDATE jury_panel_members SET member_status = 'replaced', replaced_by_juror_id = ? WHERE case_id = ? AND juror_id = ?`
  ).run(replacementJurorId, caseId, jurorId);
}

export function addReplacementJuror(
  db: Db,
  input: {
    caseId: string;
    jurorId: string;
    scoreHash: string;
    replacementOfJurorId: string;
    memberStatus: "pending_ready" | "active_voting";
    readyDeadlineAtIso?: string;
    votingDeadlineAtIso?: string;
    selectionRunId?: string;
  }
): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO jury_panel_members (
        case_id,
        juror_id,
        score_hash,
        member_status,
        ready_deadline_at,
        voting_deadline_at,
        replacement_of_juror_id,
        created_at,
        selection_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    input.caseId,
    input.jurorId,
    input.scoreHash,
    input.memberStatus,
    input.readyDeadlineAtIso ?? null,
    input.votingDeadlineAtIso ?? null,
    input.replacementOfJurorId,
    nowIso(),
    input.selectionRunId ?? null
  );
}

export function setVotingDeadlinesForActiveJurors(
  db: Db,
  caseId: string,
  votingDeadlineIso: string
): void {
  db.prepare(
    `UPDATE jury_panel_members SET member_status = CASE WHEN member_status = 'voted' THEN member_status ELSE 'active_voting' END, voting_deadline_at = CASE WHEN member_status = 'voted' THEN voting_deadline_at ELSE ? END WHERE case_id = ? AND member_status IN ('ready', 'active_voting', 'pending_ready', 'voted')`
  ).run(votingDeadlineIso, caseId);
}

export function markJurorVoted(db: Db, caseId: string, jurorId: string): void {
  db.prepare(
    `UPDATE jury_panel_members SET member_status = 'voted' WHERE case_id = ? AND juror_id = ?`
  ).run(caseId, jurorId);
}

export function listJuryPanelMembers(db: Db, caseId: string): JuryPanelMemberRecord[] {
  const rows = db
    .prepare(
      `SELECT case_id, juror_id, score_hash, member_status, ready_deadline_at, ready_confirmed_at, voting_deadline_at, replacement_of_juror_id, replaced_by_juror_id, selection_run_id, created_at FROM jury_panel_members WHERE case_id = ? ORDER BY created_at ASC`
    )
    .all(caseId) as Array<{
    case_id: string;
    juror_id: string;
    score_hash: string;
    member_status: JuryPanelMemberRecord["memberStatus"];
    ready_deadline_at: string | null;
    ready_confirmed_at: string | null;
    voting_deadline_at: string | null;
    replacement_of_juror_id: string | null;
    replaced_by_juror_id: string | null;
    selection_run_id: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    caseId: row.case_id,
    jurorId: row.juror_id,
    scoreHash: row.score_hash,
    memberStatus: row.member_status,
    readyDeadlineAtIso: row.ready_deadline_at ?? undefined,
    readyConfirmedAtIso: row.ready_confirmed_at ?? undefined,
    votingDeadlineAtIso: row.voting_deadline_at ?? undefined,
    replacementOfJurorId: row.replacement_of_juror_id ?? undefined,
    replacedByJurorId: row.replaced_by_juror_id ?? undefined,
    selectionRunId: row.selection_run_id ?? undefined,
    createdAtIso: row.created_at
  }));
}

export function listJuryMembers(db: Db, caseId: string): string[] {
  const rows = db
    .prepare(
      `SELECT juror_id FROM jury_panel_members WHERE case_id = ? AND member_status NOT IN ('replaced', 'timed_out') ORDER BY score_hash ASC, juror_id ASC`
    )
    .all(caseId) as Array<{ juror_id: string }>;
  return rows.map((row) => row.juror_id);
}

export function addBallot(
  db: Db,
  input: {
    caseId: string;
    jurorId: string;
    votes: SubmitBallotPayload["votes"];
    reasoningSummary: string;
    vote?: BallotVoteLabel;
    principlesReliedOn: number[];
    confidence?: BallotConfidence;
    ballotHash: string;
    signature: string;
  }
): BallotRecord {
  const ballotId = createId("ballot");
  const createdAtIso = nowIso();
  db.prepare(
    `INSERT INTO ballots (ballot_id, case_id, juror_id, ballot_json, ballot_hash, reasoning_summary, vote, principles_relied_on_json, confidence, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ballotId,
    input.caseId,
    input.jurorId,
    canonicalJson({ votes: input.votes }),
    input.ballotHash,
    input.reasoningSummary,
    input.vote ?? null,
    canonicalJson(input.principlesReliedOn),
    input.confidence ?? null,
    input.signature,
    createdAtIso
  );

  return {
    ballotId,
    caseId: input.caseId,
    jurorId: input.jurorId,
    votes: input.votes,
    reasoningSummary: input.reasoningSummary,
    vote: input.vote,
    principlesReliedOn: input.principlesReliedOn,
    confidence: input.confidence,
    ballotHash: input.ballotHash,
    signature: input.signature,
    createdAtIso
  };
}

export function listBallotsByCase(db: Db, caseId: string): BallotRecord[] {
  const rows = db
    .prepare(
      `SELECT ballot_id, case_id, juror_id, ballot_json, ballot_hash, reasoning_summary, vote, principles_relied_on_json, confidence, signature, created_at FROM ballots WHERE case_id = ? ORDER BY created_at ASC`
    )
    .all(caseId) as Array<{
    ballot_id: string;
    case_id: string;
    juror_id: string;
    ballot_json: string;
    ballot_hash: string;
    reasoning_summary: string;
    vote: BallotVoteLabel | null;
    principles_relied_on_json: string | null;
    confidence: BallotConfidence | null;
    signature: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    ballotId: row.ballot_id,
    caseId: row.case_id,
    jurorId: row.juror_id,
    votes: maybeJson<{ votes: VoteEntry[] }>(row.ballot_json, { votes: [] }).votes,
    reasoningSummary: row.reasoning_summary,
    vote: row.vote ?? undefined,
    principlesReliedOn: normalisePrincipleIds(maybeJson(row.principles_relied_on_json, [])),
    confidence: row.confidence ?? undefined,
    ballotHash: row.ballot_hash,
    signature: row.signature,
    createdAtIso: row.created_at
  }));
}

export function storeVerdict(
  db: Db,
  input: {
    caseId: string;
    verdictJson: unknown;
    verdictHash: string;
    majoritySummary: string;
  }
): void {
  const now = nowIso();
  const verdict = input.verdictJson as {
    overall?: { outcome?: CaseOutcome };
    claims?: Array<{ claimId: string; finding: "proven" | "not_proven" | "insufficient" }>;
  };
  const outcome: CaseOutcome | "void" =
    verdict.overall?.outcome === "for_prosecution" || verdict.overall?.outcome === "for_defence"
      ? verdict.overall.outcome
      : "void";
  const claimOutcomes = (verdict.claims ?? []).map((claim) => ({
    claimId: claim.claimId,
    claimOutcome:
      claim.finding === "proven"
        ? "for_prosecution"
        : claim.finding === "not_proven"
          ? "for_defence"
          : "undecided"
  }));

  db.prepare(
    `
    INSERT INTO verdicts (case_id, verdict_json, verdict_hash, majority_summary, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET verdict_json = excluded.verdict_json, verdict_hash = excluded.verdict_hash, majority_summary = excluded.majority_summary, created_at = excluded.created_at
    `
  ).run(
    input.caseId,
    canonicalJson(input.verdictJson),
    input.verdictHash,
    input.majoritySummary,
    now
  );

  db.prepare(
    `UPDATE cases
      SET status = 'closed',
          session_stage = 'closed',
          closed_at = ?,
          decided_at = ?,
          verdict_hash = ?,
          verdict_bundle_json = ?,
          outcome = ?,
          outcome_detail_json = ?,
          seal_status = 'pending',
          seal_error = NULL,
          void_reason_group = NULL
      WHERE case_id = ?`
  ).run(
    now,
    now,
    input.verdictHash,
    canonicalJson(input.verdictJson),
    outcome,
    canonicalJson({ claimOutcomes }),
    input.caseId
  );

  const claimStmt = db.prepare(`UPDATE claims SET claim_outcome = ? WHERE claim_id = ? AND case_id = ?`);
  for (const item of claimOutcomes) {
    claimStmt.run(item.claimOutcome, item.claimId, input.caseId);
  }

  updateCaseRuntimeStage(db, {
    caseId: input.caseId,
    stage: "closed",
    stageStartedAtIso: now,
    stageDeadlineAtIso: null
  });
}

export function createSealJob(
  db: Db,
  input: { caseId: string; request: WorkerSealRequest; payloadHash?: string }
): string {
  const jobId = input.request.jobId;
  const now = nowIso();
  db.prepare(
    `INSERT OR REPLACE INTO seal_jobs (job_id, case_id, status, attempts, last_error, claimed_at, completed_at, payload_hash, metadata_uri, request_json, response_json, created_at, updated_at) VALUES (?, ?, 'queued', 0, NULL, NULL, NULL, ?, NULL, ?, NULL, ?, ?)`
  ).run(
    jobId,
    input.caseId,
    input.payloadHash ?? "",
    canonicalJson(input.request),
    now,
    now
  );
  return jobId;
}

export function createSealJobIfMissing(
  db: Db,
  input: { caseId: string; request: WorkerSealRequest; payloadHash: string }
): { jobId: string; created: boolean; status: string } {
  const existing = db.prepare(`SELECT job_id, status FROM seal_jobs WHERE case_id = ?`).get(input.caseId) as
    | { job_id: string; status: string }
    | undefined;
  if (existing) {
    return {
      jobId: existing.job_id,
      created: false,
      status: String(existing.status)
    };
  }
  const jobId = createSealJob(db, {
    caseId: input.caseId,
    request: input.request,
    payloadHash: input.payloadHash
  });
  setCaseSealState(db, {
    caseId: input.caseId,
    sealStatus: "pending"
  });
  return {
    jobId,
    created: true,
    status: "queued"
  };
}

export function claimSealJob(
  db: Db,
  input: { jobId: string; expectedStatus?: "queued" | "failed" }
): boolean {
  const now = nowIso();
  const status = input.expectedStatus ?? "queued";
  const result = db
    .prepare(
      `
      UPDATE seal_jobs
      SET status = 'minting',
          attempts = attempts + 1,
          last_error = NULL,
          claimed_at = ?,
          updated_at = ?
      WHERE job_id = ? AND status = ?
      `
    )
    .run(now, now, input.jobId, status);
  return result.changes > 0;
}

export function markSealJobResult(
  db: Db,
  result: WorkerSealResponse,
  options?: { metadataUri?: string }
): void {
  const now = nowIso();
  if (result.status === "minted") {
    db.prepare(
      `UPDATE seal_jobs
       SET status = 'minted',
           response_json = ?,
           metadata_uri = ?,
           completed_at = ?,
           last_error = NULL,
           updated_at = ?
       WHERE job_id = ?`
    ).run(
      canonicalJson(result),
      options?.metadataUri ?? result.metadataUri,
      result.sealedAtIso,
      now,
      result.jobId
    );
    return;
  }
  db.prepare(
    `UPDATE seal_jobs
     SET status = 'failed',
         response_json = ?,
         metadata_uri = COALESCE(?, metadata_uri),
         last_error = ?,
         completed_at = ?,
         updated_at = ?
     WHERE job_id = ?`
  ).run(
    canonicalJson(result),
    options?.metadataUri ?? result.metadataUri ?? null,
    result.errorCode === "PINATA_QUOTA_EXCEEDED"
      ? `NON_RETRYABLE:${result.errorMessage ?? "Pinata quota exceeded."}`
      : (result.errorMessage ?? "Mint worker returned failure."),
    now,
    now,
    result.jobId
  );
}

export function markSealJobFailed(
  db: Db,
  input: { jobId: string; error: string; responseJson?: unknown }
): void {
  const now = nowIso();
  db.prepare(
    `UPDATE seal_jobs
     SET status = 'failed',
         last_error = ?,
         response_json = ?,
         completed_at = ?,
         updated_at = ?
     WHERE job_id = ?`
  ).run(
    input.error,
    canonicalJson(input.responseJson ?? { error: input.error }),
    now,
    now,
    input.jobId
  );
}

export function markCaseSealed(
  db: Db,
  input: {
    caseId: string;
    assetId: string;
    txSig: string;
    sealedUri: string;
    metadataUri?: string;
    sealedAtIso?: string;
  }
): void {
  const now = input.sealedAtIso ?? nowIso();
  db.prepare(
    `
    UPDATE cases
    SET status = 'sealed',
        session_stage = 'sealed',
        sealed_at = ?,
        seal_asset_id = ?,
        seal_tx_sig = ?,
        seal_uri = ?,
        metadata_uri = COALESCE(?, metadata_uri),
        seal_status = 'sealed',
        seal_error = NULL
    WHERE case_id = ?
    `
  ).run(now, input.assetId, input.txSig, input.sealedUri, input.metadataUri ?? null, input.caseId);

  db.prepare(
    `
    INSERT INTO verdicts (case_id, verdict_json, verdict_hash, majority_summary, created_at, asset_id, tx_sig, sealed_uri)
    VALUES (?, '{}', '', '', ?, ?, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET asset_id = excluded.asset_id, tx_sig = excluded.tx_sig, sealed_uri = excluded.sealed_uri
    `
  ).run(input.caseId, now, input.assetId, input.txSig, input.sealedUri);

  updateCaseRuntimeStage(db, {
    caseId: input.caseId,
    stage: "sealed",
    stageStartedAtIso: now,
    stageDeadlineAtIso: null
  });
}

export function setCaseSealState(
  db: Db,
  input: { caseId: string; sealStatus: CaseRecord["sealStatus"]; error?: string | null }
): void {
  db.prepare(
    `UPDATE cases
     SET seal_status = ?, seal_error = ?
     WHERE case_id = ?`
  ).run(input.sealStatus, input.error ?? null, input.caseId);
}

export function setCaseSealHashes(
  db: Db,
  input: {
    caseId: string;
    transcriptRootHash: string;
    jurySelectionProofHash: string;
    rulesetVersion: string;
  }
): void {
  db.prepare(
    `UPDATE cases
     SET transcript_root_hash = ?, jury_selection_proof_hash = ?, ruleset_version = ?
     WHERE case_id = ?`
  ).run(
    input.transcriptRootHash,
    input.jurySelectionProofHash,
    input.rulesetVersion,
    input.caseId
  );
}

export function saveUsedTreasuryTx(
  db: Db,
  input: { txSig: string; caseId: string; agentId: string; amountLamports: number }
): void {
  db.prepare(
    `INSERT INTO used_treasury_txs (tx_sig, case_id, agent_id, amount_lamports, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(input.txSig, input.caseId, input.agentId, input.amountLamports, nowIso());
}

export function isTreasuryTxUsed(db: Db, txSig: string): boolean {
  const row = db.prepare(`SELECT tx_sig FROM used_treasury_txs WHERE tx_sig = ?`).get(txSig) as
    | { tx_sig: string }
    | undefined;
  return Boolean(row);
}

export function countFiledCasesToday(db: Db, dayPrefixUtc: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM cases WHERE filed_at LIKE ?`)
    .get(`${dayPrefixUtc}%`) as { count: number };
  return Number(row.count);
}

export function countClosedAndSealedCases(db: Db): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM cases WHERE status IN ('closed', 'sealed')`)
    .get() as { count: number };
  return Number(row.count);
}

export function incrementReplacementCount(
  db: Db,
  input: { caseId: string; mode: "ready" | "vote" }
): void {
  const column = input.mode === "ready" ? "replacement_count_ready" : "replacement_count_vote";
  db.prepare(`UPDATE cases SET ${column} = COALESCE(${column}, 0) + 1 WHERE case_id = ?`).run(
    input.caseId
  );
}

export function countAgentFiledInLast24h(db: Db, agentId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM cases WHERE prosecution_agent_id = ? AND filed_at IS NOT NULL AND filed_at >= ?`
    )
    .get(agentId, oneDayAgoIso()) as { count: number };
  return Number(row.count);
}

export function listEligibleJurors(
  db: Db,
  input: { excludeAgentIds: string[]; weeklyLimit: number }
): string[] {
  const excluded = new Set(input.excludeAgentIds);
  const rows = db
    .prepare(
      `
      SELECT a.agent_id AS agent_id
      FROM agents a
      INNER JOIN juror_availability j ON j.agent_id = a.agent_id
      WHERE a.banned = 0
      AND a.juror_eligible = 1
      AND j.availability IN ('available', 'limited')
      ORDER BY a.agent_id ASC
      `
    )
    .all() as Array<{ agent_id: string }>;

  const weekCutoff = oneWeekAgoIso();
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS count FROM jury_panel_members m INNER JOIN cases c ON c.case_id = m.case_id WHERE m.juror_id = ? AND c.jury_selected_at IS NOT NULL AND c.jury_selected_at >= ? AND m.member_status IN ('pending_ready','ready','active_voting','voted')`
  );

  const eligible: string[] = [];
  for (const row of rows) {
    if (excluded.has(row.agent_id)) {
      continue;
    }
    const countRow = countStmt.get(row.agent_id, weekCutoff) as { count: number };
    if (Number(countRow.count) >= input.weeklyLimit) {
      continue;
    }
    eligible.push(row.agent_id);
  }
  return eligible;
}

export function countActionInWindow(
  db: Db,
  input: { agentId: string; actionType: string; windowSeconds: number }
): number {
  const cutoffIso = new Date(Date.now() - input.windowSeconds * 1000).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM agent_action_log WHERE agent_id = ? AND action_type = ? AND created_at >= ?`
    )
    .get(input.agentId, input.actionType, cutoffIso) as { count: number };
  return Number(row.count);
}

export function logSignedAction(
  db: Db,
  input: {
    agentId: string;
    actionType: string;
    caseId?: string;
    signature: string;
    timestampSec: number;
  }
): void {
  db.prepare(
    `
    INSERT INTO agent_action_log (agent_id, action_type, case_id, signature, timestamp_sec, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(
    input.agentId,
    input.actionType,
    input.caseId ?? null,
    input.signature,
    input.timestampSec,
    nowIso()
  );
}

export function hasSignedAction(
  db: Db,
  input: { agentId: string; signature: string; timestampSec: number }
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM agent_action_log WHERE agent_id = ? AND signature = ? AND timestamp_sec = ?`
    )
    .get(input.agentId, input.signature, input.timestampSec) as { id: number } | undefined;
  return Boolean(row);
}

export function upsertCaseRuntime(
  db: Db,
  input: {
    caseId: string;
    currentStage: SessionStage;
    stageStartedAtIso: string;
    stageDeadlineAtIso: string | null;
    scheduledSessionStartAtIso: string | null;
    votingHardDeadlineAtIso: string | null;
    voidReason: CaseVoidReason | null;
    voidedAtIso: string | null;
  }
): void {
  db.prepare(
    `
      INSERT INTO case_runtime (
        case_id,
        current_stage,
        stage_started_at,
        stage_deadline_at,
        scheduled_session_start_at,
        voting_hard_deadline_at,
        void_reason,
        voided_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id)
      DO UPDATE SET
        current_stage = excluded.current_stage,
        stage_started_at = excluded.stage_started_at,
        stage_deadline_at = excluded.stage_deadline_at,
        scheduled_session_start_at = excluded.scheduled_session_start_at,
        voting_hard_deadline_at = excluded.voting_hard_deadline_at,
        void_reason = excluded.void_reason,
        voided_at = excluded.voided_at,
        updated_at = excluded.updated_at
    `
  ).run(
    input.caseId,
    input.currentStage,
    input.stageStartedAtIso,
    input.stageDeadlineAtIso,
    input.scheduledSessionStartAtIso,
    input.votingHardDeadlineAtIso,
    input.voidReason,
    input.voidedAtIso,
    nowIso()
  );
}

export function getCaseRuntime(db: Db, caseId: string): CaseSessionState | null {
  const row = db
    .prepare(
      `SELECT case_id, current_stage, stage_started_at, stage_deadline_at, scheduled_session_start_at, voting_hard_deadline_at, void_reason, voided_at FROM case_runtime WHERE case_id = ?`
    )
    .get(caseId) as
    | {
        case_id: string;
        current_stage: SessionStage;
        stage_started_at: string;
        stage_deadline_at: string | null;
        scheduled_session_start_at: string | null;
        voting_hard_deadline_at: string | null;
        void_reason: CaseVoidReason | null;
        voided_at: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    caseId: row.case_id,
    currentStage: row.current_stage,
    stageStartedAtIso: row.stage_started_at,
    stageDeadlineAtIso: row.stage_deadline_at ?? undefined,
    scheduledSessionStartAtIso: row.scheduled_session_start_at ?? undefined,
    votingHardDeadlineAtIso: row.voting_hard_deadline_at ?? undefined,
    voidReason: row.void_reason ?? undefined,
    voidedAtIso: row.voided_at ?? undefined
  };
}

export function updateCaseRuntimeStage(
  db: Db,
  input: {
    caseId: string;
    stage: SessionStage;
    stageStartedAtIso: string;
    stageDeadlineAtIso: string | null;
    votingHardDeadlineAtIso?: string | null;
  }
): void {
  const existing = getCaseRuntime(db, input.caseId);
  upsertCaseRuntime(db, {
    caseId: input.caseId,
    currentStage: input.stage,
    stageStartedAtIso: input.stageStartedAtIso,
    stageDeadlineAtIso: input.stageDeadlineAtIso,
    scheduledSessionStartAtIso: existing?.scheduledSessionStartAtIso ?? null,
    votingHardDeadlineAtIso:
      input.votingHardDeadlineAtIso === undefined
        ? (existing?.votingHardDeadlineAtIso ?? null)
        : input.votingHardDeadlineAtIso,
    voidReason: existing?.voidReason ?? null,
    voidedAtIso: existing?.voidedAtIso ?? null
  });
}

export function markCaseVoid(
  db: Db,
  input: { caseId: string; reason: CaseVoidReason; atIso: string }
): void {
  db.prepare(
    `UPDATE cases
      SET status = 'void',
          session_stage = 'void',
          void_reason = ?,
          void_reason_group = ?,
          voided_at = ?,
          decided_at = ?,
          outcome = 'void',
          outcome_detail_json = ?,
          seal_status = 'failed',
          seal_error = ?,
          sealed_disabled = 1
      WHERE case_id = ?`
  ).run(
    input.reason,
    toLearningVoidReasonGroup(input.reason),
    input.atIso,
    input.atIso,
    canonicalJson({ reason: input.reason }),
    `Case voided: ${input.reason}`,
    input.caseId
  );

  db.prepare(`UPDATE claims SET claim_outcome = 'undecided' WHERE case_id = ?`).run(input.caseId);

  const existing = getCaseRuntime(db, input.caseId);
  upsertCaseRuntime(db, {
    caseId: input.caseId,
    currentStage: "void",
    stageStartedAtIso: input.atIso,
    stageDeadlineAtIso: null,
    scheduledSessionStartAtIso: existing?.scheduledSessionStartAtIso ?? null,
    votingHardDeadlineAtIso: existing?.votingHardDeadlineAtIso ?? null,
    voidReason: input.reason,
    voidedAtIso: input.atIso
  });
}

export function markSessionStarted(db: Db, caseId: string, atIso: string): void {
  db.prepare(`UPDATE cases SET session_started_at = ?, session_stage = 'jury_readiness' WHERE case_id = ?`).run(
    atIso,
    caseId
  );
}

function nextTranscriptSeqNo(db: Db, caseId: string): number {
  const row = db
    .prepare(`SELECT last_event_seq_no FROM cases WHERE case_id = ?`)
    .get(caseId) as { last_event_seq_no: number } | undefined;
  if (!row) {
    throw new Error(`Case not found for transcript: ${caseId}`);
  }
  return Number(row.last_event_seq_no) + 1;
}

type TranscriptEventInput = {
  caseId: string;
  actorRole: TranscriptEvent["actorRole"];
  actorAgentId?: string;
  eventType: TranscriptEvent["eventType"];
  stage?: SessionStage;
  messageText: string;
  artefactType?: TranscriptEvent["artefactType"];
  artefactId?: string;
  payload?: Record<string, unknown>;
  createdAtIso?: string;
};

function appendTranscriptEventCore(db: Db, input: TranscriptEventInput): TranscriptEvent {
  const eventId = createId("evt");
  const createdAt = input.createdAtIso ?? nowIso();
  const seqNo = nextTranscriptSeqNo(db, input.caseId);

  db.prepare(
    `INSERT INTO case_transcript_events (event_id, case_id, seq_no, actor_role, actor_agent_id, event_type, stage, message_text, artefact_type, artefact_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    eventId,
    input.caseId,
    seqNo,
    input.actorRole,
    input.actorAgentId ?? null,
    input.eventType,
    input.stage ?? null,
    input.messageText,
    input.artefactType ?? null,
    input.artefactId ?? null,
    input.payload ? canonicalJson(input.payload) : null,
    createdAt
  );

  db.prepare(`UPDATE cases SET last_event_seq_no = ? WHERE case_id = ?`).run(seqNo, input.caseId);

  return {
    eventId,
    caseId: input.caseId,
    seqNo,
    actorRole: input.actorRole,
    actorAgentId: input.actorAgentId,
    eventType: input.eventType,
    stage: input.stage,
    messageText: input.messageText,
    artefactType: input.artefactType,
    artefactId: input.artefactId,
    payload: input.payload,
    createdAtIso: createdAt
  };
}

export function appendTranscriptEventInTransaction(
  db: Db,
  input: TranscriptEventInput
): TranscriptEvent {
  return appendTranscriptEventCore(db, input);
}

export function appendTranscriptEvent(
  db: Db,
  input: TranscriptEventInput
): TranscriptEvent {
  db.exec("BEGIN IMMEDIATE");
  try {
    const event = appendTranscriptEventCore(db, input);
    db.exec("COMMIT");
    return event;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listTranscriptEvents(
  db: Db,
  input: { caseId: string; afterSeq?: number; limit?: number }
): TranscriptEvent[] {
  const afterSeq = input.afterSeq ?? 0;
  const limit = Math.max(1, Math.min(input.limit ?? 200, 500));

  const rows = db
    .prepare(
      `SELECT event_id, case_id, seq_no, actor_role, actor_agent_id, event_type, stage, message_text, artefact_type, artefact_id, payload_json, created_at FROM case_transcript_events WHERE case_id = ? AND seq_no > ? ORDER BY seq_no ASC LIMIT ?`
    )
    .all(input.caseId, afterSeq, limit) as Array<{
    event_id: string;
    case_id: string;
    seq_no: number;
    actor_role: TranscriptEvent["actorRole"];
    actor_agent_id: string | null;
    event_type: TranscriptEvent["eventType"];
    stage: SessionStage | null;
    message_text: string;
    artefact_type: TranscriptEvent["artefactType"] | null;
    artefact_id: string | null;
    payload_json: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    eventId: row.event_id,
    caseId: row.case_id,
    seqNo: Number(row.seq_no),
    actorRole: row.actor_role,
    actorAgentId: row.actor_agent_id ?? undefined,
    eventType: row.event_type,
    stage: row.stage ?? undefined,
    messageText: row.message_text,
    artefactType: row.artefact_type ?? undefined,
    artefactId: row.artefact_id ?? undefined,
    payload: row.payload_json ? maybeJson<Record<string, unknown>>(row.payload_json, {}) : undefined,
    createdAtIso: row.created_at
  }));
}

export function listAssignedCasesForJuror(db: Db, agentId: string): AssignedCaseSummary[] {
  const rows = db
    .prepare(
      `
      SELECT
        c.case_id,
        c.summary,
        r.current_stage,
        r.stage_deadline_at,
        r.scheduled_session_start_at,
        m.ready_deadline_at,
        m.voting_deadline_at
      FROM jury_panel_members m
      INNER JOIN cases c ON c.case_id = m.case_id
      LEFT JOIN case_runtime r ON r.case_id = c.case_id
      WHERE m.juror_id = ?
      AND c.status IN ('filed','jury_selected','voting')
      AND m.member_status IN ('pending_ready','ready','active_voting')
      ORDER BY c.created_at DESC
      `
    )
    .all(agentId) as Array<{
    case_id: string;
    summary: string;
    current_stage: SessionStage | null;
    stage_deadline_at: string | null;
    scheduled_session_start_at: string | null;
    ready_deadline_at: string | null;
    voting_deadline_at: string | null;
  }>;

  return rows.map((row) => ({
    caseId: row.case_id,
    summary: row.summary,
    currentStage: (row.current_stage ?? "pre_session") as SessionStage,
    stageDeadlineAtIso: row.stage_deadline_at ?? undefined,
    scheduledSessionStartAtIso: row.scheduled_session_start_at ?? undefined,
    readinessDeadlineAtIso: row.ready_deadline_at ?? undefined,
    votingDeadlineAtIso: row.voting_deadline_at ?? undefined
  }));
}

export interface DefenceInviteDispatchTarget {
  caseId: string;
  summary: string;
  prosecutionAgentId: string;
  defendantAgentId: string;
  notifyUrl?: string;
  responseDeadlineAtIso?: string;
  inviteStatus: DefenceInviteStatus;
  inviteAttempts: number;
  inviteLastAttemptAtIso?: string;
  inviteLastError?: string;
}

export function getDefenceInviteDispatchTarget(
  db: Db,
  caseId: string
): DefenceInviteDispatchTarget | null {
  const row = db
    .prepare(
      `
      SELECT
        c.case_id,
        c.summary,
        c.prosecution_agent_id,
        c.defendant_agent_id,
        c.defendant_notify_url,
        c.defence_window_deadline,
        c.defence_invite_status,
        c.defence_invite_attempts,
        c.defence_invite_last_attempt_at,
        c.defence_invite_last_error,
        a.notify_url AS agent_notify_url
      FROM cases c
      LEFT JOIN agents a ON a.agent_id = c.defendant_agent_id
      WHERE c.case_id = ?
      LIMIT 1
      `
    )
    .get(caseId) as
    | {
        case_id: string;
        summary: string;
        prosecution_agent_id: string;
        defendant_agent_id: string | null;
        defendant_notify_url: string | null;
        defence_window_deadline: string | null;
        defence_invite_status: DefenceInviteStatus | null;
        defence_invite_attempts: number | null;
        defence_invite_last_attempt_at: string | null;
        defence_invite_last_error: string | null;
        agent_notify_url: string | null;
      }
    | undefined;

  if (!row || !row.defendant_agent_id) {
    return null;
  }

  return {
    caseId: row.case_id,
    summary: row.summary,
    prosecutionAgentId: row.prosecution_agent_id,
    defendantAgentId: row.defendant_agent_id,
    notifyUrl: row.defendant_notify_url ?? row.agent_notify_url ?? undefined,
    responseDeadlineAtIso: row.defence_window_deadline ?? undefined,
    inviteStatus: (row.defence_invite_status ?? "none") as DefenceInviteStatus,
    inviteAttempts: Number(row.defence_invite_attempts ?? 0),
    inviteLastAttemptAtIso: row.defence_invite_last_attempt_at ?? undefined,
    inviteLastError: row.defence_invite_last_error ?? undefined
  };
}

export function recordDefenceInviteAttempt(
  db: Db,
  input: {
    caseId: string;
    status: DefenceInviteStatus;
    attemptedAtIso: string;
    error?: string;
  }
): void {
  db.prepare(
    `
    UPDATE cases
    SET
      defence_invite_status = ?,
      defence_invite_attempts = defence_invite_attempts + 1,
      defence_invite_last_attempt_at = ?,
      defence_invite_last_error = ?
    WHERE case_id = ?
    `
  ).run(input.status, input.attemptedAtIso, input.error ?? null, input.caseId);
}

export function listDefenceInvitesForAgent(db: Db, agentId: string): DefenceInviteSummary[] {
  const rows = db
    .prepare(
      `
      SELECT
        case_id,
        summary,
        prosecution_agent_id,
        defendant_agent_id,
        filed_at,
        defence_window_deadline,
        defence_invite_status,
        defence_invite_attempts,
        defence_invite_last_attempt_at,
        defence_invite_last_error
      FROM cases
      WHERE defendant_agent_id = ?
        AND defence_agent_id IS NULL
        AND status IN ('filed', 'jury_selected', 'voting')
      ORDER BY filed_at DESC, created_at DESC
      `
    )
    .all(agentId) as Array<{
    case_id: string;
    summary: string;
    prosecution_agent_id: string;
    defendant_agent_id: string;
    filed_at: string | null;
    defence_window_deadline: string | null;
    defence_invite_status: DefenceInviteStatus | null;
    defence_invite_attempts: number | null;
    defence_invite_last_attempt_at: string | null;
    defence_invite_last_error: string | null;
  }>;

  return rows.map((row) => ({
    caseId: row.case_id,
    summary: row.summary,
    prosecutionAgentId: row.prosecution_agent_id,
    defendantAgentId: row.defendant_agent_id,
    filedAtIso: row.filed_at ?? undefined,
    responseDeadlineAtIso: row.defence_window_deadline ?? undefined,
    inviteStatus: (row.defence_invite_status ?? "none") as DefenceInviteStatus,
    inviteAttempts: Number(row.defence_invite_attempts ?? 0),
    inviteLastAttemptAtIso: row.defence_invite_last_attempt_at ?? undefined,
    inviteLastError: row.defence_invite_last_error ?? undefined,
    sessionStartsAfterAcceptanceSeconds: 3600
  }));
}

function mapUiStatus(caseRecord: CaseRecord): "scheduled" | "active" {
  if (
    ["jury_readiness", "opening_addresses", "evidence", "closing_addresses", "summing_up", "voting"].includes(
      caseRecord.sessionStage
    ) ||
    caseRecord.status === "voting"
  ) {
    return "active";
  }
  return "scheduled";
}

export function listOpenDefenceCases(
  db: Db,
  filters: OpenDefenceSearchFilters,
  options: { nowIso: string; namedExclusiveSec: number }
): OpenDefenceCaseSummary[] {
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
  const params: Array<string | number> = [options.nowIso];
  const where: string[] = [
    `status IN ('draft','filed','jury_selected','voting')`,
    `defence_agent_id IS NULL`,
    `(defence_window_deadline IS NULL OR defence_window_deadline > ?)`
  ];

  if (filters.q?.trim()) {
    where.push(`(case_id LIKE ? OR summary LIKE ?)`);
    params.push(`%${filters.q.trim()}%`, `%${filters.q.trim()}%`);
  }

  if (filters.startAfterIso) {
    where.push(`(scheduled_for IS NOT NULL AND scheduled_for >= ?)`);
    params.push(filters.startAfterIso);
  }
  if (filters.startBeforeIso) {
    where.push(`(scheduled_for IS NOT NULL AND scheduled_for <= ?)`);
    params.push(filters.startBeforeIso);
  }

  const rows = db
    .prepare(
      `
      SELECT
        case_id,
        public_slug,
        status,
        session_stage,
        prosecution_agent_id,
        defendant_agent_id,
        defence_agent_id,
        defence_state,
        defence_assigned_at,
        defence_window_deadline,
        defendant_notify_url,
        defence_invite_status,
        defence_invite_attempts,
        defence_invite_last_attempt_at,
        defence_invite_last_error,
        open_defence,
        case_topic,
        stake_level,
        summary,
        requested_remedy,
        created_at,
        filed_at,
        jury_selected_at,
        session_started_at,
        closed_at,
        sealed_at,
        void_reason,
        void_reason_group,
        voided_at,
        decided_at,
        outcome,
        outcome_detail_json,
        replacement_count_ready,
        replacement_count_vote,
        prosecution_principles_cited_json,
        defence_principles_cited_json,
        scheduled_for,
        countdown_end_at,
        countdown_total_ms,
        drand_round,
        drand_randomness,
        pool_snapshot_hash,
        selection_proof_json,
        verdict_hash,
        transcript_root_hash,
        jury_selection_proof_hash,
        ruleset_version,
        metadata_uri,
        seal_status,
        seal_error,
        verdict_bundle_json,
        seal_asset_id,
        seal_tx_sig,
        seal_uri,
        filing_warning
      FROM cases
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(scheduled_for, created_at) ASC
      LIMIT ?
      `
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  const mapped = rows.map(mapCaseRow);
  const withTags = mapped.map((item) => {
    const claims = listClaims(db, item.caseId);
    const tags = [...new Set(claims.flatMap((claim) => claim.allegedPrinciples.map((id) => `P${id}`)))];
    const nowMs = new Date(options.nowIso).getTime();
    const exclusiveWindowEndMs =
      (item.filedAtIso ? new Date(item.filedAtIso).getTime() : new Date(item.createdAtIso).getTime()) +
      options.namedExclusiveSec * 1000;
    const reserved = Boolean(item.defendantAgentId) && nowMs < exclusiveWindowEndMs;
    return {
      caseId: item.caseId,
      status: mapUiStatus(item),
      summary: item.summary,
      prosecutionAgentId: item.prosecutionAgentId,
      defendantAgentId: item.defendantAgentId,
      defenceState: item.defenceState,
      filedAtIso: item.filedAtIso,
      scheduledForIso: item.scheduledForIso,
      defenceWindowDeadlineIso: item.defenceWindowDeadlineIso,
      tags,
      claimable: !reserved,
      claimStatus: reserved ? "reserved" : "open"
    } satisfies OpenDefenceCaseSummary;
  });

  const filteredByStatus =
    filters.status && filters.status !== "all"
      ? withTags.filter((item) => item.status === filters.status)
      : withTags;
  const filteredByTag =
    filters.tag && filters.tag.trim()
      ? filteredByStatus.filter((item) => item.tags.some((tag) => tag === filters.tag))
      : filteredByStatus;

  return filteredByTag;
}

export function logAgentCaseActivity(
  db: Db,
  input: {
    agentId: string;
    caseId: string;
    role: "prosecution" | "defence" | "juror";
    outcome: CaseOutcome | "void" | "pending";
    recordedAtIso?: string;
  }
): AgentActivityEntry {
  const activityId = createId("act");
  const recordedAtIso = input.recordedAtIso ?? nowIso();
  db.prepare(
    `INSERT INTO agent_case_activity (activity_id, agent_id, case_id, role, outcome, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(activityId, input.agentId, input.caseId, input.role, input.outcome, recordedAtIso);
  return {
    activityId,
    agentId: input.agentId,
    caseId: input.caseId,
    role: input.role,
    outcome: input.outcome,
    recordedAtIso
  };
}

export function clearAgentCaseActivity(db: Db, caseId: string): void {
  db.prepare(`DELETE FROM agent_case_activity WHERE case_id = ?`).run(caseId);
}

export function listAgentActivity(db: Db, agentId: string, limit = 20): AgentActivityEntry[] {
  const rows = db
    .prepare(
      `
      SELECT activity_id, agent_id, case_id, role, outcome, recorded_at
      FROM agent_case_activity
      WHERE agent_id = ?
      ORDER BY recorded_at DESC
      LIMIT ?
      `
    )
    .all(agentId, Math.max(1, Math.min(limit, 200))) as Array<{
    activity_id: string;
    agent_id: string;
    case_id: string;
    role: "prosecution" | "defence" | "juror";
    outcome: CaseOutcome | "void" | "pending";
    recorded_at: string;
  }>;
  return rows.map((row) => ({
    activityId: row.activity_id,
    agentId: row.agent_id,
    caseId: row.case_id,
    role: row.role,
    outcome: row.outcome,
    recordedAtIso: row.recorded_at
  }));
}

function rebuildAgentStatsForAgent(db: Db, agentId: string): AgentStats {
  const prosecutionRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN outcome = 'for_prosecution' THEN 1 ELSE 0 END) AS wins
      FROM agent_case_activity
      WHERE agent_id = ? AND role = 'prosecution' AND outcome IN ('for_prosecution','for_defence')
      `
    )
    .get(agentId) as { total: number; wins: number | null };

  const defenceRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN outcome = 'for_defence' THEN 1 ELSE 0 END) AS wins
      FROM agent_case_activity
      WHERE agent_id = ? AND role = 'defence' AND outcome IN ('for_prosecution','for_defence')
      `
    )
    .get(agentId) as { total: number; wins: number | null };

  const juriesRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM agent_case_activity
      WHERE agent_id = ? AND role = 'juror' AND outcome != 'pending'
      `
    )
    .get(agentId) as { total: number };

  const lastActiveRow = db
    .prepare(
      `SELECT MAX(recorded_at) AS last_active_at FROM agent_case_activity WHERE agent_id = ?`
    )
    .get(agentId) as { last_active_at: string | null };

  const prosecutionsTotal = Number(prosecutionRow.total || 0);
  const prosecutionsWins = Number(prosecutionRow.wins || 0);
  const defencesTotal = Number(defenceRow.total || 0);
  const defencesWins = Number(defenceRow.wins || 0);
  const juriesTotal = Number(juriesRow.total || 0);
  const decidedCasesTotal = prosecutionsTotal + defencesTotal;
  const wins = prosecutionsWins + defencesWins;
  const victoryPercent = decidedCasesTotal > 0 ? Number(((wins / decidedCasesTotal) * 100).toFixed(2)) : 0;
  const updatedAt = nowIso();

  db.prepare(
    `
    INSERT INTO agent_stats_cache (
      agent_id,
      prosecutions_total,
      prosecutions_wins,
      defences_total,
      defences_wins,
      juries_total,
      decided_cases_total,
      victory_percent,
      last_active_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      prosecutions_total = excluded.prosecutions_total,
      prosecutions_wins = excluded.prosecutions_wins,
      defences_total = excluded.defences_total,
      defences_wins = excluded.defences_wins,
      juries_total = excluded.juries_total,
      decided_cases_total = excluded.decided_cases_total,
      victory_percent = excluded.victory_percent,
      last_active_at = excluded.last_active_at,
      updated_at = excluded.updated_at
    `
  ).run(
    agentId,
    prosecutionsTotal,
    prosecutionsWins,
    defencesTotal,
    defencesWins,
    juriesTotal,
    decidedCasesTotal,
    victoryPercent,
    lastActiveRow.last_active_at ?? null,
    updatedAt
  );

  return {
    agentId,
    prosecutionsTotal,
    prosecutionsWins,
    defencesTotal,
    defencesWins,
    juriesTotal,
    decidedCasesTotal,
    victoryPercent,
    lastActiveAtIso: lastActiveRow.last_active_at ?? undefined
  };
}

export function rebuildAgentStatsForCase(db: Db, caseId: string): void {
  const rows = db
    .prepare(`SELECT DISTINCT agent_id FROM agent_case_activity WHERE case_id = ?`)
    .all(caseId) as Array<{ agent_id: string }>;
  for (const row of rows) {
    rebuildAgentStatsForAgent(db, row.agent_id);
  }
}

export function rebuildAllAgentStats(db: Db): void {
  const rows = db.prepare(`SELECT agent_id FROM agents`).all() as Array<{ agent_id: string }>;
  for (const row of rows) {
    rebuildAgentStatsForAgent(db, row.agent_id);
  }
}

export function getAgentStats(db: Db, agentId: string): AgentStats {
  const row = db
    .prepare(
      `
      SELECT
        agent_id,
        prosecutions_total,
        prosecutions_wins,
        defences_total,
        defences_wins,
        juries_total,
        decided_cases_total,
        victory_percent,
        last_active_at
      FROM agent_stats_cache
      WHERE agent_id = ?
      LIMIT 1
      `
    )
    .get(agentId) as
    | {
        agent_id: string;
        prosecutions_total: number;
        prosecutions_wins: number;
        defences_total: number;
        defences_wins: number;
        juries_total: number;
        decided_cases_total: number;
        victory_percent: number;
        last_active_at: string | null;
      }
    | undefined;
  if (!row) {
    return rebuildAgentStatsForAgent(db, agentId);
  }
  return {
    agentId: row.agent_id,
    prosecutionsTotal: Number(row.prosecutions_total),
    prosecutionsWins: Number(row.prosecutions_wins),
    defencesTotal: Number(row.defences_total),
    defencesWins: Number(row.defences_wins),
    juriesTotal: Number(row.juries_total),
    decidedCasesTotal: Number(row.decided_cases_total),
    victoryPercent: Number(row.victory_percent),
    lastActiveAtIso: row.last_active_at ?? undefined
  };
}

export function getAgentProfile(
  db: Db,
  agentId: string,
  input?: { activityLimit?: number }
): AgentProfile | null {
  const agentRow = db
    .prepare(`SELECT display_name, id_number, bio, stats_public FROM agents WHERE agent_id = ?`)
    .get(agentId) as
    | { display_name: string | null; id_number: string | null; bio: string | null; stats_public: number }
    | undefined;
  if (!agentRow) return null;
  return {
    agentId,
    displayName: agentRow.display_name ?? undefined,
    idNumber: agentRow.id_number ?? undefined,
    bio: agentRow.bio ?? undefined,
    statsPublic: agentRow.stats_public === 1,
    stats: getAgentStats(db, agentId),
    recentActivity: listAgentActivity(db, agentId, input?.activityLimit ?? 20)
  };
}

export function listLeaderboard(
  db: Db,
  input?: { limit?: number; minDecidedCases?: number }
): LeaderboardEntry[] {
  const limit = Math.max(1, Math.min(input?.limit ?? 20, 100));
  const minDecidedCases = Math.max(0, input?.minDecidedCases ?? 5);

  const rows = db
    .prepare(
      `
      SELECT
        asc_.agent_id,
        asc_.prosecutions_total,
        asc_.prosecutions_wins,
        asc_.defences_total,
        asc_.defences_wins,
        asc_.juries_total,
        asc_.decided_cases_total,
        asc_.victory_percent,
        asc_.last_active_at,
        a.display_name
      FROM agent_stats_cache asc_
      JOIN agents a ON a.agent_id = asc_.agent_id
      WHERE asc_.decided_cases_total >= ?
        AND a.stats_public = 1
      ORDER BY asc_.victory_percent DESC, asc_.decided_cases_total DESC, COALESCE(asc_.last_active_at, '') DESC, asc_.agent_id ASC
      LIMIT ?
      `
    )
    .all(minDecidedCases, limit) as Array<{
    agent_id: string;
    prosecutions_total: number;
    prosecutions_wins: number;
    defences_total: number;
    defences_wins: number;
    juries_total: number;
    decided_cases_total: number;
    victory_percent: number;
    last_active_at: string | null;
    display_name: string | null;
  }>;

  return rows.map((row, idx) => ({
    rank: idx + 1,
    agentId: row.agent_id,
    displayName: row.display_name ?? undefined,
    prosecutionsTotal: Number(row.prosecutions_total),
    prosecutionsWins: Number(row.prosecutions_wins),
    defencesTotal: Number(row.defences_total),
    defencesWins: Number(row.defences_wins),
    juriesTotal: Number(row.juries_total),
    decidedCasesTotal: Number(row.decided_cases_total),
    victoryPercent: Number(row.victory_percent),
    lastActiveAtIso: row.last_active_at ?? undefined
  }));
}

export function searchAgents(
  db: Db,
  input: { q?: string; limit?: number }
): Array<{ agentId: string; displayName?: string }> {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
  const q = (input.q ?? "").trim();

  if (!q) {
    const rows = db
      .prepare(
        `
      SELECT a.agent_id, a.display_name
      FROM agent_stats_cache asc_
      JOIN agents a ON a.agent_id = asc_.agent_id
      WHERE a.stats_public = 1 AND asc_.decided_cases_total >= 1
      ORDER BY asc_.victory_percent DESC, asc_.decided_cases_total DESC, asc_.last_active_at DESC
      LIMIT ?
      `
      )
      .all(limit) as Array<{ agent_id: string; display_name: string | null }>;
    return rows.map((r) => ({
      agentId: r.agent_id,
      displayName: r.display_name ?? undefined
    }));
  }

  const pattern = `%${q}%`;
  const lowerPattern = `%${q.toLowerCase()}%`;
  const rows = db
    .prepare(
      `
    SELECT agent_id, display_name FROM agents
    WHERE agent_id LIKE ? OR (display_name IS NOT NULL AND LOWER(display_name) LIKE ?)
    ORDER BY display_name IS NOT NULL DESC, display_name ASC, agent_id ASC
    LIMIT ?
    `
    )
    .all(pattern, lowerPattern, limit) as Array<{ agent_id: string; display_name: string | null }>;
  return rows.map((r) => ({
    agentId: r.agent_id,
    displayName: r.display_name ?? undefined
  }));
}

export function purgeExpiredIdempotency(db: Db): void {
  db.prepare(`DELETE FROM idempotency_records WHERE expires_at <= ?`).run(nowIso());
}

export function getIdempotencyRecord(
  db: Db,
  input: { agentId: string; method: string; path: string; idempotencyKey: string }
): IdempotencyRecord | null {
  const row = db
    .prepare(
      `SELECT response_status, response_json, request_hash FROM idempotency_records WHERE agent_id = ? AND method = ? AND path = ? AND idempotency_key = ? AND status = 'complete' AND expires_at > ? LIMIT 1`
    )
    .get(input.agentId, input.method, input.path, input.idempotencyKey, nowIso()) as
    | {
        response_status: number;
        response_json: string;
        request_hash: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    responseStatus: Number(row.response_status),
    responseJson: maybeJson(row.response_json, {}),
    requestHash: row.request_hash
  };
}

export type TryClaimIdempotencyResult =
  | { claimed: true }
  | { claimed: false; replay: { status: number; payload: unknown } };

export function tryClaimIdempotency(
  db: Db,
  input: {
    agentId: string;
    method: string;
    path: string;
    caseId?: string;
    idempotencyKey: string;
    requestHash: string;
    ttlSec: number;
  }
): TryClaimIdempotencyResult {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + input.ttlSec * 1000).toISOString();

  try {
    db.prepare(
      `
      INSERT INTO idempotency_records (
        agent_id,
        method,
        path,
        case_id,
        idempotency_key,
        request_hash,
        response_status,
        response_json,
        status,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, '{}', 'in_progress', ?, ?)
    `
    ).run(
      input.agentId,
      input.method,
      input.path,
      input.caseId ?? null,
      input.idempotencyKey,
      input.requestHash,
      createdAt,
      expiresAt
    );
    return { claimed: true };
  } catch (err) {
    const sqliteErr = err as { code?: string; message?: string };
    const isUniqueConstraint =
      sqliteErr.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      (typeof sqliteErr.message === "string" &&
        sqliteErr.message.toLowerCase().includes("unique constraint failed"));
    if (!isUniqueConstraint) {
      throw err;
    }
  }

  const existing = db
    .prepare(
      `SELECT request_hash, status, response_status, response_json FROM idempotency_records WHERE agent_id = ? AND method = ? AND path = ? AND idempotency_key = ? AND expires_at > ? LIMIT 1`
    )
    .get(input.agentId, input.method, input.path, input.idempotencyKey, nowIso()) as
    | {
        request_hash: string;
        status: string;
        response_status: number;
        response_json: string;
      }
    | undefined;

  if (!existing) {
    throw new Error("Idempotency record not found after conflict.");
  }

  if (existing.request_hash !== input.requestHash) {
    throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
  }

  if (existing.status === "in_progress") {
    throw new Error("IDEMPOTENCY_IN_PROGRESS");
  }

  return {
    claimed: false,
    replay: {
      status: Number(existing.response_status),
      payload: maybeJson(existing.response_json, {})
    }
  };
}

export function completeIdempotencyRecord(
  db: Db,
  input: {
    agentId: string;
    method: string;
    path: string;
    idempotencyKey: string;
    responseStatus: number;
    responseJson: unknown;
  }
): void {
  const result = db
    .prepare(
      `UPDATE idempotency_records SET status = 'complete', response_status = ?, response_json = ? WHERE agent_id = ? AND method = ? AND path = ? AND idempotency_key = ? AND status = 'in_progress'`
    )
    .run(
      input.responseStatus,
      canonicalJson(normaliseSerializable(input.responseJson)),
      input.agentId,
      input.method,
      input.path,
      input.idempotencyKey
    );

  if (result.changes === 0) {
    throw new Error("Idempotency record not found or already completed.");
  }
}

export function releaseIdempotencyClaim(
  db: Db,
  input: { agentId: string; method: string; path: string; idempotencyKey: string }
): void {
  db.prepare(
    `DELETE FROM idempotency_records WHERE agent_id = ? AND method = ? AND path = ? AND idempotency_key = ? AND status = 'in_progress'`
  ).run(input.agentId, input.method, input.path, input.idempotencyKey);
}

export function saveIdempotencyRecord(
  db: Db,
  input: {
    agentId: string;
    method: string;
    path: string;
    caseId?: string;
    idempotencyKey: string;
    requestHash: string;
    responseStatus: number;
    responseJson: unknown;
    ttlSec: number;
  }
): void {
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + input.ttlSec * 1000).toISOString();

  db.prepare(
    `
      INSERT INTO idempotency_records (
        agent_id,
        method,
        path,
        case_id,
        idempotency_key,
        request_hash,
        response_status,
        response_json,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, method, path, idempotency_key)
      DO UPDATE SET
        case_id = excluded.case_id,
        request_hash = excluded.request_hash,
        response_status = excluded.response_status,
        response_json = excluded.response_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `
  ).run(
    input.agentId,
    input.method,
    input.path,
    input.caseId ?? null,
    input.idempotencyKey,
    input.requestHash,
    input.responseStatus,
    canonicalJson(normaliseSerializable(input.responseJson)),
    createdAt,
    expiresAt
  );
}

export function listDecisions(db: Db): Array<{
  caseId: string;
  summary: string;
  status: "closed" | "sealed" | "void";
  outcome: "for_prosecution" | "for_defence" | "void";
  closedAtIso: string;
  verdictHash: string;
  sealAssetId?: string;
  sealTxSig?: string;
  sealUri?: string;
  voidReason?: string;
}> {
  const rows = db
    .prepare(
      `
      SELECT case_id, summary, status, closed_at, decided_at, outcome, verdict_hash, verdict_bundle_json, seal_asset_id, seal_tx_sig, seal_uri, void_reason, created_at, voided_at
      FROM cases
      WHERE status IN ('closed', 'sealed', 'void')
      ORDER BY COALESCE(decided_at, closed_at, voided_at, created_at) DESC
      `
    )
    .all() as Array<{
    case_id: string;
    summary: string;
    status: "closed" | "sealed" | "void";
    closed_at: string | null;
    decided_at: string | null;
    outcome: "for_prosecution" | "for_defence" | "void" | null;
    verdict_hash: string | null;
    verdict_bundle_json: string | null;
    seal_asset_id: string | null;
    seal_tx_sig: string | null;
    seal_uri: string | null;
    void_reason: string | null;
    created_at: string;
    voided_at: string | null;
  }>;

  return rows.map((row) => {
    const bundle = row.verdict_bundle_json
      ? maybeJson<{
          overall?: { outcome?: "for_prosecution" | "for_defence" };
        }>(row.verdict_bundle_json, {})
      : {};
    const outcome =
      row.outcome ??
      (row.status === "void"
        ? "void"
        : ((bundle.overall?.outcome as "for_prosecution" | "for_defence" | undefined) ?? "void"));
    return {
      caseId: row.case_id,
      summary: row.summary,
      status: row.status,
      outcome,
      closedAtIso: row.decided_at ?? row.closed_at ?? row.voided_at ?? row.created_at,
      verdictHash: row.verdict_hash ?? "",
      sealAssetId: row.seal_asset_id ?? undefined,
      sealTxSig: row.seal_tx_sig ?? undefined,
      sealUri: row.seal_uri ?? undefined,
      voidReason: row.void_reason ?? undefined
    };
  });
}

export function getCaseIntegrityDiagnostics(
  db: Db,
  caseId: string
): {
  caseId: string;
  panelCount: number;
  activeMemberCount: number;
  hasDuplicateMembers: boolean;
  runtimeStage?: SessionStage;
  caseStage?: SessionStage;
  runtimeStatusConsistent: boolean;
} {
  const caseRecord = getCaseById(db, caseId);
  const runtime = getCaseRuntime(db, caseId);
  const members = listJuryPanelMembers(db, caseId);
  const memberIds = members.map((item) => item.jurorId);
  const uniqueCount = new Set(memberIds).size;
  const activeMemberCount = members.filter(
    (item) => !["timed_out", "replaced"].includes(item.memberStatus)
  ).length;

  return {
    caseId,
    panelCount: members.length,
    activeMemberCount,
    hasDuplicateMembers: uniqueCount !== members.length,
    runtimeStage: runtime?.currentStage,
    caseStage: caseRecord?.sessionStage,
    runtimeStatusConsistent:
      !runtime || !caseRecord ? false : runtime.currentStage === caseRecord.sessionStage
  };
}

export function getDecisionCase(db: Db, id: string): CaseRecord | null {
  const row = db
    .prepare(`SELECT case_id FROM cases WHERE case_id = ? OR public_slug = ? LIMIT 1`)
    .get(id, id) as { case_id: string } | undefined;
  if (!row) {
    return null;
  }
  return getCaseById(db, row.case_id);
}

export function getSealJobByCaseId(
  db: Db,
  caseId: string
): {
  jobId: string;
  status: string;
  attempts: number;
  lastError?: string;
  metadataUri?: string;
} | null {
  const row = db
    .prepare(`SELECT job_id, status, attempts, last_error, metadata_uri FROM seal_jobs WHERE case_id = ?`)
    .get(caseId) as
    | {
        job_id: string;
        status: string;
        attempts: number;
        last_error: string | null;
        metadata_uri: string | null;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    jobId: row.job_id,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ?? undefined,
    metadataUri: row.metadata_uri ?? undefined
  };
}

export interface SealJobRecord {
  jobId: string;
  caseId: string;
  status: string;
  attempts: number;
  lastError?: string;
  claimedAtIso?: string;
  completedAtIso?: string;
  payloadHash: string;
  metadataUri?: string;
  requestJson: unknown;
  responseJson: unknown;
}

export function listQueuedSealJobs(
  db: Db,
  options?: { olderThanMinutes?: number; maxAttempts?: number }
): Array<{ jobId: string; caseId: string; createdAtIso: string }> {
  let sql = `SELECT job_id, case_id, created_at FROM seal_jobs WHERE status IN ('queued','failed') AND (last_error IS NULL OR last_error NOT LIKE 'NON_RETRYABLE:%')`;
  const params: Array<string | number> = [];
  if (options?.olderThanMinutes != null && options.olderThanMinutes > 0) {
    const cutoff = new Date(Date.now() - options.olderThanMinutes * 60 * 1000).toISOString();
    sql += ` AND created_at <= ?`;
    params.push(cutoff);
  }
  if (options?.maxAttempts != null && options.maxAttempts > 0) {
    sql += ` AND attempts < ?`;
    params.push(options.maxAttempts);
  }
  sql += ` ORDER BY created_at ASC`;
  const rows = db.prepare(sql).all(...params) as Array<{
    job_id: string;
    case_id: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    jobId: r.job_id,
    caseId: r.case_id,
    createdAtIso: r.created_at
  }));
}

export function getSealJobByJobId(db: Db, jobId: string): SealJobRecord | null {
  const row = db
    .prepare(
      `SELECT job_id, case_id, status, attempts, last_error, claimed_at, completed_at, payload_hash, metadata_uri, request_json, response_json FROM seal_jobs WHERE job_id = ?`
    )
    .get(jobId) as
    | {
        job_id: string;
        case_id: string;
        status: string;
        attempts: number;
        last_error: string | null;
        claimed_at: string | null;
        completed_at: string | null;
        payload_hash: string;
        metadata_uri: string | null;
        request_json: string;
        response_json: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    jobId: row.job_id,
    caseId: row.case_id,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error ?? undefined,
    claimedAtIso: row.claimed_at ?? undefined,
    completedAtIso: row.completed_at ?? undefined,
    payloadHash: row.payload_hash ?? "",
    metadataUri: row.metadata_uri ?? undefined,
    requestJson: maybeJson(row.request_json, {}),
    responseJson: row.response_json ? maybeJson(row.response_json, {}) : null
  };
}

// ── ML feature store ──────────────────────────────────────────────────────────

/** Upsert a per-juror ML feature row. Called at ballot submission time. */
export function upsertMlJurorFeatures(
  db: Db,
  input: {
    caseId: string;
    jurorId: string;
    vote: string | null;
    rationale: string;
    replaced: boolean;
    replacementReason?: string | null;
    signals: MlSignals | null;
  }
): void {
  const s = input.signals ?? {};
  db.prepare(
    `
    INSERT INTO ml_juror_features (
      case_id, juror_id, vote, rationale,
      principle_importance, decisive_principle_index, confidence,
      uncertainty_type, severity, harm_domains, primary_basis,
      evidence_quality, missing_evidence_type,
      recommended_remedy, proportionality,
      decisive_evidence_id, process_flags,
      replaced, replacement_reason,
      capture_version, created_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      'v1', ?
    )
    ON CONFLICT(case_id, juror_id) DO UPDATE SET
      vote                   = excluded.vote,
      rationale              = excluded.rationale,
      principle_importance   = excluded.principle_importance,
      decisive_principle_index = excluded.decisive_principle_index,
      confidence             = excluded.confidence,
      uncertainty_type       = excluded.uncertainty_type,
      severity               = excluded.severity,
      harm_domains           = excluded.harm_domains,
      primary_basis          = excluded.primary_basis,
      evidence_quality       = excluded.evidence_quality,
      missing_evidence_type  = excluded.missing_evidence_type,
      recommended_remedy     = excluded.recommended_remedy,
      proportionality        = excluded.proportionality,
      decisive_evidence_id   = excluded.decisive_evidence_id,
      process_flags          = excluded.process_flags,
      replaced               = excluded.replaced,
      replacement_reason     = excluded.replacement_reason
    `
  ).run(
    input.caseId,
    input.jurorId,
    input.vote ?? null,
    input.rationale,
    s.principleImportance ? canonicalJson(s.principleImportance) : null,
    s.decisivePrincipleIndex ?? null,
    s.mlConfidence ?? null,
    s.uncertaintyType ?? null,
    s.severity ?? null,
    s.harmDomains ? canonicalJson(s.harmDomains) : null,
    s.primaryBasis ?? null,
    s.evidenceQuality ?? null,
    s.missingEvidenceType ?? null,
    s.recommendedRemedy ?? null,
    s.proportionality ?? null,
    s.decisiveEvidenceId ?? null,
    s.processFlags ? canonicalJson(s.processFlags) : null,
    input.replaced ? 1 : 0,
    input.replacementReason ?? null,
    nowIso()
  );
}

/** Upsert a per-case ML feature row. Called when a case closes or is voided. */
export function upsertMlCaseFeatures(
  db: Db,
  input: {
    caseId: string;
    agenticCodeVersion: string;
    outcome: string | null;
    voidReasonGroup: string | null;
    scheduledAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
    caseTopicTags?: string[] | null;
  }
): void {
  db.prepare(
    `
    INSERT INTO ml_case_features (
      case_id, agentic_code_version, outcome, void_reason_group,
      scheduled_at, started_at, ended_at,
      case_topic_tags, capture_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'v1', ?)
    ON CONFLICT(case_id) DO UPDATE SET
      agentic_code_version = excluded.agentic_code_version,
      outcome              = excluded.outcome,
      void_reason_group    = excluded.void_reason_group,
      scheduled_at         = excluded.scheduled_at,
      started_at           = excluded.started_at,
      ended_at             = excluded.ended_at,
      case_topic_tags      = excluded.case_topic_tags
    `
  ).run(
    input.caseId,
    input.agenticCodeVersion,
    input.outcome ?? null,
    input.voidReasonGroup ?? null,
    input.scheduledAt ?? null,
    input.startedAt ?? null,
    input.endedAt ?? null,
    input.caseTopicTags ? canonicalJson(input.caseTopicTags) : null,
    nowIso()
  );
}

/** Flat export row returned by listMlExport. */
export interface MlExportRow {
  caseId: string;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  outcome: string | null;
  voidReasonGroup: string | null;
  agenticCodeVersion: string;
  caseTopicTags: string[] | null;
  jurorId: string;
  vote: string | null;
  rationale: string;
  principleImportance: number[] | null;
  decisivePrincipleIndex: number | null;
  confidence: number | null;
  uncertaintyType: string | null;
  severity: number | null;
  harmDomains: string[] | null;
  primaryBasis: string | null;
  evidenceQuality: number | null;
  missingEvidenceType: string | null;
  recommendedRemedy: string | null;
  proportionality: string | null;
  decisiveEvidenceId: string | null;
  processFlags: string[] | null;
  replaced: boolean;
  replacementReason: string | null;
  captureVersion: string;
  createdAt: string;
}

/** Returns all ml_juror_features rows joined with ml_case_features for export. */
export function listMlExport(db: Db, input?: { limit?: number; offset?: number }): MlExportRow[] {
  const limit = Math.min(input?.limit ?? 1000, 5000);
  const offset = input?.offset ?? 0;

  const rows = db.prepare(
    `
    SELECT
      j.case_id,
      c.scheduled_at,
      c.started_at,
      c.ended_at,
      c.outcome,
      c.void_reason_group,
      COALESCE(c.agentic_code_version, 'v1') AS agentic_code_version,
      c.case_topic_tags,
      j.juror_id,
      j.vote,
      j.rationale,
      j.principle_importance,
      j.decisive_principle_index,
      j.confidence,
      j.uncertainty_type,
      j.severity,
      j.harm_domains,
      j.primary_basis,
      j.evidence_quality,
      j.missing_evidence_type,
      j.recommended_remedy,
      j.proportionality,
      j.decisive_evidence_id,
      j.process_flags,
      j.replaced,
      j.replacement_reason,
      j.capture_version,
      j.created_at
    FROM ml_juror_features j
    LEFT JOIN ml_case_features c ON c.case_id = j.case_id
    ORDER BY j.case_id ASC, j.juror_id ASC
    LIMIT ? OFFSET ?
    `
  ).all(limit, offset) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    caseId: String(r.case_id),
    scheduledAt: r.scheduled_at ? String(r.scheduled_at) : null,
    startedAt: r.started_at ? String(r.started_at) : null,
    endedAt: r.ended_at ? String(r.ended_at) : null,
    outcome: r.outcome ? String(r.outcome) : null,
    voidReasonGroup: r.void_reason_group ? String(r.void_reason_group) : null,
    agenticCodeVersion: String(r.agentic_code_version ?? "v1"),
    caseTopicTags: r.case_topic_tags ? maybeJson<string[]>(r.case_topic_tags as string, []) : null,
    jurorId: String(r.juror_id),
    vote: r.vote ? String(r.vote) : null,
    rationale: String(r.rationale ?? ""),
    principleImportance: r.principle_importance ? maybeJson<number[]>(r.principle_importance as string, []) : null,
    decisivePrincipleIndex: r.decisive_principle_index != null ? Number(r.decisive_principle_index) : null,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    uncertaintyType: r.uncertainty_type ? String(r.uncertainty_type) : null,
    severity: r.severity != null ? Number(r.severity) : null,
    harmDomains: r.harm_domains ? maybeJson<string[]>(r.harm_domains as string, []) : null,
    primaryBasis: r.primary_basis ? String(r.primary_basis) : null,
    evidenceQuality: r.evidence_quality != null ? Number(r.evidence_quality) : null,
    missingEvidenceType: r.missing_evidence_type ? String(r.missing_evidence_type) : null,
    recommendedRemedy: r.recommended_remedy ? String(r.recommended_remedy) : null,
    proportionality: r.proportionality ? String(r.proportionality) : null,
    decisiveEvidenceId: r.decisive_evidence_id ? String(r.decisive_evidence_id) : null,
    processFlags: r.process_flags ? maybeJson<string[]>(r.process_flags as string, []) : null,
    replaced: r.replaced === 1,
    replacementReason: r.replacement_reason ? String(r.replacement_reason) : null,
    captureVersion: String(r.capture_version ?? "v1"),
    createdAt: String(r.created_at)
  }));
}
// ─────────────────────────────────────────────────────────────────────────────
