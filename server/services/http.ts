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

export interface ExternalFetchOptions {
  url: string;
  init?: RequestInit;
  attempts: number;
  timeoutMs: number;
  baseDelayMs: number;
  target: string;
  requestId?: string;
}

export interface ExternalFailure {
  code:
    | "EXTERNAL_DNS_FAILURE"
    | "EXTERNAL_TIMEOUT"
    | "EXTERNAL_HTTP_4XX"
    | "EXTERNAL_HTTP_5XX"
    | "EXTERNAL_NETWORK_FAILURE";
  statusCode: number;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

type ExternalFailureTelemetry = {
  lastExternalDnsFailureAtIso: string | null;
  lastExternalTimeoutAtIso: string | null;
};

const externalFailureTelemetry: ExternalFailureTelemetry = {
  lastExternalDnsFailureAtIso: null,
  lastExternalTimeoutAtIso: null
};

function recordExternalFailureTelemetry(code: ExternalFailure["code"]): void {
  const nowIso = new Date().toISOString();
  if (code === "EXTERNAL_DNS_FAILURE") {
    externalFailureTelemetry.lastExternalDnsFailureAtIso = nowIso;
  }
  if (code === "EXTERNAL_TIMEOUT") {
    externalFailureTelemetry.lastExternalTimeoutAtIso = nowIso;
  }
}

export function getExternalFailureTelemetry(): ExternalFailureTelemetry {
  return {
    lastExternalDnsFailureAtIso: externalFailureTelemetry.lastExternalDnsFailureAtIso,
    lastExternalTimeoutAtIso: externalFailureTelemetry.lastExternalTimeoutAtIso
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }
  const raw = headerValue.trim();
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }
  const atMs = Date.parse(raw);
  if (!Number.isFinite(atMs)) {
    return null;
  }
  return Math.max(0, atMs - Date.now());
}

function classifyExternalNetworkError(
  error: unknown,
  options: { target: string; url: string; requestId?: string; attempt: number; attempts: number }
): ExternalFailure {
  const err = error as Error & { cause?: { code?: string } };
  const causeCode = err.cause?.code ?? "";
  const message = err.message ?? String(error);
  const hostname = (() => {
    try {
      return new URL(options.url).hostname;
    } catch {
      return undefined;
    }
  })();
  const baseDetails = {
    target: options.target,
    targetHost: hostname,
    url: options.url,
    requestId: options.requestId,
    attempt: options.attempt,
    attempts: options.attempts
  };

  if (message.includes("AbortError")) {
    return {
      code: "EXTERNAL_TIMEOUT",
      statusCode: 504,
      message: `Timeout while contacting ${options.target}.`,
      retryable: true,
      details: baseDetails
    };
  }

  if (
    causeCode === "ENOTFOUND" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "ENODATA" ||
    causeCode === "EAI_FAIL"
  ) {
    return {
      code: "EXTERNAL_DNS_FAILURE",
      statusCode: 502,
      message: `DNS resolution failed for ${options.target}.`,
      retryable: true,
      details: { ...baseDetails, causeCode }
    };
  }

  if (causeCode === "ETIMEDOUT") {
    return {
      code: "EXTERNAL_TIMEOUT",
      statusCode: 504,
      message: `Timeout while contacting ${options.target}.`,
      retryable: true,
      details: { ...baseDetails, causeCode }
    };
  }

  return {
    code: "EXTERNAL_NETWORK_FAILURE",
    statusCode: 502,
    message: `Network error while contacting ${options.target}.`,
    retryable: true,
    details: { ...baseDetails, causeCode: causeCode || undefined }
  };
}

function createHttpStatusFailure(
  response: Response,
  options: { target: string; url: string; requestId?: string; attempt: number; attempts: number }
): ExternalFailure {
  const is4xx = response.status >= 400 && response.status < 500;
  const retryable = !is4xx || response.status === 429;
  return {
    code: is4xx ? "EXTERNAL_HTTP_4XX" : "EXTERNAL_HTTP_5XX",
    statusCode: 502,
    message: `External ${options.target} returned HTTP ${response.status}.`,
    retryable,
    details: {
      target: options.target,
      url: options.url,
      requestId: options.requestId,
      upstreamStatus: response.status,
      attempt: options.attempt,
      attempts: options.attempts
    }
  };
}

export async function fetchWithRetry(options: ExternalFetchOptions): Promise<Response> {
  let lastFailure: ExternalFailure | null = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(options.url, {
        ...(options.init ?? {}),
        signal: controller.signal
      });

      if (!response.ok) {
        const failure = createHttpStatusFailure(response, {
          target: options.target,
          url: options.url,
          requestId: options.requestId,
          attempt,
          attempts: options.attempts
        });
        recordExternalFailureTelemetry(failure.code);
        lastFailure = failure;
        if (failure.retryable && attempt < options.attempts) {
          const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt - 1);
          const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after")) ?? 0;
          const jitter = Math.floor(Math.random() * 120);
          const waitMs = Math.max(exponentialDelay + jitter, retryAfterMs);
          await wait(waitMs);
          continue;
        }
        throw new ApiError(failure.statusCode, failure.code, failure.message, failure.details);
      }

      return response;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      const failure = classifyExternalNetworkError(error, {
        target: options.target,
        url: options.url,
        requestId: options.requestId,
        attempt,
        attempts: options.attempts
      });
      recordExternalFailureTelemetry(failure.code);
      lastFailure = failure;
      if (failure.retryable && attempt < options.attempts) {
        const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 120);
        await wait(exponentialDelay + jitter);
        continue;
      }
      throw new ApiError(failure.statusCode, failure.code, failure.message, failure.details);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastFailure) {
    throw new ApiError(
      lastFailure.statusCode,
      lastFailure.code,
      lastFailure.message,
      lastFailure.details
    );
  }

  throw new ApiError(502, "EXTERNAL_NETWORK_FAILURE", "External request failed.");
}

export async function fetchJsonWithRetry<T>(
  options: ExternalFetchOptions & { parse?: (raw: unknown) => T }
): Promise<T> {
  const response = await fetchWithRetry(options);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(502, "EXTERNAL_INVALID_JSON", `Invalid JSON from ${options.target}.`, {
      target: options.target,
      url: options.url,
      requestId: options.requestId
    });
  }
  return options.parse ? options.parse(json) : (json as T);
}
