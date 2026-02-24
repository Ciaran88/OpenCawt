import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkerSealRequest } from "../../shared/contracts";
import type { MintWorkerConfig } from "./workerConfig";
import { WorkerMintError } from "./errors";

interface PinataJsonResponse {
  IpfsHash: string;
}

let cachedSealImageUri: string | null = null;

async function wait(ms: number): Promise<void> {
  await new Promise((resolveNow) => setTimeout(resolveNow, ms));
}

function pinataGateway(config: MintWorkerConfig, cid: string): string {
  if (config.pinataGatewayBase) {
    return `${config.pinataGatewayBase.replace(/\/$/, "")}/ipfs/${cid}`;
  }
  return `ipfs://${cid}`;
}

function buildAttributes(request: WorkerSealRequest, sealedAtIso: string): Array<{ trait_type: string; value: string }> {
  return [
    { trait_type: "case_id", value: request.caseId },
    { trait_type: "verdict_hash", value: request.verdictHash },
    { trait_type: "transcript_root_hash", value: request.transcriptRootHash },
    { trait_type: "ruleset_version", value: request.rulesetVersion },
    { trait_type: "drand_round", value: String(request.drandRound) },
    { trait_type: "drand_randomness", value: request.drandRandomness },
    { trait_type: "juror_pool_snapshot_hash", value: request.jurorPoolSnapshotHash },
    { trait_type: "jury_selection_proof_hash", value: request.jurySelectionProofHash },
    { trait_type: "outcome", value: request.outcome },
    { trait_type: "decided_at", value: request.decidedAtIso },
    { trait_type: "sealed_at", value: sealedAtIso }
  ];
}

function buildMetadataJson(
  request: WorkerSealRequest,
  imageUri: string,
  sealedAtIso: string
): Record<string, unknown> {
  return {
    name: `OpenCawt Seal: Case ${request.caseId}`,
    symbol: "OCAWT",
    description:
      "This OpenCawt sealed receipt is a minimal cNFT that anchors cryptographic hashes of the case decision. It does not contain the full transcript. Use OpenCawt public records to verify integrity.",
    image: imageUri,
    external_url: request.externalUrl,
    case_id: request.caseId,
    verdict_hash: request.verdictHash,
    transcript_root_hash: request.transcriptRootHash,
    ruleset_version: request.rulesetVersion,
    drand_round: request.drandRound,
    drand_randomness: request.drandRandomness,
    juror_pool_snapshot_hash: request.jurorPoolSnapshotHash,
    jury_selection_proof_hash: request.jurySelectionProofHash,
    outcome: request.outcome,
    decided_at: request.decidedAtIso,
    sealed_at: sealedAtIso,
    attributes: buildAttributes(request, sealedAtIso),
    properties: {
      category: "image",
      files: [
        {
          uri: imageUri,
          type: "image/png"
        }
      ]
    }
  };
}

function ensureAbsoluteHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkerMintError({
      code: "INVALID_EXTERNAL_URL",
      message: "Seal metadata external_url must be an absolute URL.",
      retryable: false
    });
  }
  if (parsed.protocol !== "https:") {
    throw new WorkerMintError({
      code: "INVALID_EXTERNAL_URL_SCHEME",
      message: "Seal metadata external_url must use https.",
      retryable: false
    });
  }
  return parsed.toString();
}

async function pinataRequest<T>(
  config: MintWorkerConfig,
  endpoint: string,
  init: RequestInit
): Promise<T> {
  if (!config.pinataJwt) {
    throw new Error("PINATA_JWT is required for metadata upload.");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.externalAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.externalTimeoutMs);
    try {
      const response = await fetch(`${config.pinataApiBase.replace(/\/$/, "")}${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.pinataJwt}`,
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 403 && text.includes("FORBIDDEN")) {
          throw new WorkerMintError({
            code: "PINATA_QUOTA_EXCEEDED",
            message: `pinata quota exceeded at ${endpoint}: ${text.slice(0, 220)}`,
            retryable: false
          });
        }
        throw new WorkerMintError({
          code: response.status >= 500 ? "PINATA_HTTP_5XX" : "PINATA_HTTP_4XX",
          message: `pinata http ${response.status} at ${endpoint}: ${text.slice(0, 220)}`,
          retryable: response.status >= 500 || response.status === 429
        });
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      const workerError =
        error instanceof WorkerMintError
          ? error
          : toPinataWorkerError(error, endpoint);
      lastError = workerError;
      if (workerError.retryable && attempt < config.externalAttempts) {
        const backoff = config.externalBaseDelayMs * attempt;
        const jitter = Math.floor(Math.random() * 140);
        await wait(backoff + jitter);
      } else if (!(error instanceof WorkerMintError)) {
        throw workerError;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof WorkerMintError) {
    throw lastError;
  }
  throw new WorkerMintError({
    code: "PINATA_REQUEST_FAILED",
    message: `Pinata upload failed after retries at ${endpoint}: ${String(lastError)}`,
    retryable: false
  });
}

function toPinataWorkerError(error: unknown, endpoint: string): WorkerMintError {
  const err = error as Error & { cause?: { code?: string } };
  const message = err.message ?? String(error);
  const causeCode = err.cause?.code ?? "";
  if (message.includes("AbortError")) {
    return new WorkerMintError({
      code: "PINATA_TIMEOUT",
      message: `pinata timeout at ${endpoint}`,
      retryable: true
    });
  }
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") {
    return new WorkerMintError({
      code: "PINATA_DNS_FAILURE",
      message: `pinata dns failure at ${endpoint}`,
      retryable: true
    });
  }
  return new WorkerMintError({
    code: "PINATA_NETWORK_FAILURE",
    message: `pinata network failure at ${endpoint}: ${message}`,
    retryable: true
  });
}

export async function ensureSealImageUri(config: MintWorkerConfig): Promise<string> {
  if (cachedSealImageUri) {
    return cachedSealImageUri;
  }

  const imagePath = resolve(process.cwd(), "nft_seal.png");
  const imageBuffer = await readFile(imagePath);
  const form = new FormData();
  form.append("file", new Blob([imageBuffer], { type: "image/png" }), "nft_seal.png");

  const result = await pinataRequest<PinataJsonResponse>(config, "/pinning/pinFileToIPFS", {
    method: "POST",
    body: form
  });

  cachedSealImageUri = pinataGateway(config, result.IpfsHash);
  return cachedSealImageUri;
}

export async function uploadReceiptMetadata(
  config: MintWorkerConfig,
  request: WorkerSealRequest,
  sealedAtIso: string
): Promise<string> {
  if (request.metadataUri) {
    return request.metadataUri;
  }
  const imageUri = await ensureSealImageUri(config);
  const metadata = buildMetadataJson(
    {
      ...request,
      externalUrl: ensureAbsoluteHttpsUrl(request.externalUrl)
    },
    imageUri,
    sealedAtIso
  );

  const result = await pinataRequest<PinataJsonResponse>(config, "/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(metadata)
  });

  return pinataGateway(config, result.IpfsHash);
}
