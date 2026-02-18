import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError } from "./errors";

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  searchParams: URLSearchParams;
}

export function setCorsHeaders(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Idempotency-Key, X-Agent-Id, X-Timestamp, X-Payload-Hash, X-Signature, X-System-Key, X-Worker-Token, X-Helius-Token"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

export function setSecurityHeaders(res: ServerResponse, isProduction: boolean): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:;"
  );
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.statusCode, {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      retry_after_s: error.retryAfterSec
    }
  });
}

/**
 * Reads and parses JSON request body. Default 1MB limit.
 * For mutation routes with bounded payloads (e.g. evidence, stage-message), consider passing
 * a stricter limit (e.g. 256 * 1024) to reduce DoS surface.
 */
export async function readJsonBody<T>(req: IncomingMessage, limitBytes = 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > limitBytes) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Payload exceeds size limit.");
    }
    chunks.push(part);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

export function ensureMethod(req: IncomingMessage, expected: "GET" | "POST"): void {
  if (req.method !== expected) {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", `Expected ${expected}.`);
  }
}

export function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}
