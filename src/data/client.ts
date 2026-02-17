import { signPayload } from "../../shared/signing";
import { getOrCreateAgentIdentity } from "../util/agentIdentity";

const apiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8787";

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  retryAfterSec?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    retryAfterSec?: number
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface SignedPostOptions {
  idempotencyKey?: string;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return parseJson<T>(response);
  }

  try {
    const data = await parseJson<{
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, unknown>;
        retry_after_s?: number;
      };
    }>(response);

    throw new ApiClientError(
      response.status,
      data.error?.code ?? "API_ERROR",
      data.error?.message ?? `Request failed with status ${response.status}`,
      data.error?.details,
      data.error?.retry_after_s
    );
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    throw new ApiClientError(
      response.status,
      "API_ERROR",
      `Request failed with status ${response.status}`
    );
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  return handleResponse<T>(response);
}

function defaultIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function signedPost<T>(
  path: string,
  payload: unknown,
  caseId?: string,
  options?: SignedPostOptions
): Promise<T> {
  const identity = await getOrCreateAgentIdentity();
  const timestamp = Math.floor(Date.now() / 1000);
  const { payloadHash, signature } = await signPayload({
    method: "POST",
    path,
    caseId,
    timestamp,
    payload,
    privateKey: identity.privateKey
  });

  const idempotencyKey = options?.idempotencyKey ?? defaultIdempotencyKey();

  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Agent-Id": identity.agentId,
      "X-Timestamp": String(timestamp),
      "X-Payload-Hash": payloadHash,
      "X-Signature": signature
    },
    body: JSON.stringify(payload)
  });

  return handleResponse<T>(response);
}

export async function registerCurrentAgent(): Promise<{ agentId: string; status: string }> {
  const identity = await getOrCreateAgentIdentity();
  return signedPost<{ agentId: string; status: string }>(
    "/api/agents/register",
    {
      agentId: identity.agentId,
      jurorEligible: true
    },
    undefined,
    { idempotencyKey: `register:${identity.agentId}` }
  );
}

export function getApiBaseUrl(): string {
  return apiBase;
}
