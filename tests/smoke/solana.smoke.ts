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
    APP_ENV: "development",
    MINT_WORKER_HOST: "127.0.0.1",
    MINT_WORKER_PORT: "8898",
    WORKER_TOKEN: "smoke-worker-token",
    MINT_WORKER_MODE: "stub"
  });

  try {
    await wait(1400);

    const noToken = await fetch("http://127.0.0.1:8898/mint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: "smoke-stub-job",
        caseId: "OC-SMOKE-STUB",
        verdictHash: "hash-smoke",
        transcriptRootHash: "transcript-hash-smoke",
        jurySelectionProofHash: "jury-proof-hash-smoke",
        rulesetVersion: "agentic-code-v1.0.0",
        drandRound: 1234567,
        drandRandomness: "drand-randomness-smoke",
        jurorPoolSnapshotHash: "pool-snapshot-hash-smoke",
        outcome: "for_prosecution",
        decidedAtIso: new Date().toISOString(),
        externalUrl: "https://example.invalid/decision/smoke",
        verdictUri: "https://example.invalid/decision/smoke",
        metadata: { caseSummary: "Stub smoke", imagePath: "nft_seal.png" }
      })
    });
    assert.equal(noToken.status, 401);

    const invalidJson = await fetch("http://127.0.0.1:8898/mint", {
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

    const response = await fetch("http://127.0.0.1:8898/mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": "smoke-worker-token"
      },
      body: JSON.stringify({
        jobId: "smoke-stub-job",
        caseId: "OC-SMOKE-STUB",
        verdictHash: "hash-smoke",
        transcriptRootHash: "transcript-hash-smoke",
        jurySelectionProofHash: "jury-proof-hash-smoke",
        rulesetVersion: "agentic-code-v1.0.0",
        drandRound: 1234567,
        drandRandomness: "drand-randomness-smoke",
        jurorPoolSnapshotHash: "pool-snapshot-hash-smoke",
        outcome: "for_prosecution",
        decidedAtIso: new Date().toISOString(),
        externalUrl: "https://example.invalid/decision/smoke",
        verdictUri: "https://example.invalid/decision/smoke",
        metadata: {
          caseSummary: "Stub smoke",
          imagePath: "nft_seal.png"
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
      transcriptRootHash: "transcript-hash-smoke",
      jurySelectionProofHash: "jury-proof-hash-smoke",
      rulesetVersion: "agentic-code-v1.0.0",
      drandRound: 1234567,
      drandRandomness: "drand-randomness-smoke",
      jurorPoolSnapshotHash: "pool-snapshot-hash-smoke",
      outcome: "for_prosecution",
      decidedAtIso: new Date().toISOString(),
      externalUrl: "https://example.invalid/decision/smoke",
      verdictUri: "https://example.invalid/decision/smoke",
      metadata: {
        caseSummary: "x".repeat(1024 * 1024 + 128),
        imagePath: "nft_seal.png"
      }
    });
    const oversized = await fetch("http://127.0.0.1:8898/mint", {
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
  if (process.env.SMOKE_MINT_NETWORK !== "1") {
    process.stdout.write(
      "Bubblegum worker smoke skipped. Set SMOKE_MINT_NETWORK=1 to exercise metadata upload and mint endpoint retries.\n"
    );
    return;
  }

  const worker = startNodeTsxProcess("smoke-worker-bubblegum", "server/mint-worker/main.ts", {
    APP_ENV: "development",
    MINT_WORKER_HOST: "127.0.0.1",
    MINT_WORKER_PORT: "8899",
    WORKER_TOKEN: "smoke-worker-token",
    MINT_WORKER_MODE: "bubblegum_v2",
    MINT_SIGNING_STRATEGY: "external_endpoint",
    PINATA_JWT: "smoke-pinata-jwt",
    BUBBLEGUM_MINT_ENDPOINT: "http://127.0.0.1:65530/mock-bubblegum-mint"
  });

  try {
    await wait(1400);
    const response = await fetch("http://127.0.0.1:8899/mint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Token": "smoke-worker-token"
      },
      body: JSON.stringify({
        jobId: "smoke-bubblegum-job",
        caseId: "OC-SMOKE-BUBBLEGUM",
        verdictHash: "hash-smoke",
        transcriptRootHash: "transcript-hash-smoke",
        jurySelectionProofHash: "jury-proof-hash-smoke",
        rulesetVersion: "agentic-code-v1.0.0",
        drandRound: 1234567,
        drandRandomness: "drand-randomness-smoke",
        jurorPoolSnapshotHash: "pool-snapshot-hash-smoke",
        outcome: "for_prosecution",
        decidedAtIso: new Date().toISOString(),
        externalUrl: "https://example.invalid/decision/smoke",
        verdictUri: "https://example.invalid/decision/smoke",
        metadata: {
          caseSummary: "Bubblegum smoke",
          imagePath: "nft_seal.png"
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
      (body.errorMessage || "").includes("Pinata upload failed") ||
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
