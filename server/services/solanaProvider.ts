import type { AppConfig } from "../config";
import { createHeliusClient } from "./heliusClient";
import { ApiError, badRequest } from "./errors";

export interface SolanaVerificationResult {
  txSig: string;
  recipient: string;
  amountLamports: number;
  finalised: boolean;
  payerWallet?: string;
}

export interface SolanaProvider {
  verifyFilingFeeTx(
    txSig: string,
    expectedPayerWallet?: string
  ): Promise<SolanaVerificationResult>;
}

class StubSolanaProvider implements SolanaProvider {
  constructor(private readonly config: AppConfig) {}

  async verifyFilingFeeTx(
    txSig: string,
    expectedPayerWallet?: string
  ): Promise<SolanaVerificationResult> {
    const amountLamports = this.config.filingFeeLamports + 1000;
    return {
      txSig,
      recipient: this.config.treasuryAddress,
      amountLamports,
      finalised: true,
      payerWallet: expectedPayerWallet ?? "stub_payer_wallet"
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

function readSignerInfo(
  value: unknown
): {
  pubkey: string | null;
  signer: boolean;
} {
  if (typeof value === "string") {
    return {
      pubkey: value,
      signer: false
    };
  }
  if (!value || typeof value !== "object") {
    return {
      pubkey: null,
      signer: false
    };
  }

  const candidate = value as Record<string, unknown>;
  return {
    pubkey: readKeyPubkey(value),
    signer: candidate.signer === true
  };
}

class RpcSolanaProvider implements SolanaProvider {
  private readonly helius;

  constructor(private readonly config: AppConfig) {
    this.helius = createHeliusClient(config);
  }

  async verifyFilingFeeTx(
    txSig: string,
    expectedPayerWallet?: string
  ): Promise<SolanaVerificationResult> {
    let result: Record<string, unknown> | null;
    try {
      result = await this.helius.getTransaction(txSig);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "EXTERNAL_DNS_FAILURE") {
          throw badRequest(
            "HELIUS_RPC_DNS_FAILURE",
            "Unable to resolve Helius RPC host during treasury verification.",
            error.details
          );
        }
        if (error.code === "EXTERNAL_TIMEOUT") {
          throw badRequest(
            "HELIUS_RPC_TIMEOUT",
            "Timed out while contacting Helius RPC during treasury verification.",
            error.details
          );
        }
        if (error.code.startsWith("EXTERNAL_")) {
          throw badRequest(
            "HELIUS_RPC_ERROR",
            "Helius RPC verification call failed.",
            {
              upstreamCode: error.code,
              ...(error.details ?? {})
            }
          );
        }
      }
      throw error;
    }
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
    const accountKeys = accountKeysRaw.map((value) => readSignerInfo(value));

    let amountLamports = 0;
    for (let index = 0; index < accountKeys.length; index += 1) {
      const key = accountKeys[index].pubkey;
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

    const payerWallet =
      accountKeys.find((item) => item.signer && item.pubkey)?.pubkey ??
      accountKeys.find((item) => item.pubkey)?.pubkey ??
      undefined;
    if (expectedPayerWallet && payerWallet && expectedPayerWallet !== payerWallet) {
      throw badRequest(
        "PAYER_WALLET_MISMATCH",
        "Treasury transaction payer wallet does not match the supplied payer wallet.",
        {
          expectedPayerWallet,
          observedPayerWallet: payerWallet
        }
      );
    }

    return {
      txSig,
      recipient: this.config.treasuryAddress,
      amountLamports,
      finalised: true,
      payerWallet
    };
  }
}

export function createSolanaProvider(config: AppConfig): SolanaProvider {
  if (config.solanaMode === "rpc") {
    return new RpcSolanaProvider(config);
  }
  return new StubSolanaProvider(config);
}
