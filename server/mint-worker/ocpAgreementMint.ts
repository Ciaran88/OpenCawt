/**
 * OCP Agreement NFT Minting
 *
 * Adapts an OcpMintRequest into the metaplex_nft pipeline by building
 * OCP-specific NFT metadata and delegating to mintWithMetaplexNft and
 * uploadReceiptMetadata (shared with court seals).
 *
 * NFT spec:
 *   name:    "OCP Agreement: {agreementCode}"   (≤ 32 chars — always fits)
 *   symbol:  "OCAWT"
 *   attributes: agreement_code, terms_hash, party_a, party_b, mode, sealed_at
 */

import type { OcpMintRequest, WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import type { MintWorkerConfig } from "./workerConfig";
import { ensureSealImageUri } from "./metadataUpload";
import { WorkerMintError } from "./errors";
import { mintWithMetaplexNft } from "./metaplexNftMint";

// ── Metadata helpers ──────────────────────────────────────────────────────────

function buildOcpAttributes(
  request: OcpMintRequest,
  sealedAtIso: string
): Array<{ trait_type: string; value: string }> {
  return [
    { trait_type: "agreement_code", value: request.agreementCode },
    { trait_type: "terms_hash",     value: request.termsHash },
    { trait_type: "party_a",        value: request.partyAAgentId },
    { trait_type: "party_b",        value: request.partyBAgentId },
    { trait_type: "mode",           value: request.mode },
    { trait_type: "sealed_at",      value: sealedAtIso },
  ];
}

function buildOcpMetadataJson(
  request: OcpMintRequest,
  imageUri: string,
  sealedAtIso: string
): Record<string, unknown> {
  return {
    name:         `OCP Agreement: ${request.agreementCode}`,
    symbol:       "OCAWT",
    description:  "This OCP sealed receipt is a Metaplex NFT anchoring the cryptographic hash of a two-party agreement notarised via OpenCawt Protocol. Use the OCP public record to verify integrity.",
    image:        imageUri,
    external_url: request.externalUrl,
    agreement_code: request.agreementCode,
    proposal_id:    request.proposalId,
    terms_hash:     request.termsHash,
    party_a:        request.partyAAgentId,
    party_b:        request.partyBAgentId,
    mode:           request.mode,
    sealed_at:      sealedAtIso,
    attributes:     buildOcpAttributes(request, sealedAtIso),
    properties: {
      category: "image",
      files: [{ uri: imageUri, type: "image/png" }],
    },
  };
}

function ensureAbsoluteHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkerMintError({
      code: "INVALID_EXTERNAL_URL",
      message: "OCP metadata external_url must be an absolute URL.",
      retryable: false
    });
  }
  if (parsed.protocol !== "https:") {
    throw new WorkerMintError({
      code: "INVALID_EXTERNAL_URL_SCHEME",
      message: "OCP metadata external_url must use https.",
      retryable: false
    });
  }
  return parsed.toString();
}

// ── Pinata upload for OCP metadata ───────────────────────────────────────────

async function uploadOcpMetadata(
  config: MintWorkerConfig,
  request: OcpMintRequest,
  sealedAtIso: string
): Promise<string> {
  if (request.metadataUri) {
    return request.metadataUri;
  }

  if (!config.pinataJwt) {
    throw new Error("PINATA_JWT is required for OCP metadata upload.");
  }

  const imageUri = await ensureSealImageUri(config);
  const metadata = buildOcpMetadataJson(
    { ...request, externalUrl: ensureAbsoluteHttpsUrl(request.externalUrl) },
    imageUri,
    sealedAtIso
  );

  interface PinataJsonResponse { IpfsHash: string }

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.externalAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.externalTimeoutMs);
    try {
      const response = await fetch(
        `${config.pinataApiBase.replace(/\/$/, "")}/pinning/pinJSONToIPFS`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.pinataJwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metadata),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`PINATA_HTTP_${response.status}:${text.slice(0, 220)}`);
      }

      const result = (await response.json()) as PinataJsonResponse;
      const cid = result.IpfsHash;
      if (config.pinataGatewayBase) {
        return `${config.pinataGatewayBase.replace(/\/$/, "")}/ipfs/${cid}`;
      }
      return `ipfs://${cid}`;
    } catch (err) {
      lastError = err;
      if (attempt < config.externalAttempts) {
        const backoff = config.externalBaseDelayMs * attempt;
        const jitter = Math.floor(Math.random() * 140);
        await new Promise((r) => setTimeout(r, backoff + jitter));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`OCP metadata upload failed after retries: ${String(lastError)}`);
}

