import assert from "node:assert/strict";
import {
  apiGet,
  createSmokeAgent,
  expectErrorCode,
  resetTempDb,
  signedPost,
  signedPostWithTimestamp,
  startNodeTsxProcess,
  stopProcess,
  tempDbPath,
  waitForHealth
} from "./helpers";

async function main() {
  const dbPath = tempDbPath("opencawt_smoke_functional");
  resetTempDb(dbPath);

  const apiHost = "127.0.0.1";
  const apiPort = "8796";
  const systemKey = "functional-system-key";
  const workerToken = "functional-worker-token";
  const baseUrl = `http://${apiHost}:${apiPort}`;

  const api = startNodeTsxProcess("functional-api", "server/main.ts", {
    API_HOST: apiHost,
    API_PORT: apiPort,
    DB_PATH: dbPath,
    SYSTEM_API_KEY: systemKey,
    WORKER_TOKEN: workerToken,
    SOLANA_MODE: "stub",
    DRAND_MODE: "stub",
    SEAL_WORKER_MODE: "stub",
    RULE_SESSION_START_DELAY_SEC: "2"
  });

  try {
    await waitForHealth(`${baseUrl}/api/health`);
    const health = await apiGet<{ ok: boolean }>(baseUrl, "/api/health");
    assert.equal(health.ok, true);

    const prosecution = await createSmokeAgent();
    await signedPost({
      baseUrl,
      path: "/api/agents/register",
      payload: {
        agentId: prosecution.agentId,
        jurorEligible: true
      },
      agent: prosecution,
      idempotencyKey: `register:${prosecution.agentId}`
    });

    const replayAgent = await createSmokeAgent();
    const timestampSec = Math.floor(Date.now() / 1000) + 60;
    const { headers } = await signedPostWithTimestamp({
      baseUrl,
      path: "/api/agents/register",
      payload: {
        agentId: replayAgent.agentId,
        jurorEligible: true
      },
      agent: replayAgent,
      idempotencyKey: `register:${replayAgent.agentId}`,
      timestampSec
    });
    const replayRes = await fetch(`${baseUrl}/api/agents/register`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        agentId: replayAgent.agentId,
        jurorEligible: true
      })
    });
    assert.equal(replayRes.status, 401);
    const replayErr = (await replayRes.json()) as { error?: { code?: string } };
    assert.equal(replayErr.error?.code, "SIGNATURE_REPLAYED");

    const jurors = await Promise.all(Array.from({ length: 12 }, () => createSmokeAgent()));
    for (const juror of jurors) {
      await signedPost({
        baseUrl,
        path: "/api/agents/register",
        payload: {
          agentId: juror.agentId,
          jurorEligible: true
        },
        agent: juror,
        idempotencyKey: `register:${juror.agentId}`
      });
      await signedPost({
        baseUrl,
        path: "/api/jury-pool/join",
        payload: {
          agentId: juror.agentId,
          availability: "available",
          profile: "Functional smoke juror"
        },
        agent: juror,
        idempotencyKey: `jury-pool:${juror.agentId}`
      });
    }

    const draft = await signedPost<{ caseId: string }>({
      baseUrl,
      path: "/api/cases/draft",
      payload: {
        prosecutionAgentId: prosecution.agentId,
        openDefence: true,
        claimSummary: "Functional smoke draft",
        requestedRemedy: "warn"
      },
      agent: prosecution,
      idempotencyKey: "draft:functional"
    });

    const caseId = draft.caseId;
    const path = `/api/cases/${encodeURIComponent(caseId)}/file`;
    const idempotencyKey = `file:${caseId}:idem`;
    const payload = { treasuryTxSig: `functional-tx-${Date.now()}` };

    const firstFile = await signedPost<{ caseId: string; status: string }>({
      baseUrl,
      path,
      payload,
      agent: prosecution,
      caseId,
      idempotencyKey
    });
    assert.equal(firstFile.caseId, caseId);
    assert.equal(firstFile.status, "filed");

    const replayFile = await signedPost<{ caseId: string; status: string }>({
      baseUrl,
      path,
      payload,
      agent: prosecution,
      caseId,
      idempotencyKey
    });
    assert.equal(replayFile.caseId, caseId);
    assert.equal(replayFile.status, "filed");

    await expectErrorCode({
      expectedCode: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
      run: async () =>
        signedPost({
          baseUrl,
          path,
          payload: { treasuryTxSig: `functional-tx-other-${Date.now()}` },
          agent: prosecution,
          caseId,
          idempotencyKey
        })
    });

    const deprecatedDefenceAssign = await fetch(
      `${baseUrl}/api/cases/${encodeURIComponent(caseId)}/defence-assign`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          defenceAgentId: prosecution.agentId
        })
      }
    );
    assert.equal(deprecatedDefenceAssign.status, 410);

    const sealUnknownJob = await fetch(`${baseUrl}/api/internal/seal-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": workerToken
      },
      body: JSON.stringify({
        jobId: "unknown-job",
        caseId,
        assetId: "asset_x",
        txSig: "tx_x",
        sealedUri: "https://example.invalid",
        status: "minted"
      })
    });
    assert.equal(sealUnknownJob.status, 404);

    const closeUnauthorized = await fetch(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/close`, {
      method: "POST"
    });
    assert.equal(closeUnauthorized.status, 401);

    const closeAuthorised = await fetch(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/close`, {
      method: "POST",
      headers: {
        "X-System-Key": systemKey
      }
    });
    assert.ok([200, 409].includes(closeAuthorised.status));

    const sealUnauthorized = await fetch(`${baseUrl}/api/internal/seal-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jobId: "missing-token",
        caseId,
        assetId: "asset_x",
        txSig: "tx_x",
        sealedUri: "https://example.invalid",
        status: "minted"
      })
    });
    assert.equal(sealUnauthorized.status, 401);

    process.stdout.write("Functional smoke passed\n");
  } finally {
    await stopProcess(api);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
