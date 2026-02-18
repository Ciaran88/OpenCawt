import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { canonicalHashHex } from "../../shared/hash";
import { verifySignedPayload } from "../../shared/signing";
import type { AppConfig } from "../config";
import type { Db } from "../db/sqlite";
import {
  getAgent,
  getAgentCapabilityByHash,
  hasSignedAction,
  logSignedAction
} from "../db/repository";
import { badRequest, forbidden, unauthorised } from "./errors";

export interface VerifiedSignature {
  agentId: string;
  timestampSec: number;
  signature: string;
  payloadHash: string;
}

function readHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (!value) {
    throw badRequest("MISSING_HEADER", `Missing ${name} header.`);
  }
  return String(value);
}

function readOptionalHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

export function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function verifySignedMutation(options: {
  db: Db;
  config: AppConfig;
  req: IncomingMessage;
  body: unknown;
  path: string;
  method: string;
  caseId?: string;
}): Promise<VerifiedSignature> {
  const agentId = readHeader(options.req, "X-Agent-Id");
  const timestampRaw = readHeader(options.req, "X-Timestamp");
  const payloadHash = readHeader(options.req, "X-Payload-Hash");
  const signature = readHeader(options.req, "X-Signature");

  const timestampSec = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(timestampSec)) {
    throw badRequest("INVALID_TIMESTAMP", "X-Timestamp must be a unix seconds integer.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestampSec) > options.config.signatureSkewSec) {
    throw unauthorised("STALE_SIGNATURE", "Signed request timestamp is outside allowed window.");
  }

  const computedPayloadHash = await canonicalHashHex(options.body);
  if (computedPayloadHash !== payloadHash) {
    throw unauthorised("PAYLOAD_HASH_MISMATCH", "X-Payload-Hash does not match request payload.");
  }

  const ok = await verifySignedPayload({
    agentId,
    method: options.method,
    path: options.path,
    caseId: options.caseId,
    timestamp: timestampSec,
    payloadHash,
    signature
  });

  if (!ok) {
    throw unauthorised("SIGNATURE_INVALID", "Request signature could not be verified.");
  }

  if (hasSignedAction(options.db, { agentId, signature, timestampSec })) {
    throw unauthorised("SIGNATURE_REPLAYED", "This signature has already been used.");
  }

  const agent = getAgent(options.db, agentId);
  if (agent?.banned) {
    throw forbidden("AGENT_BANNED", "This agent is banned.");
  }

  if (options.config.capabilityKeysEnabled) {
    const capabilityToken = readOptionalHeader(options.req, "X-Agent-Capability");
    if (!capabilityToken) {
      throw unauthorised(
        "CAPABILITY_REQUIRED",
        "X-Agent-Capability is required while capability keys are enabled."
      );
    }
    const capability = getAgentCapabilityByHash(options.db, hashCapabilityToken(capabilityToken));
    if (!capability) {
      throw unauthorised("CAPABILITY_INVALID", "Capability token is invalid.");
    }
    if (capability.agentId !== agentId) {
      throw forbidden(
        "CAPABILITY_AGENT_MISMATCH",
        "Capability token does not belong to signing identity."
      );
    }
    if (capability.revokedAtIso) {
      throw unauthorised("CAPABILITY_REVOKED", "Capability token has been revoked.");
    }
    if (capability.expiresAtIso) {
      const expiresAt = new Date(capability.expiresAtIso).getTime();
      if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
        throw unauthorised("CAPABILITY_EXPIRED", "Capability token has expired.");
      }
    }
  }

  return {
    agentId,
    timestampSec,
    signature,
    payloadHash
  };
}

export function recordSignedMutation(options: {
  db: Db;
  verified: VerifiedSignature;
  actionType: string;
  caseId?: string;
}): void {
  logSignedAction(options.db, {
    agentId: options.verified.agentId,
    actionType: options.actionType,
    caseId: options.caseId,
    signature: options.verified.signature,
    timestampSec: options.verified.timestampSec
  });
}

export function assertSystemKey(req: IncomingMessage, config: AppConfig): void {
  const value = req.headers["x-system-key"];
  if (!value || String(value) !== config.systemApiKey) {
    throw unauthorised("SYSTEM_KEY_INVALID", "System key is missing or invalid.");
  }
}

export function assertWorkerToken(req: IncomingMessage, config: AppConfig): void {
  const value = req.headers["x-worker-token"];
  if (!value || String(value) !== config.workerToken) {
    throw unauthorised("WORKER_TOKEN_INVALID", "Worker token is missing or invalid.");
  }
}
