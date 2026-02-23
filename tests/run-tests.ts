import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { canonicalJson } from "../shared/canonicalJson";
import { encodeBase58 } from "../shared/base58";
import { canonicalHashHex } from "../shared/hash";
import type { VoteEntry } from "../shared/contracts";
import { signPayload, verifySignedPayload } from "../shared/signing";
import { selectJuryDeterministically } from "../server/services/jury";
import { computeDeterministicVerdict } from "../server/services/verdict";
import { getConfig } from "../server/config";
import { openDatabase, resetDatabase } from "../server/db/sqlite";
import { hashCapabilityToken, verifySignedMutation } from "../server/services/auth";
import { setSecurityHeaders } from "../server/services/http";
import { createSolanaProvider } from "../server/services/solanaProvider";
import {
  clampComputeUnitLimit,
  createPaymentEstimator,
  isValidSolanaPubkey,
  priorityFeeLamports
} from "../server/services/paymentEstimator";
import {
  appendTranscriptEvent,
  claimDefenceAssignment,
  clearAgentCaseActivity,
  createAgentCapability,
  createCaseDraft,
  getCaseById,
  getCaseRuntime,
  getAgentProfile,
  getIdempotencyRecord,
  isTreasuryTxUsed,
  listLeaderboard,
  listOpenDefenceCases,
  logAgentCaseActivity,
  rebuildAllAgentStats,
  revokeAgentCapabilityByHash,
  saveIdempotencyRecord,
  saveUsedTreasuryTx,
  setCaseFiled,
  upsertAgent
} from "../server/db/repository";
import { createSessionEngine } from "../server/services/sessionEngine";
import { createDrandClient } from "../server/services/drand";
import {
  normalisePrincipleIds,
  validateCaseTopic,
  validateEvidenceAttachmentUrls,
  validateNotifyUrl,
  validateReasoningSummary,
  validateStakeLevel
} from "../server/services/validation";
import { hashJurySelectionProof, hashTranscriptProjection } from "../server/services/sealHashes";
import {
  computeCountdownState,
  computeRingDashOffset,
  formatDurationLabel
} from "../src/util/countdown";
import { parseRoute, routeToPath } from "../src/util/router";
import { loadOpenClawToolRegistry } from "../server/integrations/openclaw/exampleToolRegistry";
import { OPENCAWT_OPENCLAW_TOOLS } from "../shared/openclawTools";
import { PROSECUTION_VOTE_PROMPT, mapVoteToAnswer } from "../shared/transcriptVoting";
import { validateMlSignals, MlValidationError } from "../server/ml/validateMlSignals";

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  action: () => T | Promise<T>
): Promise<T> | T {
  const keys = Object.keys(overrides);
  const previous: Record<string, string | undefined> = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    const next = overrides[key];
    if (typeof next === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }

  const restore = () => {
    for (const key of keys) {
      const prev = previous[key];
      if (typeof prev === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  };

  try {
    const result = action();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

async function testCountdownMaths() {
  const now = 1_000_000;
  const end = now + 90_000;
  const total = 180_000;

  const state = computeCountdownState(now, end, total);
  assert.equal(state.remainingMs, 90_000);
  assert.equal(state.ratioRemaining, 0.5);
  assert.equal(state.ratioElapsed, 0.5);

  const circumference = 100;
  assert.equal(computeRingDashOffset(circumference, state.ratioRemaining), 50);
  assert.equal(formatDurationLabel(0), "Due");
  assert.equal(formatDurationLabel(3_600_000 + 14 * 60_000), "1h 14m");
}

function testRouteParsing() {
  assert.deepEqual(parseRoute("/schedule"), { name: "schedule" });
  assert.deepEqual(parseRoute("/case/OC-26-0217-A11"), { name: "case", id: "OC-26-0217-A11" });
  assert.deepEqual(parseRoute("/decision/OC-26-0214-R91"), {
    name: "decision",
    id: "OC-26-0214-R91"
  });
  assert.deepEqual(parseRoute("/agent/agent_abc"), { name: "agent", id: "agent_abc" });
  assert.deepEqual(parseRoute("/unknown"), { name: "schedule" });
  assert.equal(routeToPath({ name: "about" }), "/about");
  assert.equal(routeToPath({ name: "case", id: "OC-26-0217-A11" }), "/case/OC-26-0217-A11");
  assert.equal(routeToPath({ name: "agent", id: "agent_abc" }), "/agent/agent_abc");
}

async function testCanonicalHashing() {
  const a = { z: 1, a: [3, { c: true, b: "x" }] };
  const b = { a: [3, { b: "x", c: true }], z: 1 };

  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(await canonicalHashHex(a), await canonicalHashHex(b));

  assert.throws(() => canonicalJson({ bad: Number.POSITIVE_INFINITY }), /non-finite/i);
}

async function testEvidenceAttachmentHashing() {
  const base = {
    kind: "link",
    bodyText: "Attachment hash test body",
    references: ["E-001"],
    attachmentUrls: ["https://cdn.example.org/proof.png"],
    evidenceTypes: ["url"],
    evidenceStrength: "medium"
  };
  const a = await canonicalHashHex(base);
  const b = await canonicalHashHex({
    ...base,
    attachmentUrls: ["https://cdn.example.org/proof-2.png"]
  });
  assert.notEqual(a, b);
}

function testTranscriptVoteMapping() {
  assert.equal(PROSECUTION_VOTE_PROMPT, "Do you side with the prosecution on this case?");
  assert.equal(
    mapVoteToAnswer({
      voteLabel: "for_prosecution",
      votes: []
    }),
    "yay"
  );
  assert.equal(
    mapVoteToAnswer({
      voteLabel: "for_defence",
      votes: []
    }),
    "nay"
  );
  assert.equal(
    mapVoteToAnswer({
      votes: [
        {
          claimId: "c1",
          finding: "proven",
          severity: 1,
          recommendedRemedy: "warn",
          rationale: "ok",
          citations: []
        }
      ]
    }),
    "yay"
  );
  assert.equal(
    mapVoteToAnswer({
      votes: [
        {
          claimId: "c1",
          finding: "insufficient",
          severity: 1,
          recommendedRemedy: "warn",
          rationale: "ok",
          citations: []
        }
      ]
    }),
    "nay"
  );
}

async function testSealHashFixtures() {
  const transcriptProjection = [
    {
      seqNo: 1,
      actorRole: "court",
      eventType: "stage_start",
      stage: "evidence",
      messageText: "Evidence stage opened.",
      payload: { deadline: "2026-02-18T10:00:00.000Z" },
      createdAtIso: "2026-02-18T09:30:00.000Z"
    },
    {
      seqNo: 2,
      actorRole: "juror",
      actorAgentId: "agent_test",
      eventType: "juror_ready",
      stage: "jury_readiness",
      messageText: "Juror confirmed readiness.",
      artefactType: "jury_member",
      artefactId: "agent_test",
      payload: { ready: true },
      createdAtIso: "2026-02-18T09:31:00.000Z"
    }
  ];
  const jurySelectionProof = {
    drand: { round: 12345, randomness: "abc123" },
    selected: ["a", "b", "c"],
    scores: [
      { agentId: "a", score: "01" },
      { agentId: "b", score: "02" }
    ]
  };

  assert.equal(
    await hashTranscriptProjection(transcriptProjection),
    "cbf061f56567462ef79e2727143254a9499904a9cde37e874bad5373e6ef536c"
  );
  assert.equal(
    await hashJurySelectionProof(jurySelectionProof),
    "50c96eae4a1e345a493f55630e07f0d6377e11b69612961996b7a54be5c77b3a"
  );
}

async function testSwarmValidationHelpers() {
  assert.deepEqual(normalisePrincipleIds([1, "P2", "3", "P2"], { field: "principles" }), [1, 2, 3]);
  assert.throws(
    () => normalisePrincipleIds(["P0"], { field: "principles" }),
    /range 1 to 12/
  );
  assert.throws(
    () => normalisePrincipleIds([], { required: true, min: 1, field: "principlesReliedOn" }),
    /at least 1/
  );

  assert.equal(
    validateReasoningSummary("This is sentence one. This is sentence two."),
    "This is sentence one. This is sentence two."
  );
  assert.throws(
    () => validateReasoningSummary("Only one sentence"),
    /two or three sentences/
  );

  assert.equal(validateCaseTopic("misinformation"), "misinformation");
  assert.equal(validateStakeLevel("high"), "high");
  assert.throws(() => validateCaseTopic("random"), /caseTopic must be one of/);
  assert.throws(() => validateStakeLevel("critical"), /stakeLevel must be one of/);

  assert.deepEqual(
    validateEvidenceAttachmentUrls([
      "https://example.org/a.png",
      "https://media.example.org/path/b.mp4"
    ]),
    ["https://example.org/a.png", "https://media.example.org/path/b.mp4"]
  );
  assert.throws(
    () => validateEvidenceAttachmentUrls(["http://example.org/a.png"]),
    /https/i
  );
  assert.throws(
    () => validateEvidenceAttachmentUrls(["https://localhost/file.png"]),
    /private network hosts/
  );
  assert.throws(
    () =>
      validateEvidenceAttachmentUrls(
        Array.from({ length: 9 }, (_, index) => `https://example.org/${index}.png`)
      ),
    /At most 8/
  );

  const resolver = async (_hostname: string) => [
    { address: "198.51.100.24", family: 4 }
  ];
  assert.equal(
    await validateNotifyUrl("https://agents.example.org/opencawt/invite", "notifyUrl", resolver),
    "https://agents.example.org/opencawt/invite"
  );
  await assert.rejects(
    () => validateNotifyUrl("http://agents.example.org/callback", "notifyUrl", resolver),
    /https/i
  );
  await assert.rejects(
    () => validateNotifyUrl("https://127.0.0.1/callback", "notifyUrl", resolver),
    /private network hosts/i
  );
  await assert.rejects(
    () =>
      validateNotifyUrl("https://agents.example.org/callback", "notifyUrl", async () => [
        { address: "10.1.2.3", family: 4 }
      ]),
    /resolves to localhost or a private network host/i
  );
  await assert.rejects(
    () =>
      validateNotifyUrl(
        "https://agents.example.org/callback",
        "notifyUrl",
        async () => {
          throw new Error("dns failed");
        }
      ),
    /hostname could not be resolved/i
  );
  await assert.rejects(
    () => validateNotifyUrl("https://agents.example.org:9443/callback", "notifyUrl", resolver),
    /port 443/i
  );
}

function testMigrationBackfillDefaults() {
  const dbPath = "/tmp/opencawt_phase42_migration_backfill.sqlite";
  rmSync(dbPath, { force: true });
  const raw = new Database(dbPath);
  raw.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE cases (
      case_id TEXT PRIMARY KEY,
      public_slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      session_stage TEXT NOT NULL DEFAULT 'pre_session',
      prosecution_agent_id TEXT NOT NULL,
      defendant_agent_id TEXT,
      defence_agent_id TEXT,
      defence_state TEXT NOT NULL DEFAULT 'none',
      defence_assigned_at TEXT,
      defence_window_deadline TEXT,
      open_defence INTEGER NOT NULL,
      summary TEXT NOT NULL,
      requested_remedy TEXT NOT NULL,
      created_at TEXT NOT NULL,
      filed_at TEXT,
      jury_selected_at TEXT,
      session_started_at TEXT,
      closed_at TEXT,
      sealed_at TEXT,
      void_reason TEXT,
      voided_at TEXT,
      scheduled_for TEXT,
      countdown_end_at TEXT,
      countdown_total_ms INTEGER,
      treasury_tx_sig TEXT UNIQUE,
      filing_warning TEXT,
      drand_round INTEGER,
      drand_randomness TEXT,
      pool_snapshot_hash TEXT,
      selection_proof_json TEXT,
      verdict_hash TEXT,
      verdict_bundle_json TEXT,
      seal_asset_id TEXT,
      seal_tx_sig TEXT,
      seal_uri TEXT,
      last_event_seq_no INTEGER NOT NULL DEFAULT 0,
      sealed_disabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE claims (
      claim_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      claim_index INTEGER NOT NULL,
      summary TEXT NOT NULL,
      requested_remedy TEXT NOT NULL,
      alleged_principles_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE submissions (
      submission_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      side TEXT NOT NULL,
      phase TEXT NOT NULL,
      text_body TEXT NOT NULL,
      principle_citations_json TEXT NOT NULL,
      evidence_citations_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE ballots (
      ballot_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      juror_id TEXT NOT NULL,
      ballot_json TEXT NOT NULL,
      ballot_hash TEXT NOT NULL,
      reasoning_summary TEXT NOT NULL DEFAULT '',
      signature TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE evidence_items (
      evidence_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      kind TEXT NOT NULL,
      body_text TEXT NOT NULL,
      references_json TEXT NOT NULL,
      body_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  `);
  const now = new Date().toISOString();
  raw.prepare(
    `INSERT INTO cases (
      case_id, public_slug, status, prosecution_agent_id, open_defence, summary, requested_remedy,
      created_at, closed_at, verdict_bundle_json, void_reason
    ) VALUES (?, ?, 'closed', ?, 1, ?, 'warn', ?, ?, ?, NULL)`
  ).run(
    "OC-MIG-001",
    "oc-mig-001",
    "agent_migration",
    "Migration backfill case",
    now,
    now,
    JSON.stringify({ overall: { outcome: "for_prosecution" } })
  );
  raw.close();

  const config = getConfig();
  config.dbPath = dbPath;
  const migrated = openDatabase(config);
  const row = migrated
    .prepare(
      `SELECT case_topic, stake_level, outcome, decided_at, replacement_count_ready, replacement_count_vote FROM cases WHERE case_id = ?`
    )
    .get("OC-MIG-001") as Record<string, unknown>;
  assert.equal(row.case_topic, "other");
  assert.equal(row.stake_level, "medium");
  assert.equal(row.outcome, "for_prosecution");
  assert.ok(typeof row.decided_at === "string");
  assert.equal(Number(row.replacement_count_ready), 0);
  assert.equal(Number(row.replacement_count_vote), 0);
  migrated.close();
}

async function testSignatureVerification() {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const agentId = encodeBase58(publicBytes);

  const payload = { hello: "world" };
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/cases/draft";

  const signed = await signPayload({
    method: "POST",
    path,
    timestamp,
    payload,
    privateKey: keyPair.privateKey
  });

  const valid = await verifySignedPayload({
    agentId,
    method: "POST",
    path,
    timestamp,
    payloadHash: signed.payloadHash,
    signature: signed.signature
  });
  assert.equal(valid, true);

  const invalid = await verifySignedPayload({
    agentId,
    method: "POST",
    path,
    timestamp,
    payloadHash: signed.payloadHash.replace(/./, "0"),
    signature: signed.signature
  });
  assert.equal(invalid, false);
}

async function testCapabilityTokenEnforcement() {
  const dbPath = "/tmp/opencawt_phase42_capabilities.sqlite";
  rmSync(dbPath, { force: true });
  const config = getConfig();
  config.dbPath = dbPath;
  const db = openDatabase(config);
  resetDatabase(db);

  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const agentId = encodeBase58(publicBytes);
  upsertAgent(db, agentId, true);

  const payload = { agentId, jurorEligible: true };
  const path = "/api/agents/register";
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = await signPayload({
    method: "POST",
    path,
    timestamp,
    payload,
    privateKey: keyPair.privateKey
  });

  const requestBase = {
    headers: {
      "x-agent-id": agentId,
      "x-timestamp": String(timestamp),
      "x-payload-hash": signed.payloadHash,
      "x-signature": signed.signature
    }
  } as unknown as import("node:http").IncomingMessage;

  const configNoCapability = { ...config, capabilityKeysEnabled: false };
  await verifySignedMutation({
    db,
    config: configNoCapability,
    req: requestBase,
    body: payload,
    path,
    method: "POST"
  });

  const configWithCapability = { ...config, capabilityKeysEnabled: true };
  await assert.rejects(
    () =>
      verifySignedMutation({
        db,
        config: configWithCapability,
        req: requestBase,
        body: payload,
        path,
        method: "POST"
      }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "CAPABILITY_REQUIRED"
  );

  const capabilityToken = "ocap_test_token";
  createAgentCapability(db, {
    tokenHash: hashCapabilityToken(capabilityToken),
    agentId,
    scope: "writes",
    expiresAtIso: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });

  const requestWithCapability = {
    headers: {
      ...requestBase.headers,
      "x-agent-capability": capabilityToken
    }
  } as unknown as import("node:http").IncomingMessage;

  await verifySignedMutation({
    db,
    config: configWithCapability,
    req: requestWithCapability,
    body: payload,
    path,
    method: "POST"
  });

  assert.ok(
    revokeAgentCapabilityByHash(db, {
      agentId,
      tokenHash: hashCapabilityToken(capabilityToken)
    })
  );

  await assert.rejects(
    () =>
      verifySignedMutation({
        db,
        config: configWithCapability,
        req: requestWithCapability,
        body: payload,
        path,
        method: "POST"
      }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "CAPABILITY_REVOKED"
  );

  db.close();
}

async function testDrandSelectionDeterminism() {
  const input = {
    caseId: "OC-26-0217-A11",
    eligibleJurorIds: Array.from(
      { length: 20 },
      (_, i) => `agent_${String(i + 1).padStart(2, "0")}`
    ),
    drand: {
      round: 123,
      randomness: "abc123randomness",
      chainInfo: {
        periodSeconds: 30,
        genesisTime: 0,
        hash: "h1"
      }
    },
    jurySize: 11
  };

  const first = await selectJuryDeterministically(input);
  const second = await selectJuryDeterministically(input);

  assert.deepEqual(first.selectedJurors, second.selectedJurors);
  assert.equal(first.poolSnapshotHash, second.poolSnapshotHash);
  assert.equal(first.proof.seed, second.proof.seed);
}

async function testVerdictDeterminism() {
  const provenVote: VoteEntry = {
    claimId: "OC-TEST-01-c1",
    finding: "proven",
    severity: 2,
    recommendedRemedy: "warn",
    rationale: "r",
    citations: []
  };
  const notProvenVote: VoteEntry = {
    claimId: "OC-TEST-01-c1",
    finding: "not_proven",
    severity: 2,
    recommendedRemedy: "none",
    rationale: "r",
    citations: []
  };

  const commonInput = {
    caseId: "OC-TEST-01",
    prosecutionAgentId: "agent_p",
    defenceAgentId: "agent_d",
    closedAtIso: new Date().toISOString(),
    jurySize: 11,
    claims: [{ claimId: "OC-TEST-01-c1", requestedRemedy: "warn" as const }],
    ballots: [
      { votes: [provenVote], ballotHash: "h1" },
      { votes: [provenVote], ballotHash: "h2" },
      { votes: [notProvenVote], ballotHash: "h3" }
    ],
    evidenceHashes: ["e1", "e2"],
    submissionHashes: ["s1", "s2"],
    drandRound: 100,
    drandRandomness: "rand",
    poolSnapshotHash: "pool"
  };

  const first = await computeDeterministicVerdict(commonInput);
  const second = await computeDeterministicVerdict(commonInput);

  assert.equal(first.verdictHash, second.verdictHash);
  assert.equal(first.bundle.overall.outcome, "for_prosecution");
  assert.equal(first.inconclusive, false);
}

async function testVerdictInconclusiveMapsToVoid() {
  const outcomeA: VoteEntry = {
    claimId: "OC-TEST-02-c1",
    finding: "proven",
    severity: 2,
    recommendedRemedy: "warn",
    rationale: "r",
    citations: []
  };
  const outcomeB: VoteEntry = {
    claimId: "OC-TEST-02-c1",
    finding: "not_proven",
    severity: 2,
    recommendedRemedy: "none",
    rationale: "r",
    citations: []
  };

  const result = await computeDeterministicVerdict({
    caseId: "OC-TEST-02",
    prosecutionAgentId: "agent_p",
    defenceAgentId: "agent_d",
    closedAtIso: new Date().toISOString(),
    jurySize: 11,
    claims: [{ claimId: "OC-TEST-02-c1", requestedRemedy: "warn" }],
    ballots: [
      { votes: [outcomeA], ballotHash: "h1" },
      { votes: [outcomeB], ballotHash: "h2" }
    ],
    evidenceHashes: [],
    submissionHashes: [],
    drandRound: 1,
    drandRandomness: "rand",
    poolSnapshotHash: "pool"
  });

  assert.equal(result.inconclusive, true);
  assert.equal(result.overallOutcome, null);
  assert.equal(result.bundle.overall.outcome, undefined);
}

function testPaymentEstimatorMaths() {
  assert.equal(clampComputeUnitLimit(100_000, 50_000, 10), 110_000);
  assert.equal(clampComputeUnitLimit(10_000, 50_000, 10), 50_000);
  assert.equal(clampComputeUnitLimit(2_000_000, 50_000, 10), 1_400_000);
  assert.equal(priorityFeeLamports(400_000, 2_500), 1000);
  assert.equal(priorityFeeLamports(50_000, 1_001), 51);
}

async function testPaymentEstimatorStubShape() {
  await withEnv(
    {
      APP_ENV: "development",
      SOLANA_MODE: "stub",
      TREASURY_ADDRESS: "OpenCawtTreasury111111111111111111111111111",
      FILING_FEE_LAMPORTS: "5000000",
      PAYMENT_ESTIMATE_CU_MARGIN_PCT: "10",
      PAYMENT_ESTIMATE_MIN_CU_LIMIT: "50000",
      PAYMENT_ESTIMATE_CACHE_SEC: "20"
    },
    async () => {
      const config = getConfig();
      const estimator = createPaymentEstimator(config);
      const estimate = await estimator.estimateFilingFee();
      assert.ok(estimate.recommendedAtIso);
      assert.ok(estimate.breakdown.filingFeeLamports > 0);
      assert.ok(estimate.breakdown.computeUnitLimit >= config.paymentEstimateMinCuLimit);
      assert.ok(estimate.breakdown.computeUnitPriceMicroLamports > 0);
      assert.equal(estimate.recommendation.treasuryAddress, config.treasuryAddress);
      assert.equal(estimate.recommendation.rpcUrl, config.heliusRpcUrl);
    }
  );
}

function testPayerWalletValidation() {
  assert.equal(
    isValidSolanaPubkey("6q6n9y8aYV2B7QhKf8qQYxLoY6dX2eS3p4uZbN2kL8Xa"),
    true
  );
  assert.equal(isValidSolanaPubkey("invalid-wallet"), false);
}

function testConfigFailFastGuards() {
  assert.throws(
    () =>
      withEnv(
        {
          APP_ENV: "production",
          CORS_ORIGIN: "https://app.example.com",
          SYSTEM_API_KEY: "dev-system-key",
          WORKER_TOKEN: "worker-prod-token",
          ADMIN_PANEL_PASSWORD: "admin-panel-secret-strong",
          DEFENCE_INVITE_SIGNING_KEY: "defence-invite-signing-key-prod-strong-1234",
          SOLANA_MODE: "rpc",
          DRAND_MODE: "http",
          SEAL_WORKER_MODE: "http",
          HELIUS_WEBHOOK_ENABLED: "false",
          HELIUS_WEBHOOK_TOKEN: undefined
        },
        () => getConfig()
      ),
    /SYSTEM_API_KEY/
  );

  assert.throws(
    () =>
      withEnv(
        {
          APP_ENV: "production",
          CORS_ORIGIN: "https://app.example.com",
          SYSTEM_API_KEY: "system-prod-token",
          WORKER_TOKEN: "worker-prod-token",
          ADMIN_PANEL_PASSWORD: "admin-panel-secret-strong",
          DEFENCE_INVITE_SIGNING_KEY: "defence-invite-signing-key-prod-strong-1234",
          SOLANA_MODE: "stub",
          DRAND_MODE: "http",
          SEAL_WORKER_MODE: "http",
          HELIUS_WEBHOOK_ENABLED: "false",
          HELIUS_WEBHOOK_TOKEN: undefined
        },
        () => getConfig()
      ),
    /SOLANA_MODE=stub/
  );

  assert.throws(
    () =>
      withEnv(
        {
          APP_ENV: "staging",
          CORS_ORIGIN: "*",
          SYSTEM_API_KEY: "system-stage-token",
          WORKER_TOKEN: "worker-stage-token",
          ADMIN_PANEL_PASSWORD: "admin-panel-secret-strong",
          DEFENCE_INVITE_SIGNING_KEY: "defence-invite-signing-key-stage-strong-5678",
          HELIUS_WEBHOOK_ENABLED: "false",
          HELIUS_WEBHOOK_TOKEN: undefined
        },
        () => getConfig()
      ),
    /CORS_ORIGIN/
  );

  assert.throws(
    () =>
      withEnv(
        {
          APP_ENV: "staging",
          CORS_ORIGIN: "https://staging.example.com",
          SYSTEM_API_KEY: "system-stage-token",
          WORKER_TOKEN: "worker-stage-token",
          ADMIN_PANEL_PASSWORD: "admin-panel-secret-strong",
          DEFENCE_INVITE_SIGNING_KEY: "defence-invite-signing-key-stage-strong-5678",
          HELIUS_WEBHOOK_ENABLED: "true",
          HELIUS_WEBHOOK_TOKEN: undefined
        },
        () => getConfig()
      ),
    /HELIUS_WEBHOOK_ENABLED/
  );

  assert.throws(
    () =>
      withEnv(
        {
          APP_ENV: "production",
          CORS_ORIGIN: "https://app.example.com",
          SYSTEM_API_KEY: "system-prod-token",
          WORKER_TOKEN: "worker-prod-token",
          ADMIN_PANEL_PASSWORD: "gringos",
          DEFENCE_INVITE_SIGNING_KEY: "defence-invite-signing-key-prod-strong-1234",
          SOLANA_MODE: "rpc",
          DRAND_MODE: "http",
          SEAL_WORKER_MODE: "http",
          HELIUS_WEBHOOK_ENABLED: "false",
          HELIUS_WEBHOOK_TOKEN: undefined
        },
        () => getConfig()
      ),
    /ADMIN_PANEL_PASSWORD/
  );

  assert.throws(
    () =>
      withEnv(
        {
          APP_ENV: "production",
          CORS_ORIGIN: "https://app.example.com",
          SYSTEM_API_KEY: "system-prod-token",
          WORKER_TOKEN: "worker-prod-token",
          ADMIN_PANEL_PASSWORD: "admin-panel-secret-strong",
          DEFENCE_INVITE_SIGNING_KEY: "dev-defence-invite-signing-key",
          SOLANA_MODE: "rpc",
          DRAND_MODE: "http",
          SEAL_WORKER_MODE: "http",
          HELIUS_WEBHOOK_ENABLED: "false",
          HELIUS_WEBHOOK_TOKEN: undefined
        },
        () => getConfig()
      ),
    /DEFENCE_INVITE_SIGNING_KEY/
  );

  const cfg = withEnv(
    {
      APP_ENV: "production",
      CORS_ORIGIN: "https://app.example.com",
      SYSTEM_API_KEY: "system-prod-token",
      WORKER_TOKEN: "worker-prod-token",
      ADMIN_PANEL_PASSWORD: "admin-panel-secret-strong",
      ADMIN_SESSION_TTL_SEC: "1200",
      DEFENCE_INVITE_SIGNING_KEY: "defence-invite-signing-key-prod-strong-1234",
      SOLANA_MODE: "rpc",
      DRAND_MODE: "http",
      SEAL_WORKER_MODE: "http",
      DB_PATH: "/data/opencawt.sqlite",
      HELIUS_WEBHOOK_ENABLED: "false",
      HELIUS_WEBHOOK_TOKEN: undefined
    },
    () => getConfig()
  );
  if (cfg instanceof Promise) {
    throw new Error("Expected synchronous config load.");
  }
  assert.equal(cfg.adminSessionTtlSec, 1200);
}

function testSecurityHeadersPresence() {
  const devHeaders = new Map<string, string>();
  setSecurityHeaders(
    {
      setHeader: (name: string, value: string) => {
        devHeaders.set(name, value);
      }
    } as any,
    false
  );

  assert.ok(devHeaders.get("Content-Security-Policy"));
  assert.equal(devHeaders.get("X-Content-Type-Options"), "nosniff");
  assert.equal(devHeaders.get("X-Frame-Options"), "DENY");
  assert.equal(devHeaders.get("Referrer-Policy"), "no-referrer");

  const prodHeaders = new Map<string, string>();
  setSecurityHeaders(
    {
      setHeader: (name: string, value: string) => {
        prodHeaders.set(name, value);
      }
    } as any,
    true
  );
  assert.ok(prodHeaders.get("Strict-Transport-Security"));
}

async function testRpcPayerMismatchGuard() {
  await withEnv(
    {
      APP_ENV: "development",
      SOLANA_MODE: "rpc",
      HELIUS_RPC_URL: "https://example.invalid/rpc",
      HELIUS_DAS_URL: "https://example.invalid/das",
      TREASURY_ADDRESS: "5HcofW4v2knQh4Lh6dgyy4R8L4gS2T1o9d7PRN6vk4RP",
      FILING_FEE_LAMPORTS: "1000",
      EXTERNAL_RETRY_ATTEMPTS: "1",
      EXTERNAL_TIMEOUT_MS: "1000"
    },
    async () => {
      const config = getConfig();
      const provider = createSolanaProvider(config);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              meta: {
                err: null,
                preBalances: [2000, 0],
                postBalances: [900, 1100]
              },
              transaction: {
                message: {
                  accountKeys: [
                    {
                      pubkey: "6q6n9y8aYV2B7QhKf8qQYxLoY6dX2eS3p4uZbN2kL8Xa",
                      signer: true
                    },
                    { pubkey: config.treasuryAddress }
                  ]
                }
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      try {
        let mismatchRejected = false;
        try {
          await provider.verifyFilingFeeTx(
            "4f4cvvW5k6vB37XQ5fWnq7v7Jb2LGaBPLS2E9qfcQPy4",
            "9PhQqnLe49xFghhq2e2hQr9m5m9mVhm9E5L7zDPjXgRo"
          );
        } catch (error) {
          mismatchRejected = true;
          const code =
            typeof error === "object" && error && "code" in error
              ? String((error as { code?: string }).code)
              : "";
          const message = error instanceof Error ? error.message : String(error);
          assert.ok(
            code === "PAYER_WALLET_MISMATCH" || message.includes("payer wallet"),
            `Unexpected payer mismatch error: ${message}`
          );
        }
        assert.equal(mismatchRejected, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
}

function testTreasuryReplayPrevention() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase4_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-1", true);
  const seededCase = createCaseDraft(db, {
    prosecutionAgentId: "agent-1",
    openDefence: true,
    claimSummary: "Replay test claim summary.",
    requestedRemedy: "warn"
  });

  assert.equal(isTreasuryTxUsed(db, "tx-replay-1"), false);
  saveUsedTreasuryTx(db, {
    txSig: "tx-replay-1",
    caseId: seededCase.caseId,
    agentId: "agent-1",
    amountLamports: 5000
  });
  assert.equal(isTreasuryTxUsed(db, "tx-replay-1"), true);
  db.close();
}

function testCaseRuntimeInitialisation() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase4_runtime_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-2", true);
  const seededCase = createCaseDraft(db, {
    prosecutionAgentId: "agent-2",
    openDefence: true,
    claimSummary: "Runtime schedule test.",
    requestedRemedy: "warn"
  });

  setCaseFiled(db, {
    caseId: seededCase.caseId,
    txSig: "tx-runtime-1",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 2700
  });

  const runtime = getCaseRuntime(db, seededCase.caseId);
  assert.ok(runtime);
  assert.equal(runtime?.currentStage, "pre_session");
  assert.ok(runtime?.scheduledSessionStartAtIso);

  db.close();
}

function testNamedDefendantSchedulingAfterAcceptance() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase42_named_schedule_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-prosecution", true);
  upsertAgent(db, "agent-defendant", true);
  const draft = createCaseDraft(db, {
    prosecutionAgentId: "agent-prosecution",
    defendantAgentId: "agent-defendant",
    defendantNotifyUrl: "https://agent-defendant.example.org/opencawt/invite",
    openDefence: false,
    claimSummary: "Named defendant scheduling test.",
    requestedRemedy: "warn"
  });

  setCaseFiled(db, {
    caseId: draft.caseId,
    txSig: "tx-named-schedule",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 86400,
    scheduleImmediately: false,
    inviteStatus: "queued"
  });

  const filed = getCaseById(db, draft.caseId);
  assert.equal(filed?.scheduledForIso, undefined);
  assert.equal(filed?.defenceInviteStatus, "queued");
  assert.ok(filed?.defenceWindowDeadlineIso);

  const accepted = claimDefenceAssignment(db, {
    caseId: draft.caseId,
    agentId: "agent-defendant",
    nowIso: new Date().toISOString(),
    namedExclusiveSec: 900,
    scheduleDelaySec: 3600
  });
  assert.equal(accepted.status, "assigned_accepted");
  const updated = getCaseById(db, draft.caseId);
  assert.ok(updated?.scheduledForIso);

  db.close();
}

function testTranscriptSequence() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase4_transcript_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-3", true);
  const seededCase = createCaseDraft(db, {
    prosecutionAgentId: "agent-3",
    openDefence: true,
    claimSummary: "Transcript sequence test.",
    requestedRemedy: "warn"
  });

  const a = appendTranscriptEvent(db, {
    caseId: seededCase.caseId,
    actorRole: "court",
    eventType: "notice",
    messageText: "First"
  });
  const b = appendTranscriptEvent(db, {
    caseId: seededCase.caseId,
    actorRole: "court",
    eventType: "notice",
    messageText: "Second"
  });

  assert.equal(a.seqNo, 1);
  assert.equal(b.seqNo, 2);
  db.close();
}

function testIdempotencyRecordStorage() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase4_idempotency_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  saveIdempotencyRecord(db, {
    agentId: "agent-test",
    method: "POST",
    path: "/api/cases/draft",
    idempotencyKey: "idem-1",
    requestHash: "hash-1",
    responseStatus: 201,
    responseJson: { ok: true },
    ttlSec: 600
  });

  const record = getIdempotencyRecord(db, {
    agentId: "agent-test",
    method: "POST",
    path: "/api/cases/draft",
    idempotencyKey: "idem-1"
  });

  assert.ok(record);
  assert.equal(record?.requestHash, "hash-1");
  assert.equal(record?.responseStatus, 201);

  saveIdempotencyRecord(db, {
    agentId: "agent-test",
    method: "POST",
    path: "/api/cases/draft",
    idempotencyKey: "idem-2",
    requestHash: "hash-2",
    responseStatus: 200,
    responseJson: {
      ok: true,
      optional: undefined,
      nested: {
        keep: "x",
        drop: undefined
      }
    },
    ttlSec: 600
  });
  const record2 = getIdempotencyRecord(db, {
    agentId: "agent-test",
    method: "POST",
    path: "/api/cases/draft",
    idempotencyKey: "idem-2"
  });
  assert.ok(record2);
  assert.deepEqual(record2?.responseJson, { ok: true, nested: { keep: "x" } });

  db.close();
}

function testDefenceClaimRace() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase41_race_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-prosecution", true);
  upsertAgent(db, "agent-def-1", true);
  upsertAgent(db, "agent-def-2", true);
  const draft = createCaseDraft(db, {
    prosecutionAgentId: "agent-prosecution",
    openDefence: true,
    claimSummary: "Race claim.",
    requestedRemedy: "warn"
  });

  setCaseFiled(db, {
    caseId: draft.caseId,
    txSig: "tx-race-1",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 2700
  });

  const now = new Date().toISOString();
  const first = claimDefenceAssignment(db, {
    caseId: draft.caseId,
    agentId: "agent-def-1",
    nowIso: now,
    namedExclusiveSec: 900,
    scheduleDelaySec: 3600
  });
  const second = claimDefenceAssignment(db, {
    caseId: draft.caseId,
    agentId: "agent-def-2",
    nowIso: now,
    namedExclusiveSec: 900,
    scheduleDelaySec: 3600
  });

  assert.equal(first.status, "assigned_volunteered");
  assert.equal(second.status, "already_taken");
  assert.equal(getCaseById(db, draft.caseId)?.defenceAgentId, "agent-def-1");
  db.close();
}

function testNamedDefendantExclusivity() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase41_exclusive_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-prosecution", true);
  upsertAgent(db, "agent-named", true);
  upsertAgent(db, "agent-other", true);

  const draftA = createCaseDraft(db, {
    prosecutionAgentId: "agent-prosecution",
    defendantAgentId: "agent-named",
    openDefence: false,
    claimSummary: "Named window claim A.",
    requestedRemedy: "warn"
  });
  setCaseFiled(db, {
    caseId: draftA.caseId,
    txSig: "tx-exclusive-a",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 2700
  });
  const filedA = getCaseById(db, draftA.caseId);
  assert.ok(filedA?.filedAtIso);
  const inWindow = new Date(new Date(filedA!.filedAtIso!).getTime() + 5 * 60 * 1000).toISOString();
  const reserved = claimDefenceAssignment(db, {
    caseId: draftA.caseId,
    agentId: "agent-other",
    nowIso: inWindow,
    namedExclusiveSec: 900,
    scheduleDelaySec: 3600
  });
  assert.equal(reserved.status, "reserved_for_named_defendant");
  const accepted = claimDefenceAssignment(db, {
    caseId: draftA.caseId,
    agentId: "agent-named",
    nowIso: inWindow,
    namedExclusiveSec: 900,
    scheduleDelaySec: 3600
  });
  assert.equal(accepted.status, "assigned_accepted");

  const draftB = createCaseDraft(db, {
    prosecutionAgentId: "agent-prosecution",
    defendantAgentId: "agent-named",
    openDefence: false,
    claimSummary: "Named window claim B.",
    requestedRemedy: "warn"
  });
  setCaseFiled(db, {
    caseId: draftB.caseId,
    txSig: "tx-exclusive-b",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 2700
  });
  const filedB = getCaseById(db, draftB.caseId);
  assert.ok(filedB?.filedAtIso);
  const afterWindow = new Date(new Date(filedB!.filedAtIso!).getTime() + 16 * 60 * 1000).toISOString();
  const volunteer = claimDefenceAssignment(db, {
    caseId: draftB.caseId,
    agentId: "agent-other",
    nowIso: afterWindow,
    namedExclusiveSec: 900,
    scheduleDelaySec: 3600
  });
  assert.equal(volunteer.status, "assigned_volunteered");

  db.close();
}

async function testDefenceCutoffVoiding() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase41_cutoff_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-prosecution", true);
  const draft = createCaseDraft(db, {
    prosecutionAgentId: "agent-prosecution",
    openDefence: true,
    claimSummary: "Cutoff void claim.",
    requestedRemedy: "warn"
  });
  setCaseFiled(db, {
    caseId: draft.caseId,
    txSig: "tx-cutoff",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 2700
  });

  db.prepare(`UPDATE cases SET defence_window_deadline = ? WHERE case_id = ?`).run(
    new Date(Date.now() - 60 * 1000).toISOString(),
    draft.caseId
  );

  const engine = createSessionEngine({
    db,
    config,
    drand: {
      async getRoundAtOrAfter() {
        return {
          round: 1,
          randomness: "stub",
          chainInfo: {}
        };
      }
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined
    } as any,
    judge: {
      async screenCase(input: { summary: string }) {
        return { approved: true, caseTitle: input.summary.slice(0, 37) + "..." };
      },
      async breakTiebreak(_input: unknown) {
        return { finding: "not_proven" as const, reasoning: "stub" };
      },
      async recommendRemedy(_input: unknown) {
        return "";
      },
      isAvailable() {
        return true;
      }
    },
    async onCaseReadyToClose() {
      return;
    }
  });

  await engine.tickNow();
  const updated = getCaseById(db, draft.caseId);
  assert.equal(updated?.status, "void");
  assert.equal(updated?.voidReason, "missing_defence_assignment");
  db.close();
}

function testVictoryScoreAndLeaderboard() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase41_leaderboard_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  const agents = ["agent-a", "agent-b", "agent-c"];
  for (const agent of agents) {
    upsertAgent(db, agent, true);
  }

  const caseIds: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const draft = createCaseDraft(db, {
      prosecutionAgentId: "agent-a",
      defendantAgentId: "agent-b",
      openDefence: false,
      claimSummary: `Stats case ${i}.`,
      requestedRemedy: "warn"
    });
    caseIds.push(draft.caseId);
  }

  clearAgentCaseActivity(db, caseIds[0]);
  for (let i = 0; i < caseIds.length; i += 1) {
    const outcome = i < 4 ? "for_prosecution" : "for_defence";
    logAgentCaseActivity(db, {
      agentId: "agent-a",
      caseId: caseIds[i],
      role: "prosecution",
      outcome
    });
    logAgentCaseActivity(db, {
      agentId: "agent-b",
      caseId: caseIds[i],
      role: "defence",
      outcome
    });
    logAgentCaseActivity(db, {
      agentId: "agent-c",
      caseId: caseIds[i],
      role: "juror",
      outcome
    });
  }

  rebuildAllAgentStats(db);
  const leaderboard = listLeaderboard(db, {
    limit: 20,
    minDecidedCases: 5
  });
  assert.ok(leaderboard.length >= 2);
  assert.equal(leaderboard[0].agentId, "agent-a");
  assert.equal(leaderboard[0].decidedCasesTotal, 6);
  assert.ok(leaderboard[0].victoryPercent > leaderboard[1].victoryPercent);

  const profile = getAgentProfile(db, "agent-a", { activityLimit: 10 });
  assert.ok(profile !== null, "profile should exist for agent-a");
  assert.equal(profile!.stats.prosecutionsTotal, 6);
  assert.equal(profile!.stats.prosecutionsWins, 4);
  assert.equal(profile!.stats.defencesTotal, 0);
  assert.equal(profile!.recentActivity.length, 6);

  db.close();
}

function testOpenDefenceQuery() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase41_open_defence_test.sqlite";
  rmSync(config.dbPath, { force: true });
  const db = openDatabase(config);
  resetDatabase(db);

  upsertAgent(db, "agent-prosecution", true);
  upsertAgent(db, "agent-named", true);

  const openCase = createCaseDraft(db, {
    prosecutionAgentId: "agent-prosecution",
    openDefence: true,
    claimSummary: "Open defence case summary.",
    requestedRemedy: "warn",
    allegedPrinciples: ["P2", "P8"]
  });
  setCaseFiled(db, {
    caseId: openCase.caseId,
    txSig: "tx-open",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 2700
  });

  const reservedCase = createCaseDraft(db, {
    prosecutionAgentId: "agent-prosecution",
    defendantAgentId: "agent-named",
    openDefence: false,
    claimSummary: "Reserved case summary.",
    requestedRemedy: "warn",
    allegedPrinciples: ["P7"]
  });
  setCaseFiled(db, {
    caseId: reservedCase.caseId,
    txSig: "tx-reserved",
    scheduleDelaySec: 3600,
    defenceCutoffSec: 2700
  });

  const results = listOpenDefenceCases(
    db,
    { q: "summary", status: "all", tag: "P2", limit: 50 },
    { nowIso: new Date().toISOString(), namedExclusiveSec: 900 }
  );

  assert.ok(results.some((item) => item.caseId === openCase.caseId));
  assert.ok(results.every((item) => item.tags.includes("P2")));
  assert.ok(!results.some((item) => item.caseId === reservedCase.caseId));

  const broadResults = listOpenDefenceCases(
    db,
    { q: "summary", status: "all", limit: 50 },
    { nowIso: new Date().toISOString(), namedExclusiveSec: 900 }
  );
  const reserved = broadResults.find((item) => item.caseId === reservedCase.caseId);
  assert.ok(reserved);
  assert.equal(reserved?.claimStatus, "reserved");
  assert.equal(reserved?.claimable, false);

  db.close();
}

function testOpenClawToolContractParity() {
  const registry = loadOpenClawToolRegistry();
  assert.equal(registry.length, OPENCAWT_OPENCLAW_TOOLS.length, "Registry must include every tool.");

  for (const tool of registry) {
    assert.ok(tool.endpoint && tool.endpoint !== "/", `Tool ${tool.name} must have a valid endpoint.`);
    assert.ok(["GET", "POST"].includes(tool.method), `Tool ${tool.name} must have GET or POST method.`);
  }

  const toolByName = new Map(OPENCAWT_OPENCLAW_TOOLS.map((t) => [t.name, t]));
  const requiredByTool: Record<string, string[]> = {
    lodge_dispute_draft: ["prosecutionAgentId", "openDefence", "claimSummary", "requestedRemedy"],
    lodge_dispute_confirm_and_schedule: ["caseId", "treasuryTxSig"],
    attach_filing_payment: ["caseId", "treasuryTxSig"],
    volunteer_defence: ["caseId"],
    join_jury_pool: ["agentId", "availability"],
    list_assigned_cases: ["agentId"],
    submit_stage_message: ["caseId", "side", "stage", "text", "principleCitations", "evidenceCitations"],
    submit_evidence: ["caseId", "kind", "bodyText"],
    juror_ready_confirm: ["caseId"],
    submit_ballot_with_reasoning: ["caseId", "votes", "reasoningSummary", "principlesReliedOn"]
  };

  for (const [name, required] of Object.entries(requiredByTool)) {
    const tool = toolByName.get(name);
    assert.ok(tool, `Tool ${name} must exist.`);
    const schema = tool.inputSchema as { required?: string[] };
    assert.ok(Array.isArray(schema.required), `Tool ${name} must have required array.`);
    for (const field of required) {
      assert.ok(
        schema.required!.includes(field),
        `Tool ${name} must require field ${field}.`
      );
    }
  }
}

async function testDrandHttpIntegration() {
  const config = getConfig();
  if (config.drandMode !== "http") {
    return;
  }
  const client = createDrandClient(config);
  const result = await client.getRoundAtOrAfter(Date.now());
  assert.ok(typeof result.round === "number" && result.round >= 1);
  assert.ok(typeof result.randomness === "string" && result.randomness.length >= 32);
  assert.ok(result.chainInfo);
}

function testMlSignalValidation() {
  // null/undefined inputs return null
  assert.equal(validateMlSignals(null), null);
  assert.equal(validateMlSignals(undefined), null);
  assert.equal(validateMlSignals("bad"), null);

  // empty object returns empty MlSignals
  const empty = validateMlSignals({});
  assert.ok(empty !== null);
  assert.deepEqual(empty, {});

  // valid principleImportance (length 12, each 0-3)
  const valid12 = Array.from({ length: 12 }, (_, i) => i % 4);
  const r1 = validateMlSignals({ principleImportance: valid12 });
  assert.ok(r1 !== null);
  assert.deepEqual(r1!.principleImportance, valid12);

  // wrong length principleImportance throws
  assert.throws(
    () => validateMlSignals({ principleImportance: [1, 2, 3] }),
    (e: unknown) => e instanceof MlValidationError && e.field === "principleImportance"
  );

  // out-of-range value throws
  assert.throws(
    () => validateMlSignals({ principleImportance: Array.from({ length: 12 }, (_, i) => i === 0 ? 5 : 0) }),
    (e: unknown) => e instanceof MlValidationError
  );

  // valid decisivePrincipleIndex 0-11
  const r2 = validateMlSignals({ decisivePrincipleIndex: 11 });
  assert.equal(r2!.decisivePrincipleIndex, 11);

  // out of range throws
  assert.throws(
    () => validateMlSignals({ decisivePrincipleIndex: 12 }),
    (e: unknown) => e instanceof MlValidationError && e.field === "decisivePrincipleIndex"
  );

  // valid enum fields
  const r3 = validateMlSignals({ uncertaintyType: "CONFLICTING_EVIDENCE", primaryBasis: "INTENT" });
  assert.equal(r3!.uncertaintyType, "CONFLICTING_EVIDENCE");
  assert.equal(r3!.primaryBasis, "INTENT");

  // invalid enum throws
  assert.throws(
    () => validateMlSignals({ uncertaintyType: "NOT_A_REAL_TYPE" }),
    (e: unknown) => e instanceof MlValidationError && e.field === "uncertaintyType"
  );

  // valid harmDomains array
  const r4 = validateMlSignals({ harmDomains: ["SAFETY", "FINANCIAL"] });
  assert.deepEqual(r4!.harmDomains, ["SAFETY", "FINANCIAL"]);

  // invalid harmDomain member throws
  assert.throws(
    () => validateMlSignals({ harmDomains: ["SAFETY", "BOGUS"] }),
    (e: unknown) => e instanceof MlValidationError && e.field === "harmDomains"
  );

  // ordinal 0-3 fields
  const r5 = validateMlSignals({ mlConfidence: 3, severity: 0, evidenceQuality: 2 });
  assert.equal(r5!.mlConfidence, 3);
  assert.equal(r5!.severity, 0);
  assert.equal(r5!.evidenceQuality, 2);

  assert.throws(
    () => validateMlSignals({ severity: 4 }),
    (e: unknown) => e instanceof MlValidationError && e.field === "severity"
  );

  // valid processFlags
  const r6 = validateMlSignals({ processFlags: ["TIMEOUT", "SUSPECTED_COLLUSION"] });
  assert.deepEqual(r6!.processFlags, ["TIMEOUT", "SUSPECTED_COLLUSION"]);

  // invalid process flag throws
  assert.throws(
    () => validateMlSignals({ processFlags: ["TIMEOUT", "INVALID_FLAG"] }),
    (e: unknown) => e instanceof MlValidationError && e.field === "processFlags"
  );

  // valid recommendedRemedy and proportionality
  const r7 = validateMlSignals({ recommendedRemedy: "WARNING", proportionality: "PROPORTIONATE" });
  assert.equal(r7!.recommendedRemedy, "WARNING");
  assert.equal(r7!.proportionality, "PROPORTIONATE");

  // decisiveEvidenceId must be string
  const r8 = validateMlSignals({ decisiveEvidenceId: "P-1" });
  assert.equal(r8!.decisiveEvidenceId, "P-1");
}

async function run() {
  await testCountdownMaths();
  testRouteParsing();
  await testCanonicalHashing();
  await testEvidenceAttachmentHashing();
  testTranscriptVoteMapping();
  await testSealHashFixtures();
  await testSwarmValidationHelpers();
  testMigrationBackfillDefaults();
  await testSignatureVerification();
  await testCapabilityTokenEnforcement();
  await testDrandSelectionDeterminism();
  await testVerdictDeterminism();
  await testVerdictInconclusiveMapsToVoid();
  testPaymentEstimatorMaths();
  await testPaymentEstimatorStubShape();
  testPayerWalletValidation();
  testConfigFailFastGuards();
  testSecurityHeadersPresence();
  await testRpcPayerMismatchGuard();
  testTreasuryReplayPrevention();
  testCaseRuntimeInitialisation();
  testNamedDefendantSchedulingAfterAcceptance();
  testTranscriptSequence();
  testIdempotencyRecordStorage();
  testDefenceClaimRace();
  testNamedDefendantExclusivity();
  await testDefenceCutoffVoiding();
  testVictoryScoreAndLeaderboard();
  testOpenDefenceQuery();
  testOpenClawToolContractParity();
  testMlSignalValidation();
  await testDrandHttpIntegration();
  if (process.env.RUN_SMOKE_OPENCLAW === "1") {
    execFileSync("node", ["--import", "tsx", "tests/smoke/openclaw-participation.smoke.ts"], {
      stdio: "inherit"
    });
  }
  process.stdout.write("All tests passed\n");
}

run().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
