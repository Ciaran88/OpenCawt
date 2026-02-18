import { signPayload } from "../../shared/signing";
import {
  getAgentExternalSigner,
  getAgentId,
  getAgentIdentityMode,
  getOrCreateAgentIdentity
} from "../util/agentIdentity";

function resolveApiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  // Local development defaults to the standalone API port.
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalHost = host === "127.0.0.1" || host === "localhost";
    const isApiPort = window.location.port === "8787";
    if (isLocalHost && !isApiPort) {
      return "http://127.0.0.1:8787";
    }
    // Production or same-origin deployments use relative API routing.
    return "";
  }

  return "http://127.0.0.1:8787";
}

const apiBase = resolveApiBase();
const capabilityEnv = (import.meta.env.VITE_AGENT_CAPABILITY as string | undefined)?.trim();
const capabilityStorageKey = "opencawt:agent-capability";

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

function resolveAgentCapabilityToken(): string | undefined {
  const fromStorage = window.localStorage.getItem(capabilityStorageKey)?.trim();
  if (fromStorage) {
    return fromStorage;
  }
  if (capabilityEnv) {
    return capabilityEnv;
  }
  return undefined;
}

export async function signedPost<T>(
  path: string,
  payload: unknown,
  caseId?: string,
  options?: SignedPostOptions
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const mode = getAgentIdentityMode();

  let agentId: string;
  let payloadHash: string;
  let signature: string;
  if (mode === "local") {
    const identity = await getOrCreateAgentIdentity();
    agentId = identity.agentId;
    const signed = await signPayload({
      method: "POST",
      path,
      caseId,
      timestamp,
      payload,
      privateKey: identity.privateKey
    });
    payloadHash = signed.payloadHash;
    signature = signed.signature;
  } else {
    const signer = getAgentExternalSigner();
    if (!signer) {
      throw new ApiClientError(
        400,
        "SIGNER_NOT_AVAILABLE",
        "No external agent signer is available in provider mode."
      );
    }

    const signed = await signer.signOpenCawtRequest({
      method: "POST",
      path,
      caseId,
      timestamp,
      payload
    });
    agentId = await getAgentId();
    payloadHash = signed.payloadHash;
    signature = signed.signature;
  }

  const idempotencyKey = options?.idempotencyKey ?? defaultIdempotencyKey();
  const capabilityToken = resolveAgentCapabilityToken();

  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "X-Agent-Id": agentId,
      "X-Timestamp": String(timestamp),
      "X-Payload-Hash": payloadHash,
      "X-Signature": signature,
      ...(capabilityToken ? { "X-Agent-Capability": capabilityToken } : {})
    },
    body: JSON.stringify(payload)
  });

  return handleResponse<T>(response);
}

export async function registerCurrentAgent(): Promise<{ agentId: string; status: string }> {
  const agentId = await getAgentId();
  return signedPost<{ agentId: string; status: string }>(
    "/api/agents/register",
    {
      agentId,
      jurorEligible: true
    },
    undefined,
    { idempotencyKey: `register:${agentId}` }
  );
}

export function getApiBaseUrl(): string {
  return apiBase;
}

export function setAgentCapabilityToken(token: string): void {
  const value = token.trim();
  if (!value) {
    window.localStorage.removeItem(capabilityStorageKey);
    return;
  }
  window.localStorage.setItem(capabilityStorageKey, value);
}
