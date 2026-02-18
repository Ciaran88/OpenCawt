import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config";
import {
  completeIdempotencyRecord as dbCompleteIdempotencyRecord,
  getIdempotencyRecord,
  purgeExpiredIdempotency,
  releaseIdempotencyClaim,
  saveIdempotencyRecord,
  tryClaimIdempotency as dbTryClaimIdempotency,
  type IdempotencyRecord,
  type TryClaimIdempotencyResult
} from "../db/repository";
import type { Db } from "../db/sqlite";
import { conflict } from "./errors";

export interface IdempotencyReplay {
  replayed: boolean;
  status: number;
  payload: unknown;
}

export type { TryClaimIdempotencyResult };

export function tryClaimIdempotency(
  db: Db,
  config: AppConfig,
  input: {
    agentId: string;
    method: string;
    path: string;
    caseId?: string;
    idempotencyKey: string;
    requestHash: string;
  }
): TryClaimIdempotencyResult {
  purgeExpiredIdempotency(db);
  try {
    return dbTryClaimIdempotency(db, {
      ...input,
      ttlSec: config.idempotencyTtlSec
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD") {
      throw conflict(
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        "Idempotency key was already used with a different payload."
      );
    }
    if (msg === "IDEMPOTENCY_IN_PROGRESS") {
      throw conflict(
        "IDEMPOTENCY_IN_PROGRESS",
        "Request in progress, retry later."
      );
    }
    throw err;
  }
}

export function completeIdempotency(
  db: Db,
  input: {
    agentId: string;
    method: string;
    path: string;
    idempotencyKey: string;
    responseStatus: number;
    responsePayload: unknown;
  }
): void {
  dbCompleteIdempotencyRecord(db, {
    ...input,
    responseJson: normaliseIdempotencyPayload(input.responsePayload)
  });
}

export function releaseIdempotencyClaimOnError(
  db: Db,
  input: { agentId: string; method: string; path: string; idempotencyKey: string }
): void {
  releaseIdempotencyClaim(db, input);
}

function normaliseIdempotencyPayload(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normaliseIdempotencyPayload(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) {
        continue;
      }
      out[key] = normaliseIdempotencyPayload(nested);
    }
    return out;
  }
  return String(value);
}

export function readIdempotencyKey(req: IncomingMessage): string | undefined {
  const value = req.headers["idempotency-key"];
  if (!value) {
    return undefined;
  }
  const key = String(value).trim();
  return key || undefined;
}

export function assertIdempotency(
  db: Db,
  input: {
    agentId: string;
    method: string;
    path: string;
    requestHash: string;
    idempotencyKey?: string;
  }
): IdempotencyReplay | null {
  if (!input.idempotencyKey) {
    return null;
  }

  purgeExpiredIdempotency(db);

  const existing = getIdempotencyRecord(db, {
    agentId: input.agentId,
    method: input.method,
    path: input.path,
    idempotencyKey: input.idempotencyKey
  });

  if (!existing) {
    return null;
  }

  if (existing.requestHash !== input.requestHash) {
    throw conflict(
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
      "Idempotency key was already used with a different payload."
    );
  }

  return {
    replayed: true,
    status: existing.responseStatus,
    payload: existing.responseJson
  };
}

export function saveIdempotency(
  db: Db,
  config: AppConfig,
  input: {
    agentId: string;
    method: string;
    path: string;
    caseId?: string;
    requestHash: string;
    idempotencyKey?: string;
    responseStatus: number;
    responsePayload: unknown;
  }
): void {
  if (!input.idempotencyKey) {
    return;
  }

  saveIdempotencyRecord(db, {
    agentId: input.agentId,
    method: input.method,
    path: input.path,
    caseId: input.caseId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    responseStatus: input.responseStatus,
    responseJson: normaliseIdempotencyPayload(input.responsePayload),
    ttlSec: config.idempotencyTtlSec
  });
}

export function isIdempotencyRecord(value: unknown): value is IdempotencyRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.requestHash === "string" &&
    typeof v.responseStatus === "number" &&
    Object.prototype.hasOwnProperty.call(v, "responseJson")
  );
}
