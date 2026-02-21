/**
 * OCP Solana payment verifier.
 *
 * Mirrors the main app's `server/services/solanaProvider.ts` but uses OcpConfig
 * directly. Verifies that a Solana transaction transferred at least the minting
 * fee to the treasury address.
 */
import type { OcpConfig } from "../config";
import type { OcpHeliusClient } from "./ocpHeliusClient";

export interface OcpSolanaVerificationResult {
  txSig: string;
  recipient: string;
  amountLamports: number;
  finalised: boolean;
  payerWallet?: string;
}

export interface OcpSolanaVerifier {
  verifyMintingFeeTx(
    txSig: string,
    expectedPayerWallet?: string
  ): Promise<OcpSolanaVerificationResult>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readKeyPubkey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.pubkey === "string") return candidate.pubkey;
  if (typeof candidate === "string") return candidate;
  return null;
}

function readSignerInfo(value: unknown): { pubkey: string | null; signer: boolean } {
  if (typeof value === "string") {
    return { pubkey: value, signer: false };
  }
  if (!value || typeof value !== "object") {
    return { pubkey: null, signer: false };
  }
  const candidate = value as Record<string, unknown>;
  return {
    pubkey: readKeyPubkey(value),
    signer: candidate.signer === true,
  };
}

// ── Stub ─────────────────────────────────────────────────────────────────────

class StubOcpSolanaVerifier implements OcpSolanaVerifier {
  constructor(private readonly config: OcpConfig) {}

  async verifyMintingFeeTx(
    txSig: string,
    expectedPayerWallet?: string
  ): Promise<OcpSolanaVerificationResult> {
    return {
      txSig,
      recipient: this.config.treasuryAddress,
      amountLamports: this.config.mintingFeeLamports + 1000,
      finalised: true,
      payerWallet: expectedPayerWallet ?? "stub_payer_wallet",
    };
  }
}

// ── RPC ──────────────────────────────────────────────────────────────────────

class RpcOcpSolanaVerifier implements OcpSolanaVerifier {
  constructor(
    private readonly config: OcpConfig,
    private readonly helius: OcpHeliusClient
  ) {}

  async verifyMintingFeeTx(
    txSig: string,
    expectedPayerWallet?: string
  ): Promise<OcpSolanaVerificationResult> {
    const result = await this.helius.getTransaction(txSig);
    if (!result) {
      throw new Error("SOLANA_TX_NOT_FOUND: Treasury transaction was not found at finalised commitment.");
    }

    const meta = (result.meta as Record<string, unknown> | undefined) ?? {};
    if (meta.err) {
      throw new Error(`SOLANA_TX_FAILED: Treasury transaction failed on-chain: ${JSON.stringify(meta.err)}`);
    }

    const transaction = (result.transaction as Record<string, unknown> | undefined) ?? {};
    const message = (transaction.message as Record<string, unknown> | undefined) ?? {};

    const accountKeysRaw = (message.accountKeys as unknown[] | undefined) ?? [];
    const preBalances = (meta.preBalances as number[] | undefined) ?? [];
    const postBalances = (meta.postBalances as number[] | undefined) ?? [];
    const accountKeys = accountKeysRaw.map((value) => readSignerInfo(value));

    // Find treasury account and calculate balance delta
    let amountLamports = 0;
    for (let index = 0; index < accountKeys.length; index++) {
      const key = accountKeys[index].pubkey;
      if (key !== this.config.treasuryAddress) continue;
      const pre = Number(preBalances[index] ?? 0);
      const post = Number(postBalances[index] ?? 0);
      const delta = post - pre;
      if (Number.isFinite(delta) && delta > amountLamports) {
        amountLamports = delta;
      }
    }

    if (amountLamports <= 0) {
      throw new Error("TREASURY_MISMATCH: Transaction does not increase the treasury account balance.");
    }

    if (amountLamports < this.config.mintingFeeLamports) {
      throw new Error(
        `FEE_TOO_LOW: Transaction amount ${amountLamports} lamports is below required minting fee ${this.config.mintingFeeLamports} lamports.`
      );
    }

    // Extract payer wallet
    const payerWallet =
      accountKeys.find((item) => item.signer && item.pubkey)?.pubkey ??
      accountKeys.find((item) => item.pubkey)?.pubkey ??
      undefined;

    if (expectedPayerWallet && payerWallet && expectedPayerWallet !== payerWallet) {
      throw new Error(
        `PAYER_WALLET_MISMATCH: Expected payer ${expectedPayerWallet} but observed ${payerWallet}.`
      );
    }

    return {
      txSig,
      recipient: this.config.treasuryAddress,
      amountLamports,
      finalised: true,
      payerWallet,
    };
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createOcpSolanaVerifier(config: OcpConfig, helius: OcpHeliusClient): OcpSolanaVerifier {
  if (config.solanaMode === "rpc") {
    return new RpcOcpSolanaVerifier(config, helius);
  }
  return new StubOcpSolanaVerifier(config);
}
