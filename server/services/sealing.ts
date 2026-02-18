import type { WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import { createId } from "../../shared/ids";
import type { AppConfig } from "../config";
import {
  appendTranscriptEvent,
  createSealJob,
  getSealJobByJobId,
  markCaseSealed,
  markSealJobResult,
  type CaseRecord
} from "../db/repository";
import type { Db } from "../db/sqlite";
import { badRequest } from "./errors";

function createStubSealResponse(request: WorkerSealRequest): WorkerSealResponse {
  const suffix = request.caseId.replace(/[^a-zA-Z0-9]/g, "").slice(-8);
  return {
    jobId: request.jobId,
    caseId: request.caseId,
    assetId: `asset_${suffix}_${Date.now().toString(36)}`,
    txSig: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    sealedUri: `${request.verdictUri}/sealed`,
    status: "minted"
  };
}

async function postWorkerMint(
  config: AppConfig,
  request: WorkerSealRequest
): Promise<WorkerSealResponse> {
  const response = await fetch(`${config.sealWorkerUrl.replace(/\/$/, "")}/mint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Token": config.workerToken
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw badRequest("SEAL_WORKER_ERROR", "Mint worker returned an error.");
  }

  return (await response.json()) as WorkerSealResponse;
}

export async function enqueueSealJob(options: {
  db: Db;
  config: AppConfig;
  caseRecord: CaseRecord;
  verdictHash: string;
}): Promise<{ jobId: string; mode: "stub" | "http" }> {
  const jobId = createId("seal");
  const request: WorkerSealRequest = {
    jobId,
    caseId: options.caseRecord.caseId,
    verdictHash: options.verdictHash,
    verdictUri: `/decision/${encodeURIComponent(options.caseRecord.caseId)}`,
    metadata: {
      title: options.caseRecord.caseId,
      summary: options.caseRecord.summary,
      closedAtIso: options.caseRecord.closedAtIso ?? new Date().toISOString()
    }
  };

  createSealJob(options.db, {
    caseId: options.caseRecord.caseId,
    request
  });

  if (options.config.sealWorkerMode === "stub") {
    const result = createStubSealResponse(request);
    applySealResult(options.db, result);
    return { jobId, mode: "stub" };
  }

  const result = await postWorkerMint(options.config, request);
  applySealResult(options.db, result);
  return { jobId, mode: "http" };
}

export function applySealResult(db: Db, result: WorkerSealResponse): void {
  markSealJobResult(db, result);
  if (result.status === "minted") {
    markCaseSealed(db, {
      caseId: result.caseId,
      assetId: result.assetId,
      txSig: result.txSig,
      sealedUri: result.sealedUri
    });
    appendTranscriptEvent(db, {
      caseId: result.caseId,
      actorRole: "court",
      eventType: "case_sealed",
      stage: "sealed",
      messageText: "Case sealed and cNFT metadata resolved.",
      artefactType: "seal",
      artefactId: result.assetId,
      payload: {
        txSig: result.txSig,
        sealedUri: result.sealedUri
      }
    });
  }
}

export async function retrySealJob(options: {
  db: Db;
  config: AppConfig;
  jobId: string;
}): Promise<WorkerSealResponse> {
  const job = getSealJobByJobId(options.db, options.jobId);
  if (!job) {
    throw new Error("SEAL_JOB_NOT_FOUND");
  }
  if (job.status !== "queued") {
    throw new Error("SEAL_JOB_NOT_QUEUED");
  }
  const request = job.requestJson as WorkerSealRequest;
  const result = await postWorkerMint(options.config, request);
  applySealResult(options.db, result);
  return result;
}