// ── Adapter shim: OcpMintRequest → WorkerSealRequest ─────────────────────────
//
// mintWithMetaplexNft() reads: jobId, caseId, metadataUri, externalUrl.
// We provide these from OcpMintRequest fields; the court-specific fields
// (verdictHash, drandRound, etc.) are never accessed during the NFT mint path
// — they are only used by uploadReceiptMetadata / buildMetadataJson which we
// bypass entirely (we call uploadOcpMetadata ourselves and pass metadataUri).

function toSealRequestShim(
  request: OcpMintRequest,
  metadataUri: string
): WorkerSealRequest {
  return {
    requestType:             "court_case",   // satisfies discriminant
    jobId:                   request.jobId,
    caseId:                  request.agreementCode,  // used only for NFT name in buildName()
    verdictHash:             request.termsHash,      // not read in metaplex path
    transcriptRootHash:      "",
    jurySelectionProofHash:  "",
    rulesetVersion:          "ocp-v1",
    drandRound:              0,
    drandRandomness:         "",
    jurorPoolSnapshotHash:   "",
    outcome:                 "for_prosecution",      // not read in metaplex path
    decidedAtIso:            request.sealedAtIso,
    externalUrl:             request.externalUrl,
    verdictUri:              request.externalUrl,
    metadataUri,                                     // <-- already uploaded; skips Pinata in mintWithMetaplexNft
    metadata:                { caseSummary: "", imagePath: "" },
  };
}

// ── Stub response ─────────────────────────────────────────────────────────────

function createOcpStubResponse(request: OcpMintRequest): WorkerSealResponse {
  return {
    jobId:       request.jobId,
    caseId:      request.agreementCode,
    assetId:     `STUB_ASSET_${request.agreementCode}`,
    txSig:       `STUB_TX_${request.proposalId}`,
    sealedUri:   request.externalUrl,
    metadataUri: `${request.externalUrl}#metadata`,
    sealedAtIso: new Date().toISOString(),
    status:      "minted",
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function mintOcpAgreement(
  config: MintWorkerConfig,
  request: OcpMintRequest
): Promise<WorkerSealResponse> {
  if (config.mode === "stub") {
    return createOcpStubResponse(request);
  }

  // 1. Upload OCP-specific metadata to Pinata (gets metadataUri)
  const sealedAtIso = new Date().toISOString();
  const metadataUri = await uploadOcpMetadata(config, request, sealedAtIso);

  // 2. Delegate to the shared metaplex_nft minting function via adapter shim.
  //    The shim passes metadataUri so mintWithMetaplexNft skips the second
  //    metadata upload (it checks request.metadataUri first).
  const shim = toSealRequestShim(request, metadataUri);
  const result = await mintWithMetaplexNft(config, shim);

  // 3. Normalise the response back to OCP terms.
  if (result.status === "minted") {
    return {
      jobId:       request.jobId,
      caseId:      request.agreementCode,
      assetId:     result.assetId,
      txSig:       result.txSig,
      sealedUri:   result.sealedUri,
      metadataUri: result.metadataUri,
      sealedAtIso: result.sealedAtIso,
      status:      "minted",
    };
  }

  // Failed response — propagate
  return {
    jobId:        request.jobId,
    caseId:       request.agreementCode,
    status:       "failed",
    errorCode:    result.errorCode,
    errorMessage: result.errorMessage,
    metadataUri:  result.metadataUri,
  };
}
