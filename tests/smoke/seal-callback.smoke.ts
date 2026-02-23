import assert from "node:assert/strict";
import {
  resetTempDb,
  startNodeTsxProcess,
  stopProcess,
  tempDbPath,
  waitForHealth
} from "./helpers";
import { canonicalJson } from "../../shared/canonicalJson";
import type { WorkerSealRequest } from "../../shared/contracts";
import { getConfig } from "../../server/config";
import { openDatabase } from "../../server/db/sqlite";

const EXPECTED_HASH = "expected-hash-123";
const WRONG_HASH = "wrong-hash-456";
const HASH_2 = "hash-2-for-success";

function setupSealCallbackDb(dbPath: string): void {
  resetTempDb(dbPath);
  process.env.DB_PATH = dbPath;
  const config = getConfig();
  const db = openDatabase(config);

  const now = new Date().toISOString();
  const agentId = "smoke-seal-agent";

  db.prepare(
    `INSERT INTO agents (agent_id, juror_eligible, banned, created_at, updated_at) VALUES (?, 1, 0, ?, ?)`
  ).run(agentId, now, now);

  const case1 = "case-seal-1";
  const case2 = "case-seal-2";
  const slug1 = "seal-smoke-1";
  const slug2 = "seal-smoke-2";

  db.prepare(
    `INSERT INTO cases (
      case_id, public_slug, status, session_stage, prosecution_agent_id,
      defence_agent_id, defence_state, open_defence, case_topic, stake_level,
      summary, requested_remedy, created_at, closed_at, verdict_hash,
      last_event_seq_no, sealed_disabled
    ) VALUES (?, ?, 'closed', 'closed', ?, NULL, 'none', 1, 'other', 'medium',
      'Seal smoke case 1', 'warn', ?, ?, ?, 0, 0)`
  ).run(case1, slug1, agentId, now, now, EXPECTED_HASH);

  db.prepare(
    `INSERT INTO cases (
      case_id, public_slug, status, session_stage, prosecution_agent_id,
      defence_agent_id, defence_state, open_defence, case_topic, stake_level,
      summary, requested_remedy, created_at, closed_at, verdict_hash,
      last_event_seq_no, sealed_disabled
    ) VALUES (?, ?, 'closed', 'closed', ?, NULL, 'none', 1, 'other', 'medium',
      'Seal smoke case 2', 'warn', ?, ?, ?, 0, 0)`
  ).run(case2, slug2, agentId, now, now, HASH_2);

  const job1Request: WorkerSealRequest = {
    jobId: "seal-job-1",
    caseId: case1,
    verdictHash: WRONG_HASH,
    transcriptRootHash: "transcript-hash-1",
    jurySelectionProofHash: "jury-proof-hash-1",
    rulesetVersion: "agentic-code-v1.0.0",
    drandRound: 1234567,
    drandRandomness: "drand-randomness-1",
    jurorPoolSnapshotHash: "pool-hash-1",
    outcome: "for_prosecution",
    decidedAtIso: now,
    externalUrl: `https://opencawt.example/decision/${encodeURIComponent(case1)}`,
    verdictUri: `https://opencawt.example/decision/${encodeURIComponent(case1)}`,
    metadata: { caseSummary: "Smoke", imagePath: "nft_seal.png" }
  };

  const job2Request: WorkerSealRequest = {
    jobId: "seal-job-2",
    caseId: case2,
    verdictHash: HASH_2,
    transcriptRootHash: "transcript-hash-2",
    jurySelectionProofHash: "jury-proof-hash-2",
    rulesetVersion: "agentic-code-v1.0.0",
    drandRound: 1234568,
    drandRandomness: "drand-randomness-2",
    jurorPoolSnapshotHash: "pool-hash-2",
    outcome: "for_defence",
    decidedAtIso: now,
    externalUrl: `https://opencawt.example/decision/${encodeURIComponent(case2)}`,
    verdictUri: `https://opencawt.example/decision/${encodeURIComponent(case2)}`,
    metadata: { caseSummary: "Smoke", imagePath: "nft_seal.png" }
  };

  db.prepare(
    `INSERT INTO seal_jobs (job_id, case_id, status, payload_hash, request_json, response_json, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, NULL, ?, ?)`
  ).run("seal-job-1", case1, "smoke-hash-1", canonicalJson(job1Request), now, now);

  db.prepare(
    `INSERT INTO seal_jobs (job_id, case_id, status, payload_hash, request_json, response_json, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, NULL, ?, ?)`
  ).run("seal-job-2", case2, "smoke-hash-2", canonicalJson(job2Request), now, now);

  db.close();
}

