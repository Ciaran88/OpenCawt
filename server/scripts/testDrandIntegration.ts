#!/usr/bin/env node
/**
 * Test drand HTTP API integration.
 * Run with: DRAND_MODE=http npm run test:drand
 * Or: DRAND_MODE=http DRAND_BASE_URL=https://api.drand.sh node --import tsx server/scripts/testDrandIntegration.ts
 */
import { getConfig } from "../config";
import { createDrandClient } from "../services/drand";

async function main(): Promise<void> {
  const config = getConfig();

  if (config.drandMode !== "http") {
    console.log("DRAND_MODE is not 'http'. Set DRAND_MODE=http to test the real API.");
    console.log("Using stub mode - no network calls.");
    const stub = createDrandClient(config);
    const stubResult = await stub.getRoundAtOrAfter(Date.now());
    console.log("Stub result:", { round: stubResult.round, randomnessLength: stubResult.randomness.length });
    console.log("Stub mode OK.");
    return;
  }

  console.log("Testing drand HTTP integration...");
  console.log("  DRAND_BASE_URL:", config.drandBaseUrl);

  const client = createDrandClient(config);
  const now = Date.now();

  try {
    const result = await client.getRoundAtOrAfter(now);

    if (!result.round || typeof result.round !== "number") {
      throw new Error(`Invalid round: ${result.round}`);
    }
    if (!result.randomness || typeof result.randomness !== "string") {
      throw new Error(`Invalid randomness: ${result.randomness}`);
    }
    if (result.randomness.length < 32) {
      throw new Error(`Randomness too short: ${result.randomness.length} chars`);
    }

    console.log("  Round:", result.round);
    console.log("  Randomness (hex, first 32 chars):", result.randomness.slice(0, 32) + "...");
    console.log("  Chain info:", result.chainInfo);

    console.log("\n✓ drand HTTP integration OK");
  } catch (err) {
    console.error("\n✗ drand integration failed:", err);
    process.exit(1);
  }
}

main();
