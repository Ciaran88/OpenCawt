import type { AppConfig } from "../config";
import { createHeliusClient } from "./heliusClient";
import { badRequest } from "./errors";

export interface SolanaVerificationResult {
  txSig: string;
  recipient: string;
  amountLamports: number;
  finalised: boolean;
}

export interface SolanaProvider {
  verifyFilingFeeTx(txSig: string): Promise<SolanaVerificationResult>;
}

class StubSolanaProvider implements SolanaProvider {
  constructor(private readonly config: AppConfig) {}

  async verifyFilingFeeTx(txSig: string): Promise<SolanaVerificationResult> {
    const amountLamports = this.config.filingFeeLamports + 1000;
    return {
      txSig,
      recipient: this.config.treasuryAddress,
      amountLamports,
      finalised: true
    };
  }
}

function readKeyPubkey(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.pubkey === "string") {
    return candidate.pubkey;
  }
  if (typeof candidate === "string") {
    return candidate;
  }
  return null;
}

class RpcSolanaProvider implements SolanaProvider {
  private readonly helius;

  constructor(private readonly config: AppConfig) {
    this.helius = createHeliusClient(config);
  }

  async verifyFilingFeeTx(txSig: string): Promise<SolanaVerificationResult> {
    const result = await this.helius.getTransaction(txSig);
    if (!result) {
      throw badRequest(
        "SOLANA_TX_NOT_FOUND",
        "Treasury transaction was not found at finalised commitment."
      );
    }

    const meta = (result.meta as Record<string, unknown> | undefined) ?? {};
    if (meta.err) {
      throw badRequest("SOLANA_TX_FAILED", "Treasury transaction failed on-chain.", {
        err: meta.err
      });
    }

    const transaction = (result.transaction as Record<string, unknown> | undefined) ?? {};
    const message = (transaction.message as Record<string, unknown> | undefined) ?? {};

    const accountKeysRaw = (message.accountKeys as unknown[] | undefined) ?? [];
    const preBalances = (meta.preBalances as number[] | undefined) ?? [];
    const postBalances = (meta.postBalances as number[] | undefined) ?? [];

    let amountLamports = 0;
    for (let index = 0; index < accountKeysRaw.length; index += 1) {
      const key = readKeyPubkey(accountKeysRaw[index]);
      if (key !== this.config.treasuryAddress) {
        continue;
      }
      const pre = Number(preBalances[index] ?? 0);
      const post = Number(postBalances[index] ?? 0);
      const delta = post - pre;
      if (Number.isFinite(delta) && delta > amountLamports) {
        amountLamports = delta;
      }
    }

    if (amountLamports <= 0) {
      throw badRequest(
        "TREASURY_MISMATCH",
        "Transaction does not increase the treasury account balance."
      );
    }

    if (amountLamports < this.config.filingFeeLamports) {
      throw badRequest("FEE_TOO_LOW", "Transaction amount is below required filing fee.", {
        requiredLamports: this.config.filingFeeLamports,
        receivedLamports: amountLamports
      });
    }

    return {
      txSig,
      recipient: this.config.treasuryAddress,
      amountLamports,
      finalised: true
    };
  }
}

export function createSolanaProvider(config: AppConfig): SolanaProvider {
  if (config.solanaMode === "rpc") {
    return new RpcSolanaProvider(config);
  }
  return new StubSolanaProvider(config);
}
