/**
 * OCP Minting Fee Estimator.
 *
 * Mirrors the main app's `server/services/paymentEstimator.ts` but uses OcpConfig
 * directly. Provides stub and RPC modes.
 *
 * Reuses pure helper functions from the main app's paymentEstimator:
 *   - clampComputeUnitLimit
 *   - priorityFeeLamports
 *   - isValidSolanaPubkey
 */
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import type { OcpConfig } from "../config";
import type { OcpHeliusClient } from "./ocpHeliusClient";
import type { OcpFeeEstimateResponse } from "../../../shared/contracts";
import {
  clampComputeUnitLimit,
  priorityFeeLamports,
  isValidSolanaPubkey,
} from "../../../server/services/paymentEstimator";

export { isValidSolanaPubkey };

const FALLBACK_BASE_FEE_LAMPORTS = 5_000;
const FALLBACK_PRIORITY_MICRO_LAMPORTS = 2_000;
const MIN_CU_LIMIT = 50_000;

export interface OcpFeeEstimator {
  estimateMintingFee(input?: { payerWallet?: string }): Promise<OcpFeeEstimateResponse>;
}

interface CacheEntry {
  expiresAtMs: number;
  value: OcpFeeEstimateResponse;
}

function toSafeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

class StubOcpFeeEstimator implements OcpFeeEstimator {
  constructor(private readonly config: OcpConfig) {}

  async estimateMintingFee(input?: { payerWallet?: string }): Promise<OcpFeeEstimateResponse> {
    const computeUnitLimit = MIN_CU_LIMIT;
    const computeUnitPriceMicroLamports = FALLBACK_PRIORITY_MICRO_LAMPORTS;
    const priorityLamports = priorityFeeLamports(computeUnitLimit, computeUnitPriceMicroLamports);
    const networkFeeLamports = FALLBACK_BASE_FEE_LAMPORTS + priorityLamports;

    return {
      payerWallet: input?.payerWallet,
      recommendedAtIso: new Date().toISOString(),
      staleAfterSec: Math.max(10, this.config.paymentEstimateCacheSec),
      breakdown: {
        mintingFeeLamports: this.config.mintingFeeLamports,
        baseFeeLamports: FALLBACK_BASE_FEE_LAMPORTS,
        computeUnitLimit,
        computeUnitPriceMicroLamports,
        priorityFeeLamports: priorityLamports,
        networkFeeLamports,
        totalEstimatedLamports: this.config.mintingFeeLamports + networkFeeLamports,
      },
      recommendation: {
        rpcUrl: this.config.heliusRpcUrl || "stub-rpc-url",
        treasuryAddress: this.config.treasuryAddress,
        recentBlockhash: "stub-blockhash",
        lastValidBlockHeight: 0,
        computeUnitLimit,
        computeUnitPriceMicroLamports,
      },
    };
  }
}