async function main() {
  const dbPath = tempDbPath("opencawt_smoke_seal");
  setupSealCallbackDb(dbPath);

  const apiHost = "127.0.0.1";
  const apiPort = "8798";
  const workerToken = "seal-smoke-worker-token";
  const baseUrl = `http://${apiHost}:${apiPort}`;

  const api = startNodeTsxProcess("seal-api", "server/main.ts", {
    API_HOST: apiHost,
    API_PORT: apiPort,
    DB_PATH: dbPath,
    WORKER_TOKEN: workerToken,
    SOLANA_MODE: "stub",
    DRAND_MODE: "stub",
    SEAL_WORKER_MODE: "stub"
  });

  try {
    await waitForHealth(`${baseUrl}/api/health`);

    const sealResult = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
      fetch(`${baseUrl}/api/internal/seal-result`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Token": workerToken,
          ...headers
        },
        body: JSON.stringify(payload)
      });

    const validMintPayload = {
      jobId: "seal-job-1",
      caseId: "case-seal-1",
      assetId: "asset_x",
      txSig: "tx_x",
      sealedUri: "https://example.invalid",
      metadataUri: "https://example.invalid/metadata",
      sealedAtIso: new Date().toISOString(),
      status: "minted"
    };

    const verdictHashMismatch = await sealResult(validMintPayload);
    assert.equal(verdictHashMismatch.status, 400);
    const mismatchBody = (await verdictHashMismatch.json()) as { error?: { code?: string } };
    assert.equal(mismatchBody.error?.code, "SEAL_VERDICT_HASH_MISMATCH");

    const noToken = await fetch(`${baseUrl}/api/internal/seal-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validMintPayload)
    });
    assert.equal(noToken.status, 401);

    const unknownJob = await sealResult({
      jobId: "unknown-job",
      caseId: "case-seal-1",
      assetId: "asset_x",
      txSig: "tx_x",
      sealedUri: "https://example.invalid",
      metadataUri: "https://example.invalid/metadata",
      sealedAtIso: new Date().toISOString(),
      status: "minted"
    });
    assert.equal(unknownJob.status, 404);
    const notFoundBody = (await unknownJob.json()) as { error?: { code?: string } };
    assert.equal(notFoundBody.error?.code, "SEAL_JOB_NOT_FOUND");

    const caseMismatch = await sealResult({
      jobId: "seal-job-1",
      caseId: "case-seal-2",
      assetId: "asset_x",
      txSig: "tx_x",
      sealedUri: "https://example.invalid",
      metadataUri: "https://example.invalid/metadata",
      sealedAtIso: new Date().toISOString(),
      status: "minted"
    });
    assert.equal(caseMismatch.status, 409);
    const mismatch409Body = (await caseMismatch.json()) as { error?: { code?: string } };
    assert.equal(mismatch409Body.error?.code, "SEAL_JOB_CASE_MISMATCH");

    const successPayload = {
      jobId: "seal-job-2",
      caseId: "case-seal-2",
      assetId: "asset_success",
      txSig: "tx_success",
      sealedUri: "https://example.invalid/sealed",
      metadataUri: "https://example.invalid/metadata-success",
      sealedAtIso: new Date().toISOString(),
      status: "minted"
    };

    const firstSeal = await sealResult(successPayload);
    assert.equal(firstSeal.status, 200);

    const replaySeal = await sealResult(successPayload);
    assert.equal(replaySeal.status, 200);
    const replayBody = (await replaySeal.json()) as { replayed?: boolean };
    assert.equal(replayBody.replayed, true);

    const differentPayload = await sealResult({
      ...successPayload,
      assetId: "asset_different"
    });
    assert.equal(differentPayload.status, 409);
    const finalisedBody = (await differentPayload.json()) as { error?: { code?: string } };
    assert.equal(finalisedBody.error?.code, "SEAL_JOB_ALREADY_FINALISED");

    process.stdout.write("Seal callback smoke passed\n");
  } finally {
    await stopProcess(api);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
