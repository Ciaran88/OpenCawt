import type { Db } from "../db/sqlite";
import type { OcpConfig } from "../config";
import { updateReceiptMint } from "../db/repository";
import { createOcpId } from "../ids";
import type { OcpMintRequest, WorkerSealResponse } from "../../../shared/contracts";

export interface MintReceiptInput {
  proposalId: string;
  agreementCode: string;
  termsHash: string;
  partyAAgentId: string;
  partyBAgentId: string;
  mode: "public" | "private";
  sealedAtIso: string;
}

export interface MintReceiptResult {
  mintAddress: string;
  txSig: string;
  metadataUri: string;
  mintStatus: "stub" | "minted" | "failed";
}

// ── Mint worker HTTP client ───────────────────────────────────────────────────

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST an OcpMintRequest to the mint worker with up to 3 attempts.
 * Returns the parsed WorkerSealResponse on success.
 * Throws on all-attempts failure.
 */
async function postToMintWorker(
  config: OcpConfig,
  req: OcpMintRequest
): Promise<WorkerSealResponse> {
  const url = `${config.mintWorkerUrl.replace(/\/$/, "")}/mint`;
  const body = JSON.stringify(req);

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Token": config.mintWorkerToken,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`MINT_WORKER_HTTP_${response.status}:${text.slice(0, 300)}`);
      }

      return (await response.json()) as WorkerSealResponse;
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        await wait(500 * attempt); // 500 ms, then 1000 ms
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`OCP mint worker unreachable after 3 attempts: ${String(lastError)}`);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Mint an NFT receipt for a sealed agreement.
 *
 * Modes:
 *   OCP_SOLANA_MODE=stub  — returns deterministic stub data (default, safe for dev/test).
 *   OCP_SOLANA_MODE=rpc   — calls the OpenCawt mint worker via HTTP, which mints a real
 *                           Metaplex standard NFT on Solana via Helius RPC.
 *
 * Idempotent per proposalId — safe to call multiple times.
 */
export async function mintAgreementReceipt(
  db: Db,
  config: OcpConfig,
  input: MintReceiptInput
): Promise<MintReceiptResult> {
  // ── Stub path ────────────────────────────────────────────────────────────────
  if (config.solanaMode === "stub") {
    const result: MintReceiptResult = {
      mintAddress: `STUB_MINT_${input.agreementCode}`,
      txSig: `STUB_TX_${input.proposalId}`,
      metadataUri: `${config.publicBaseUrl}/v1/agreements/by-code/${input.agreementCode}`,
      mintStatus: "stub",
    };

    updateReceiptMint(db, input.proposalId, {
      mintAddress: result.mintAddress,
      txSig: result.txSig,
      metadataUri: result.metadataUri,
      mintStatus: "stub",
    });

    console.log(
      `[OCP MINT STUB] Would mint NFT for agreement ${input.agreementCode}`,
      {
        proposalId: input.proposalId,
        termsHash: input.termsHash,
        partyA: input.partyAAgentId,
        partyB: input.partyBAgentId,
        mode: input.mode,
        sealedAtIso: input.sealedAtIso,
      }
    );

    return result;
  }

  // ── RPC path — call the OpenCawt mint worker ─────────────────────────────────
  const mintReq: OcpMintRequest = {
    requestType:   "ocp_agreement",
    jobId:         createOcpId("mjob"),
    agreementCode: input.agreementCode,
    proposalId:    input.proposalId,
    termsHash:     input.termsHash,
    partyAAgentId: input.partyAAgentId,
    partyBAgentId: input.partyBAgentId,
    mode:          input.mode,
    sealedAtIso:   input.sealedAtIso,
    externalUrl:   `${config.publicBaseUrl}/v1/agreements/by-code/${input.agreementCode}`,
  };

  let workerResponse: WorkerSealResponse;
  try {
    workerResponse = await postToMintWorker(config, mintReq);
  } catch (err) {
    // Log and persist failure — don't block agreement sealing
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[OCP MINT] Mint worker error for ${input.agreementCode}:`, errMsg);

    updateReceiptMint(db, input.proposalId, {
      mintAddress: "",
      txSig: "",
      metadataUri: "",
      mintStatus: "failed",
      mintError: errMsg,
    });

    return { mintAddress: "", txSig: "", metadataUri: "", mintStatus: "failed" };
  }

  if (workerResponse.status === "minted") {
    const result: MintReceiptResult = {
      mintAddress: workerResponse.assetId ?? "",
      txSig:       workerResponse.txSig ?? "",
      metadataUri: workerResponse.metadataUri ?? "",
      mintStatus:  "minted",
    };

    updateReceiptMint(db, input.proposalId, {
      mintAddress: result.mintAddress,
      txSig:       result.txSig,
      metadataUri: result.metadataUri,
      mintStatus:  "minted",
    });

    console.log(`[OCP MINT] Minted NFT for agreement ${input.agreementCode}:`, {
      assetId:     result.mintAddress,
      txSig:       result.txSig,
      metadataUri: result.metadataUri,
    });

    return result;
  }

  // Worker returned status: "failed"
  const errCode    = workerResponse.errorCode    ?? "MINT_FAILED";
  const errMessage = workerResponse.errorMessage ?? "Unknown mint error";
  console.error(`[OCP MINT] Mint worker reported failure for ${input.agreementCode}:`, {
    errorCode:    errCode,
    errorMessage: errMessage,
  });

  updateReceiptMint(db, input.proposalId, {
    mintAddress: "",
    txSig: "",
    metadataUri: workerResponse.metadataUri ?? "",
    mintStatus: "failed",
    mintError: `${errCode}: ${errMessage}`,
  });

  return {
    mintAddress: "",
    txSig: "",
    metadataUri: workerResponse.metadataUri ?? "",
    mintStatus: "failed",
  };
}
