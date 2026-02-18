import type { WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import { resolveAssetById } from "./dasResolver";
import { WorkerMintError } from "./errors";
import { uploadReceiptMetadata } from "./metadataUpload";
import { mintWithBubblegumLocalSigning } from "./bubblegumLocalMint";
import type { MintWorkerConfig } from "./workerConfig";

interface BubblegumMintResponse {
  txSig: string;
  assetId: string;
  sealedUri?: string;
  metadataUri?: string;
  sealedAtIso?: string;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postMintRequest(
  config: MintWorkerConfig,
  request: WorkerSealRequest,
  metadataUri: string
): Promise<BubblegumMintResponse> {
  if (!config.bubblegumMintEndpoint) {
    throw new Error(
      "BUBBLEGUM_MINT_ENDPOINT is required when MINT_SIGNING_STRATEGY=external_endpoint."
    );
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.externalAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.externalTimeoutMs);

    try {
      const response = await fetch(config.bubblegumMintEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          caseId: request.caseId,
          verdictHash: request.verdictHash,
          transcriptRootHash: request.transcriptRootHash,
          jurySelectionProofHash: request.jurySelectionProofHash,
          rulesetVersion: request.rulesetVersion,
          drandRound: request.drandRound,
          drandRandomness: request.drandRandomness,
          jurorPoolSnapshotHash: request.jurorPoolSnapshotHash,
          outcome: request.outcome,
          decidedAtIso: request.decidedAtIso,
          externalUrl: request.externalUrl,
          metadataUri
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Mint endpoint HTTP ${response.status}`);
      }

      const json = (await response.json()) as BubblegumMintResponse;
      if (!json.txSig || !json.assetId) {
        throw new Error("Mint endpoint response missing txSig or assetId.");
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < config.externalAttempts) {
        const jitter = Math.floor(Math.random() * 120);
        await wait(config.externalBaseDelayMs * attempt + jitter);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Mint request failed after retries: ${String(lastError)}`);
}

export async function mintWithBubblegumV2(
  config: MintWorkerConfig,
  request: WorkerSealRequest
): Promise<WorkerSealResponse> {
  const sealedAtIso = new Date().toISOString();
  let metadataUri = request.metadataUri;
  try {
    metadataUri = metadataUri ?? (await uploadReceiptMetadata(config, request, sealedAtIso));
    if (!metadataUri) {
      throw new WorkerMintError({
        code: "METADATA_URI_MISSING",
        message: "Metadata URI missing for seal mint."
      });
    }

    if (config.mintSigningStrategy === "local_signing") {
      return mintWithBubblegumLocalSigning(config, request, metadataUri, sealedAtIso);
    }

    const minted = await postMintRequest(config, request, metadataUri);

    const resolved = await resolveAssetById(config, minted.assetId);
    const sealedUri =
      minted.sealedUri ||
      minted.metadataUri ||
      (resolved.asset.content as { json_uri?: string } | undefined)?.json_uri ||
      metadataUri;

    return {
      jobId: request.jobId,
      caseId: request.caseId,
      assetId: resolved.assetId,
      txSig: minted.txSig,
      sealedUri,
      metadataUri,
      sealedAtIso: minted.sealedAtIso ?? sealedAtIso,
      status: "minted"
    };
  } catch (error) {
    if (error instanceof WorkerMintError) {
      throw new WorkerMintError({
        code: error.code,
        message: error.message,
        metadataUri: metadataUri ?? error.metadataUri,
        retryable: error.retryable
      });
    }
    throw new WorkerMintError({
      code: "MINT_FAILED",
      message: error instanceof Error ? error.message : String(error),
      metadataUri,
      retryable: true
    });
  }
}
