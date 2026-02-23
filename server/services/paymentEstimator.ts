import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import type {
  FilingFeeEstimateResponse
} from "../../shared/contracts";
import type { AppConfig } from "../config";
import { createHeliusClient } from "./heliusClient";
import { badRequest } from "./errors";

const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const FALLBACK_BASE_FEE_LAMPORTS = 5_000;
const FALLBACK_PRIORITY_MICRO_LAMPORTS = 2_000;

interface CacheEntry {
  expiresAtMs: number;
  value: FilingFeeEstimateResponse;
}

export interface PaymentEstimator {
  estimateFilingFee(input?: { payerWallet?: string }): Promise<FilingFeeEstimateResponse>;
}

export function isValidSolanaPubkey(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

export function clampComputeUnitLimit(
  unitsConsumed: number,
  minLimit: number,
  marginPct: number
): number {
  const consumed = Number.isFinite(unitsConsumed) && unitsConsumed > 0 ? Math.ceil(unitsConsumed) : minLimit;
  const withMargin = Math.ceil(Number((consumed * (1 + marginPct / 100)).toFixed(6)));
  return Math.min(MAX_COMPUTE_UNIT_LIMIT, Math.max(minLimit, withMargin));
}

export function priorityFeeLamports(
  computeUnitLimit: number,
  computeUnitPriceMicroLamports: number
): number {
  return Math.ceil((computeUnitLimit * computeUnitPriceMicroLamports) / 1_000_000);
}

function toSafeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

class StubPaymentEstimator implements PaymentEstimator {
  constructor(private readonly config: AppConfig) {}

  async estimateFilingFee(input?: { payerWallet?: string }): Promise<FilingFeeEstimateResponse> {
    const computeUnitLimit = this.config.paymentEstimateMinCuLimit;
    const computeUnitPriceMicroLamports = FALLBACK_PRIORITY_MICRO_LAMPORTS;
    const priorityLamports = priorityFeeLamports(computeUnitLimit, computeUnitPriceMicroLamports);
    const networkFeeLamports = FALLBACK_BASE_FEE_LAMPORTS + priorityLamports;
    const recommendedAtIso = new Date().toISOString();

    return {
      payerWallet: input?.payerWallet,
      recommendedAtIso,
      staleAfterSec: Math.max(10, this.config.paymentEstimateCacheSec),
      breakdown: {
        filingFeeLamports: this.config.filingFeeLamports,
        baseFeeLamports: FALLBACK_BASE_FEE_LAMPORTS,
        computeUnitLimit,
        computeUnitPriceMicroLamports,
        priorityFeeLamports: priorityLamports,
        networkFeeLamports,
        totalEstimatedLamports: this.config.filingFeeLamports + networkFeeLamports
      },
      recommendation: {
        rpcUrl: this.config.heliusRpcUrl || this.config.solanaRpcUrl,
        treasuryAddress: this.config.treasuryAddress,
        recentBlockhash: "stub-blockhash",
        lastValidBlockHeight: 0,
        computeUnitLimit,
        computeUnitPriceMicroLamports
      }
    };
  }
}

class RpcPaymentEstimator implements PaymentEstimator {
  private readonly helius;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: AppConfig) {
    this.helius = createHeliusClient(config);
  }

  async estimateFilingFee(input?: { payerWallet?: string }): Promise<FilingFeeEstimateResponse> {
    const payerWallet = input?.payerWallet?.trim() || undefined;
    const cacheKey = payerWallet ?? "__default__";
    const nowMs = Date.now();
    const existing = this.cache.get(cacheKey);
    if (existing && existing.expiresAtMs > nowMs) {
      return existing.value;
    }

    const payerPubkey = new PublicKey(payerWallet || this.config.treasuryAddress);
    const treasuryPubkey = new PublicKey(this.config.treasuryAddress);

    const latest = await this.helius.callRpc<{
      value?: { blockhash?: string; lastValidBlockHeight?: number };
    }>("getLatestBlockhash", [{ commitment: "processed" }]);

    const recentBlockhash = String(latest?.value?.blockhash || "").trim();
    const lastValidBlockHeight = toSafeNumber(
      latest?.value?.lastValidBlockHeight,
      0
    );
    if (!recentBlockhash) {
      throw badRequest(
        "PAYMENT_ESTIMATE_UNAVAILABLE",
        "Could not resolve a recent blockhash for payment estimation."
      );
    }

    const testLimit = Math.max(this.config.paymentEstimateMinCuLimit, 200_000);
    const estimateTx = new Transaction({
      feePayer: payerPubkey,
      recentBlockhash
    });
    estimateTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: testLimit }));
    estimateTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }));
    estimateTx.add(
      SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: treasuryPubkey,
        lamports: this.config.filingFeeLamports
      })
    );

    const estimateTxBase64 = Buffer.from(
      estimateTx.serialize({ requireAllSignatures: false, verifySignatures: false })
    ).toString("base64");

    const simulation = await this.helius.callRpc<{
      value?: { unitsConsumed?: number };
    }>("simulateTransaction", [
      estimateTxBase64,
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "processed"
      }
    ]);

    const consumedUnits = toSafeNumber(
      simulation?.value?.unitsConsumed,
      this.config.paymentEstimateMinCuLimit
    );
    const computeUnitLimit = clampComputeUnitLimit(
      consumedUnits,
      this.config.paymentEstimateMinCuLimit,
      this.config.paymentEstimateCuMarginPct
    );

    let computeUnitPriceMicroLamports = 0;
    try {
      const priorityEstimate = await this.helius.callRpc<{ priorityFeeEstimate?: number }>(
        "getPriorityFeeEstimate",
        [
          {
            transaction: estimateTxBase64,
            options: {
              recommended: true
            }
          }
        ]
      );
      computeUnitPriceMicroLamports = toSafeNumber(
        priorityEstimate?.priorityFeeEstimate,
        0
      );
    } catch {
      const fallbackEstimate = await this.helius.callRpc<{ priorityFeeEstimate?: number }>(
        "getPriorityFeeEstimate",
        [
          {
            accountKeys: [payerPubkey.toBase58(), treasuryPubkey.toBase58()],
            options: {
              recommended: true
            }
          }
        ]
      );
      computeUnitPriceMicroLamports = toSafeNumber(
        fallbackEstimate?.priorityFeeEstimate,
        0
      );
    }

    if (!computeUnitPriceMicroLamports) {
      throw badRequest(
        "HELIUS_PRIORITY_ESTIMATE_FAILED",
        "Helius priority fee estimate is unavailable."
      );
    }

    const finalTx = new Transaction({
      feePayer: payerPubkey,
      recentBlockhash
    });
    finalTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }));
    finalTx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: computeUnitPriceMicroLamports })
    );
    finalTx.add(
      SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: treasuryPubkey,
        lamports: this.config.filingFeeLamports
      })
    );
    const compiledMessageBase64 = Buffer.from(finalTx.compileMessage().serialize()).toString(
      "base64"
    );

    const feeResult = await this.helius.callRpc<{ value?: number | null }>("getFeeForMessage", [
      compiledMessageBase64,
      { commitment: "processed" }
    ]);
    const baseFeeLamports = toSafeNumber(
      feeResult?.value,
      FALLBACK_BASE_FEE_LAMPORTS
    ) || FALLBACK_BASE_FEE_LAMPORTS;

    const priorityLamports = priorityFeeLamports(
      computeUnitLimit,
      computeUnitPriceMicroLamports
    );
    const networkFeeLamports = baseFeeLamports + priorityLamports;
    const recommendedAtIso = new Date().toISOString();
    const response: FilingFeeEstimateResponse = {
      payerWallet,
      recommendedAtIso,
      staleAfterSec: Math.max(10, this.config.paymentEstimateCacheSec),
      breakdown: {
        filingFeeLamports: this.config.filingFeeLamports,
        baseFeeLamports,
        computeUnitLimit,
        computeUnitPriceMicroLamports,
        priorityFeeLamports: priorityLamports,
        networkFeeLamports,
        totalEstimatedLamports: this.config.filingFeeLamports + networkFeeLamports
      },
      recommendation: {
        rpcUrl: this.config.heliusRpcUrl || this.config.solanaRpcUrl,
        treasuryAddress: this.config.treasuryAddress,
        recentBlockhash,
        lastValidBlockHeight,
        computeUnitLimit,
        computeUnitPriceMicroLamports
      }
    };

    const ttlMs = this.config.paymentEstimateCacheSec * 1000;
    if (ttlMs > 0) {
      this.cache.set(cacheKey, {
        expiresAtMs: nowMs + ttlMs,
        value: response
      });
    }

    return response;
  }
}

export function createPaymentEstimator(config: AppConfig): PaymentEstimator {
  if (config.solanaMode === "rpc") {
    return new RpcPaymentEstimator(config);
  }
  return new StubPaymentEstimator(config);
}
