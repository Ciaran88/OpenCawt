import assert from "node:assert/strict";
import { getConfig } from "../../server/config";
import { createSolanaProvider } from "../../server/services/solanaProvider";
import { startNodeTsxProcess, stopProcess } from "./helpers";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function testStubProvider() {
  const config = getConfig();
  config.solanaMode = "stub";
  const provider = createSolanaProvider(config);
  const result = await provider.verifyFilingFeeTx("smoke-stub-tx");
  assert.equal(result.finalised, true);
  assert.equal(result.recipient, config.treasuryAddress);
  assert.ok(result.amountLamports >= config.filingFeeLamports);
}

async function testWorkerStub() {
  const worker = startNodeTsxProcess("smoke-worker-stub", "server/mint-worker/main.ts", {
    MINT_WORKER_HOST: "127.0.0.1",
    MINT_WORKER_PORT: "8798",
    WORKER_TOKEN: "smoke-worker-token",
    MINT_WORKER_MODE: "stub"
  });

  try {
    await wait(600);

    const noToken = await fetch("http://127.0.0.1:8798/mint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "smoke-stub-job",
        caseId: "OC-SMOKE-STUB",
        verdictHash: "hash-smoke",
        verdictUri: "https://example.invalid/decision/smoke",
        metadata: { title: "Smoke", summary: "Stub smoke", closedAtIso: new Date().toISOString() }
      })
    });
    assert.equal(noToken.status, 401);

    const invalidJson = await fetch("http://127.0.0.1:8798/mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": "smoke-worker-token"
      },
      body: "{invalid"
    });
    assert.equal(invalidJson.status, 400);
    const invalidBody = (await invalidJson.json()) as { error?: string };
    assert.equal(invalidBody.error, "invalid_json");

    const response = await fetch("http://127.0.0.1:8798/mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": "smoke-worker-token"
      },
      body: JSON.stringify({
        jobId: "smoke-stub-job",
        caseId: "OC-SMOKE-STUB",
        verdictHash: "hash-smoke",
        verdictUri: "https://example.invalid/decision/smoke",
        metadata: {
          title: "Smoke",
          summary: "Stub smoke",
          closedAtIso: new Date().toISOString()
        }
      })
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      status: string;
      assetId?: string;
      txSig?: string;
    };
    assert.equal(body.status, "minted");
    assert.ok(body.assetId && body.txSig);

    const hugeBody = JSON.stringify({
      jobId: "smoke-stub-job-big",
      caseId: "OC-SMOKE-STUB-BIG",
      verdictHash: "hash-smoke",
      verdictUri: "https://example.invalid/decision/smoke",
      metadata: {
        title: "Smoke",
        summary: "x".repeat(1024 * 1024 + 128),
        closedAtIso: new Date().toISOString()
      }
    });
    const oversized = await fetch("http://127.0.0.1:8798/mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": "smoke-worker-token"
      },
      body: hugeBody
    });
    assert.equal(oversized.status, 413);
  } finally {
    await stopProcess(worker);
  }
}

async function testWorkerBubblegumConfigGuard() {
  const worker = startNodeTsxProcess("smoke-worker-bubblegum", "server/mint-worker/main.ts", {
    MINT_WORKER_HOST: "127.0.0.1",
    MINT_WORKER_PORT: "8799",
    WORKER_TOKEN: "smoke-worker-token",
    MINT_WORKER_MODE: "bubblegum_v2",
    BUBBLEGUM_MINT_ENDPOINT: "http://127.0.0.1:65530/mock-bubblegum-mint"
  });

  try {
    await wait(600);
    const response = await fetch("http://127.0.0.1:8799/mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": "smoke-worker-token"
      },
      body: JSON.stringify({
        jobId: "smoke-bubblegum-job",
        caseId: "OC-SMOKE-BUBBLEGUM",
        verdictHash: "hash-smoke",
        verdictUri: "https://example.invalid/decision/smoke",
        metadata: {
          title: "Smoke",
          summary: "Bubblegum smoke",
          closedAtIso: new Date().toISOString()
        }
      })
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      status: string;
      errorCode?: string;
      errorMessage?: string;
    };
    assert.equal(body.status, "failed");
    assert.equal(body.errorCode, "MINT_FAILED");
    assert.ok(
      (body.errorMessage || "").includes("Mint request failed after retries"),
      "Expected actionable bubblegum execution failure message."
    );
  } finally {
    await stopProcess(worker);
  }
}

async function testRpcModeIfConfigured() {
  if (process.env.SMOKE_SOLANA_RPC !== "1") {
    process.stdout.write("RPC Solana smoke skipped. Set SMOKE_SOLANA_RPC=1 to enable.\n");
    return;
  }

  if (!process.env.HELIUS_API_KEY || !process.env.HELIUS_RPC_URL || !process.env.TREASURY_ADDRESS) {
    throw new Error(
      "RPC smoke requested but Helius credentials are missing. Provide HELIUS_API_KEY, HELIUS_RPC_URL and TREASURY_ADDRESS."
    );
  }

  const config = getConfig();
  config.solanaMode = "rpc";
  const provider = createSolanaProvider(config);
  let failed = false;
  try {
    await provider.verifyFilingFeeTx("invalid-smoke-signature");
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.length > 0);
  }
  assert.equal(failed, true);
}

async function main() {
  await testStubProvider();
  await testWorkerStub();
  await testWorkerBubblegumConfigGuard();
  await testRpcModeIfConfigured();
  process.stdout.write("Solana and minting smoke passed\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
