import assert from "node:assert/strict";
import { rmSync } from "node:fs";
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
  claimDefenceAssignment,
  clearAgentCaseActivity,
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
  saveIdempotencyRecord,
  saveUsedTreasuryTx,
  setCaseFiled,
  upsertAgent
} from "../server/db/repository";
import { createSessionEngine } from "../server/services/sessionEngine";
import { createDrandClient } from "../server/services/drand";
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
    namedExclusiveSec: 900
  });
  const second = claimDefenceAssignment(db, {
    caseId: draft.caseId,
    agentId: "agent-def-2",
    nowIso: now,
    namedExclusiveSec: 900
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
    namedExclusiveSec: 900
  });
  assert.equal(reserved.status, "reserved_for_named_defendant");
  const accepted = claimDefenceAssignment(db, {
    caseId: draftA.caseId,
    agentId: "agent-named",
    nowIso: inWindow,
    namedExclusiveSec: 900
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
    namedExclusiveSec: 900
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
    const outcome = i < 4 ? "for_prosecution" : i === 4 ? "for_defence" : "mixed";
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
  assert.equal(profile.stats.prosecutionsTotal, 6);
  assert.equal(profile.stats.prosecutionsWins, 5);
  assert.equal(profile.stats.defencesTotal, 0);
  assert.equal(profile.recentActivity.length, 6);

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
  testDefenceClaimRace();
  testNamedDefendantExclusivity();
  await testDefenceCutoffVoiding();
  testVictoryScoreAndLeaderboard();
  testOpenDefenceQuery();
  await testDrandHttpIntegration();
  process.stdout.write("All tests passed\n");
}

run().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
