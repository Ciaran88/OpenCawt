import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../config";
import {
  getIdempotencyRecord,
  purgeExpiredIdempotency,
  saveIdempotencyRecord,
  type IdempotencyRecord
} from "../db/repository";
import type { Db } from "../db/sqlite";
import { conflict } from "./errors";

export interface IdempotencyReplay {
  replayed: boolean;
  status: number;
  payload: unknown;
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
    responseJson: input.responsePayload,
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