class RpcOcpFeeEstimator implements OcpFeeEstimator {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly config: OcpConfig,
    private readonly helius: OcpHeliusClient
  ) {}

  async estimateMintingFee(input?: { payerWallet?: string }): Promise<OcpFeeEstimateResponse> {
    const payerWallet = input?.payerWallet?.trim() || undefined;
    const cacheKey = payerWallet ?? "__default__";
    const nowMs = Date.now();
    const existing = this.cache.get(cacheKey);
    if (existing && existing.expiresAtMs > nowMs) {
      return existing.value;
    }

    const payerPubkey = new PublicKey(payerWallet || this.config.treasuryAddress);
    const treasuryPubkey = new PublicKey(this.config.treasuryAddress);

    // 1. Get latest blockhash
    const latest = await this.helius.callRpc<{
      value?: { blockhash?: string; lastValidBlockHeight?: number };
    }>("getLatestBlockhash", [{ commitment: "processed" }]);

    const recentBlockhash = String(latest?.value?.blockhash || "").trim();
    const lastValidBlockHeight = toSafeNumber(latest?.value?.lastValidBlockHeight, 0);
    if (!recentBlockhash) {
      throw new Error("OCP_FEE_ESTIMATE_UNAVAILABLE: Could not resolve a recent blockhash.");
    }

    // 2. Simulate transaction for compute units
    const testLimit = Math.max(MIN_CU_LIMIT, 200_000);
    const estimateTx = new Transaction({ feePayer: payerPubkey, recentBlockhash });
    estimateTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: testLimit }));
    estimateTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }));
    estimateTx.add(
      SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: treasuryPubkey,
        lamports: this.config.mintingFeeLamports,
      })
    );

    const estimateTxBase64 = Buffer.from(
      estimateTx.serialize({ requireAllSignatures: false, verifySignatures: false })
    ).toString("base64");

    const simulation = await this.helius.callRpc<{
      value?: { unitsConsumed?: number };
    }>("simulateTransaction", [
      estimateTxBase64,
      { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "processed" },
    ]);

    const consumedUnits = toSafeNumber(simulation?.value?.unitsConsumed, MIN_CU_LIMIT);
    const computeUnitLimit = clampComputeUnitLimit(consumedUnits, MIN_CU_LIMIT, 10);

    // 3. Get priority fee estimate
    let computeUnitPriceMicroLamports = 0;
    try {
      const priorityEstimate = await this.helius.callRpc<{ priorityFeeEstimate?: number }>(
        "getPriorityFeeEstimate",
        [{ transaction: estimateTxBase64, options: { recommended: true } }]
      );
      computeUnitPriceMicroLamports = toSafeNumber(priorityEstimate?.priorityFeeEstimate, 0);
    } catch {
      const fallbackEstimate = await this.helius.callRpc<{ priorityFeeEstimate?: number }>(
        "getPriorityFeeEstimate",
        [{ accountKeys: [payerPubkey.toBase58(), treasuryPubkey.toBase58()], options: { recommended: true } }]
      );
      computeUnitPriceMicroLamports = toSafeNumber(fallbackEstimate?.priorityFeeEstimate, 0);
    }

    if (!computeUnitPriceMicroLamports) {
      throw new Error("OCP_HELIUS_PRIORITY_ESTIMATE_FAILED: Helius priority fee estimate is unavailable.");
    }

    // 4. Get base fee for the final transaction
    const finalTx = new Transaction({ feePayer: payerPubkey, recentBlockhash });
    finalTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }));
    finalTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPriceMicroLamports }));
    finalTx.add(
      SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: treasuryPubkey,
        lamports: this.config.mintingFeeLamports,
      })
    );
    const compiledMessageBase64 = Buffer.from(finalTx.compileMessage().serialize()).toString("base64");

    const feeResult = await this.helius.callRpc<{ value?: number | null }>("getFeeForMessage", [
      compiledMessageBase64,
      { commitment: "processed" },
    ]);
    const baseFeeLamports = toSafeNumber(feeResult?.value, FALLBACK_BASE_FEE_LAMPORTS) || FALLBACK_BASE_FEE_LAMPORTS;

    // 5. Build response
    const priorityLamports = priorityFeeLamports(computeUnitLimit, computeUnitPriceMicroLamports);
    const networkFeeLamports = baseFeeLamports + priorityLamports;

    const response: OcpFeeEstimateResponse = {
      payerWallet,
      recommendedAtIso: new Date().toISOString(),
      staleAfterSec: Math.max(10, this.config.paymentEstimateCacheSec),
      breakdown: {
        mintingFeeLamports: this.config.mintingFeeLamports,
        baseFeeLamports,
        computeUnitLimit,
        computeUnitPriceMicroLamports,
        priorityFeeLamports: priorityLamports,
        networkFeeLamports,
        totalEstimatedLamports: this.config.mintingFeeLamports + networkFeeLamports,
      },
      recommendation: {
        rpcUrl: this.config.heliusRpcUrl,
        treasuryAddress: this.config.treasuryAddress,
        recentBlockhash,
        lastValidBlockHeight,
        computeUnitLimit,
        computeUnitPriceMicroLamports,
      },
    };

    // Cache
    const ttlMs = this.config.paymentEstimateCacheSec * 1000;
    if (ttlMs > 0) {
      this.cache.set(cacheKey, { expiresAtMs: nowMs + ttlMs, value: response });
    }

    return response;
  }
}

export function createOcpFeeEstimator(config: OcpConfig, helius: OcpHeliusClient): OcpFeeEstimator {
  if (config.solanaMode === "rpc") {
    return new RpcOcpFeeEstimator(config, helius);
  }
  return new StubOcpFeeEstimator(config);
}
