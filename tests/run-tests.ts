import assert from "node:assert/strict";
import { canonicalJson } from "../shared/canonicalJson";
import { encodeBase58 } from "../shared/base58";
import { canonicalHashHex } from "../shared/hash";
import type { VoteEntry } from "../shared/contracts";
import { signPayload, verifySignedPayload } from "../shared/signing";
import { selectJuryDeterministically } from "../server/services/jury";
import { computeDeterministicVerdict } from "../server/services/verdict";
import { getConfig } from "../server/config";
import { openDatabase, resetDatabase } from "../server/db/sqlite";
import {
  appendTranscriptEvent,
  createCaseDraft,
  getCaseRuntime,
  getIdempotencyRecord,
  isTreasuryTxUsed,
  saveIdempotencyRecord,
  saveUsedTreasuryTx,
  setCaseFiled,
  upsertAgent
} from "../server/db/repository";
import {
  computeCountdownState,
  computeRingDashOffset,
  formatDurationLabel
} from "../src/util/countdown";
import { parseRoute, routeToPath } from "../src/util/router";

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
  assert.deepEqual(parseRoute("/unknown"), { name: "schedule" });
  assert.equal(routeToPath({ name: "about" }), "/about");
  assert.equal(routeToPath({ name: "case", id: "OC-26-0217-A11" }), "/case/OC-26-0217-A11");
}

async function testCanonicalHashing() {
  const a = { z: 1, a: [3, { c: true, b: "x" }] };
  const b = { a: [3, { b: "x", c: true }], z: 1 };

  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(await canonicalHashHex(a), await canonicalHashHex(b));

  assert.throws(() => canonicalJson({ bad: Number.POSITIVE_INFINITY }), /non-finite/i);
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
}

function testTreasuryReplayPrevention() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase4_test.sqlite";
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
    scheduleDelaySec: 3600
  });

  const runtime = getCaseRuntime(db, seededCase.caseId);
  assert.ok(runtime);
  assert.equal(runtime?.currentStage, "pre_session");
  assert.ok(runtime?.scheduledSessionStartAtIso);

  db.close();
}

function testTranscriptSequence() {
  const config = getConfig();
  config.dbPath = "/tmp/opencawt_phase4_transcript_test.sqlite";
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

  db.close();
}

async function run() {
  await testCountdownMaths();
  testRouteParsing();
  await testCanonicalHashing();
  await testSignatureVerification();
  await testDrandSelectionDeterminism();
  await testVerdictDeterminism();
  testTreasuryReplayPrevention();
  testCaseRuntimeInitialisation();
  testTranscriptSequence();
  testIdempotencyRecordStorage();
  process.stdout.write("All tests passed\n");
}

run().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
