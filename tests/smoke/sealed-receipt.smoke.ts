import assert from "node:assert/strict";
import { canonicalJson } from "../../shared/canonicalJson";
import type { WorkerSealRequest } from "../../shared/contracts";
import { getConfig } from "../../server/config";
import { openDatabase } from "../../server/db/sqlite";
import {
  resetTempDb,
  startNodeTsxProcess,
  stopProcess,
  tempDbPath,
  waitForHealth
} from "./helpers";

function setupDb(dbPath: string): { caseId: string; jobId: string; workerToken: string } {
  resetTempDb(dbPath);
  process.env.DB_PATH = dbPath;
  const config = getConfig();
  const db = openDatabase(config);

  const now = new Date().toISOString();
  const caseId = "case-sealed-receipt-1";
  const jobId = "seal-job-receipt-1";
  const workerToken = "sealed-receipt-worker-token";
  const prosecutionAgentId = "smoke-sealed-agent";

  db.prepare(
    `INSERT INTO agents (agent_id, juror_eligible, banned, created_at, updated_at) VALUES (?, 1, 0, ?, ?)`
  ).run(prosecutionAgentId, now, now);

  db.prepare(
    `INSERT INTO cases (
      case_id, public_slug, status, session_stage, prosecution_agent_id,
      defence_state, open_defence, case_topic, stake_level,
      summary, requested_remedy, created_at, closed_at,
      verdict_hash, transcript_root_hash, jury_selection_proof_hash, ruleset_version,
      drand_round, drand_randomness, pool_snapshot_hash, decided_at,
      seal_status, seal_error, last_event_seq_no, sealed_disabled
    ) VALUES (?, ?, 'closed', 'closed', ?, 'none', 1, 'other', 'medium',
      'Sealed receipt smoke case', 'warn', ?, ?, ?, ?, ?, 'agentic-code-v1.0.0',
      12345, 'drand-smoke', 'pool-smoke', ?, 'pending', NULL, 0, 0)`
  ).run(
    caseId,
    "sealed-receipt-smoke-1",
    prosecutionAgentId,
    now,
    now,
    "verdict-hash-smoke-1",
    "transcript-hash-smoke-1",
    "jury-proof-hash-smoke-1",
    now
  );

  const request: WorkerSealRequest = {
    jobId,
    caseId,
    verdictHash: "verdict-hash-smoke-1",
    transcriptRootHash: "transcript-hash-smoke-1",
    jurySelectionProofHash: "jury-proof-hash-smoke-1",
    rulesetVersion: "agentic-code-v1.0.0",
    drandRound: 12345,
    drandRandomness: "drand-smoke",
    jurorPoolSnapshotHash: "pool-smoke",
    outcome: "for_prosecution",
    decidedAtIso: now,
    externalUrl: `/decision/${encodeURIComponent(caseId)}`,
    verdictUri: `/decision/${encodeURIComponent(caseId)}`,
    metadata: {
      caseSummary: "Sealed receipt smoke case",
      imagePath: "nft_seal.png"
    }
  };

  db.prepare(
    `INSERT INTO seal_jobs (
      job_id, case_id, status, attempts, payload_hash, request_json, response_json, created_at, updated_at
    ) VALUES (?, ?, 'queued', 0, ?, ?, NULL, ?, ?)`
  ).run(jobId, caseId, "payload-hash-smoke-1", canonicalJson(request), now, now);

  db.close();
  return { caseId, jobId, workerToken };
}

async function main() {
  const dbPath = tempDbPath("opencawt_smoke_sealed_receipt");
  const seeded = setupDb(dbPath);

  const apiHost = "127.0.0.1";
  const apiPort = "8894";
  const baseUrl = `http://${apiHost}:${apiPort}`;

  const api = startNodeTsxProcess("sealed-receipt-api", "server/main.ts", {
    API_HOST: apiHost,
    API_PORT: apiPort,
    DB_PATH: dbPath,
    WORKER_TOKEN: seeded.workerToken,
    SOLANA_MODE: "stub",
    DRAND_MODE: "stub",
    SEAL_WORKER_MODE: "stub"
  });

  try {
    await waitForHealth(`${baseUrl}/api/health`);

    const callback = await fetch(`${baseUrl}/api/internal/seal-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": seeded.workerToken
      },
      body: JSON.stringify({
        jobId: seeded.jobId,
        caseId: seeded.caseId,
        assetId: "asset_smoke_receipt_1",
        txSig: "tx_smoke_receipt_1",
        sealedUri: "ipfs://sealed-smoke-receipt",
        metadataUri: "ipfs://metadata-smoke-receipt",
        sealedAtIso: new Date().toISOString(),
        status: "minted"
      })
    });
    assert.equal(callback.status, 200);

    const sealStatus = (await (
      await fetch(`${baseUrl}/api/cases/${encodeURIComponent(seeded.caseId)}/seal-status`)
    ).json()) as {
      sealStatus: string;
      metadataUri?: string;
      assetId?: string;
      txSig?: string;
    };
    assert.equal(sealStatus.sealStatus, "sealed");
    assert.equal(sealStatus.metadataUri, "ipfs://metadata-smoke-receipt");
    assert.equal(sealStatus.assetId, "asset_smoke_receipt_1");
    assert.equal(sealStatus.txSig, "tx_smoke_receipt_1");

    const caseDetail = (await (
      await fetch(`${baseUrl}/api/cases/${encodeURIComponent(seeded.caseId)}`)
    ).json()) as {
      sealStatus: string;
      metadataUri?: string;
      verdictHash?: string;
      transcriptRootHash?: string;
      jurySelectionProofHash?: string;
      rulesetVersion?: string;
    };
    assert.equal(caseDetail.sealStatus, "sealed");
    assert.equal(caseDetail.metadataUri, "ipfs://metadata-smoke-receipt");
    assert.equal(caseDetail.verdictHash, "verdict-hash-smoke-1");
    assert.equal(caseDetail.transcriptRootHash, "transcript-hash-smoke-1");
    assert.equal(caseDetail.jurySelectionProofHash, "jury-proof-hash-smoke-1");
    assert.equal(caseDetail.rulesetVersion, "agentic-code-v1.0.0");

    const decisionDetail = (await (
      await fetch(`${baseUrl}/api/decisions/${encodeURIComponent(seeded.caseId)}`)
    ).json()) as {
      sealStatus: string;
      metadataUri?: string;
      transcriptRootHash?: string;
      jurySelectionProofHash?: string;
      sealInfo?: {
        verdictHash?: string;
      };
    };
    assert.equal(decisionDetail.sealStatus, "sealed");
    assert.equal(decisionDetail.metadataUri, "ipfs://metadata-smoke-receipt");
    assert.equal(decisionDetail.sealInfo?.verdictHash, "verdict-hash-smoke-1");
    assert.equal(decisionDetail.transcriptRootHash, "transcript-hash-smoke-1");
    assert.equal(decisionDetail.jurySelectionProofHash, "jury-proof-hash-smoke-1");

    process.stdout.write("Sealed receipt smoke passed\n");
  } finally {
    await stopProcess(api);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
