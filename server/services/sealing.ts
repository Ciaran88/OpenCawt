import type { WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import { canonicalHashHex } from "../../shared/hash";
import { createId } from "../../shared/ids";
import type { AppConfig } from "../config";
import {
  appendTranscriptEvent,
  claimSealJob,
  createSealJobIfMissing,
  getSealJobByJobId,
  markCaseSealed,
  markSealJobFailed,
  markSealJobResult,
  setCaseSealState,
  type CaseRecord
} from "../db/repository";
import type { Db } from "../db/sqlite";
import { badRequest } from "./errors";

function createStubSealResponse(request: WorkerSealRequest): WorkerSealResponse {
  const suffix = request.caseId.replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  const sealedAtIso = new Date().toISOString();
  return {
    jobId: request.jobId,
    caseId: request.caseId,
    assetId: `asset_${suffix}_${Date.now().toString(36)}`,
    txSig: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    sealedUri: request.externalUrl,
    metadataUri: `${request.externalUrl}#metadata`,
    sealedAtIso,
    status: "minted"
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWorkerMint(
  config: AppConfig,
  request: WorkerSealRequest,
  mode: "enqueue" | "retry"
): Promise<WorkerSealResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.retry.external.attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.retry.external.timeoutMs);
    try {
      const response = await fetch(`${config.sealWorkerUrl.replace(/\/$/, "")}/mint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Token": config.workerToken,
          "X-OpenCawt-Seal-Mode": mode
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`SEAL_WORKER_HTTP_${response.status}`);
      }

      return (await response.json()) as WorkerSealResponse;
    } catch (error) {
      lastError = error;
      if (attempt < config.retry.external.attempts) {
        const backoff = config.retry.external.baseDelayMs * attempt;
        const jitter = Math.floor(Math.random() * 160);
        await wait(backoff + jitter);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`SEAL_WORKER_ERROR:${String(lastError)}`);
}

function buildWorkerSealRequest(caseRecord: CaseRecord): WorkerSealRequest {
  if (!caseRecord.verdictHash) {
    throw new Error("SEAL_VERDICT_HASH_MISSING");
  }
  if (!caseRecord.transcriptRootHash) {
    throw new Error("SEAL_TRANSCRIPT_HASH_MISSING");
  }
  if (!caseRecord.jurySelectionProofHash) {
    throw new Error("SEAL_JURY_PROOF_HASH_MISSING");
  }
  if (!caseRecord.drandRound || !caseRecord.drandRandomness || !caseRecord.poolSnapshotHash) {
    throw new Error("SEAL_DRAND_METADATA_MISSING");
  }
  if (!caseRecord.decidedAtIso) {
    throw new Error("SEAL_DECIDED_AT_MISSING");
  }
  if (!caseRecord.outcome) {
    throw new Error("SEAL_OUTCOME_MISSING");
  }

  return {
    jobId: createId("seal"),
    caseId: caseRecord.caseId,
    verdictHash: caseRecord.verdictHash,
    transcriptRootHash: caseRecord.transcriptRootHash,
    jurySelectionProofHash: caseRecord.jurySelectionProofHash,
    rulesetVersion: caseRecord.rulesetVersion,
    drandRound: caseRecord.drandRound,
    drandRandomness: caseRecord.drandRandomness,
    jurorPoolSnapshotHash: caseRecord.poolSnapshotHash,
    outcome: caseRecord.outcome,
    decidedAtIso: caseRecord.decidedAtIso,
    externalUrl: `/decision/${encodeURIComponent(caseRecord.caseId)}`,
    verdictUri: `/decision/${encodeURIComponent(caseRecord.caseId)}`,
    metadata: {
      caseSummary: caseRecord.summary,
      imagePath: "nft_seal.png"
    }
  };
}

export async function enqueueSealJob(options: {
  db: Db;
  config: AppConfig;
  caseRecord: CaseRecord;
}): Promise<{ jobId: string; mode: "stub" | "http"; status: string; created: boolean }> {
  const request = buildWorkerSealRequest(options.caseRecord);
  const payloadHash = await canonicalHashHex(request);
  const created = createSealJobIfMissing(options.db, {
    caseId: options.caseRecord.caseId,
    request,
    payloadHash
  });

  if (created.status === "minted") {
    return {
      jobId: created.jobId,
      mode: options.config.sealWorkerMode,
      status: created.status,
      created: false
    };
  }
  if (created.status === "minting") {
    return {
      jobId: created.jobId,
      mode: options.config.sealWorkerMode,
      status: created.status,
      created: false
    };
  }

  await runSealJob(options, created.jobId, "enqueue");
  const latest = getSealJobByJobId(options.db, created.jobId);
  return {
    jobId: created.jobId,
    mode: options.config.sealWorkerMode,
    status: latest?.status ?? "queued",
    created: created.created
  };
}

function updateCaseForSealFailure(
  db: Db,
  result: Extract<WorkerSealResponse, { status: "failed" }>
): void {
  setCaseSealState(db, {
    caseId: result.caseId,
    sealStatus: "failed",
    error: result.errorMessage ?? result.errorCode ?? "Seal worker failed."
  });

  appendTranscriptEvent(db, {
    caseId: result.caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "closed",
    messageText: "Seal mint attempt failed. The case record remains closed and retryable.",
    payload: {
      errorCode: result.errorCode,
      errorMessage: result.errorMessage
    }
  });
}

export function applySealResult(
  db: Db,
  result: WorkerSealResponse,
  options?: { metadataUri?: string }
): void {
  markSealJobResult(db, result, { metadataUri: options?.metadataUri });
  if (result.status === "minted") {
    markCaseSealed(db, {
      caseId: result.caseId,
      assetId: result.assetId,
      txSig: result.txSig,
      sealedUri: result.sealedUri,
      metadataUri: result.metadataUri,
      sealedAtIso: result.sealedAtIso
    });
    appendTranscriptEvent(db, {
      caseId: result.caseId,
      actorRole: "court",
      eventType: "case_sealed",
      stage: "sealed",
      messageText: "Case sealed and cNFT receipt minted on Solana.",
      artefactType: "seal",
      artefactId: result.assetId,
      payload: {
        txSig: result.txSig,
        sealedUri: result.sealedUri,
        metadataUri: result.metadataUri
      }
    });
    return;
  }

  updateCaseForSealFailure(db, result);
}

async function runSealJob(
  options: { db: Db; config: AppConfig },
  jobId: string,
  mode: "enqueue" | "retry"
): Promise<void> {
  const job = getSealJobByJobId(options.db, jobId);
  if (!job) {
    throw new Error("SEAL_JOB_NOT_FOUND");
  }

  if (job.status === "minted") {
    return;
  }

  const claimStatus = job.status === "failed" ? "failed" : "queued";
  const claimed = claimSealJob(options.db, {
    jobId,
    expectedStatus: claimStatus
  });
  if (!claimed) {
    throw new Error("SEAL_JOB_NOT_QUEUED");
  }

  const request = job.requestJson as WorkerSealRequest;
  setCaseSealState(options.db, {
    caseId: request.caseId,
    sealStatus: "minting"
  });

  try {
    const result =
      options.config.sealWorkerMode === "stub"
        ? createStubSealResponse(request)
        : await postWorkerMint(options.config, request, mode);

    applySealResult(options.db, result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    markSealJobFailed(options.db, {
      jobId,
      error: errorMessage,
      responseJson: {
        jobId,
        caseId: request.caseId,
        status: "failed",
        errorCode: "SEAL_WORKER_ERROR",
        errorMessage
      }
    });
    setCaseSealState(options.db, {
      caseId: request.caseId,
      sealStatus: "failed",
      error: errorMessage
    });
    throw badRequest("SEAL_WORKER_ERROR", "Mint worker returned an error.");
  }
}

export async function retrySealJob(options: {
  db: Db;
  config: AppConfig;
  jobId: string;
}): Promise<WorkerSealResponse> {
  await runSealJob(options, options.jobId, "retry");
  const job = getSealJobByJobId(options.db, options.jobId);
  if (!job || !job.responseJson) {
    throw new Error("SEAL_JOB_RESULT_MISSING");
  }
  return job.responseJson as WorkerSealResponse;
}
