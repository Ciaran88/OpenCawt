import type { WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import { resolveAssetById } from "./dasResolver";
import type { MintWorkerConfig } from "./workerConfig";

interface BubblegumMintResponse {
  txSig: string;
  assetId: string;
  sealedUri?: string;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postMintRequest(
  config: MintWorkerConfig,
  request: WorkerSealRequest
): Promise<BubblegumMintResponse> {
  if (!config.bubblegumMintEndpoint) {
    throw new Error("BUBBLEGUM_MINT_ENDPOINT is required when MINT_WORKER_MODE=bubblegum_v2.");
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
          verdictUri: request.verdictUri,
          metadata: request.metadata
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
  const minted = await postMintRequest(config, request);

  const resolved = await resolveAssetById(config, minted.assetId);
  const sealedUri =
    minted.sealedUri ||
    (resolved.asset.content as { json_uri?: string } | undefined)?.json_uri ||
    `${request.verdictUri}/sealed`;

  return {
    jobId: request.jobId,
    caseId: request.caseId,
    assetId: resolved.assetId,
    txSig: minted.txSig,
    sealedUri,
    status: "minted"
  };
}
