/**
 * OCP API adapter — all calls go to /v1/ (new external API surface).
 * The legacy /api/ocp/ endpoints remain available for backward compatibility.
 */

import type {
  OcpAgentResponse,
  ProposeAgreementPayload,
  ProposeAgreementResponse,
  AcceptPayload,
  AcceptResponse,
  OcpAgreementResponse,
  ListAgreementsResponse,
  VerifyResponse,
  OcpDecisionResponse,
  DraftDecisionPayload,
  DraftDecisionResponse,
  OcpApiKeyResponse,
  CreateApiKeyResponse,
  ListApiKeysResponse,
  CanonicaliseResponse,
  CanonicalTerms,
} from "./types";

const V1 = "/v1";

async function apiPost<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T | { error: { code: string; message: string } };
  if (!res.ok) {
    const err = data as { error: { code: string; message: string } };
    throw new Error(`${err.error?.code ?? "ERROR"}: ${err.error?.message ?? res.statusText}`);
  }
  return data as T;
}

async function apiGet<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`${path}`, { headers });
  const data = (await res.json()) as T | { error: { code: string; message: string } };
  if (!res.ok) {
    const err = data as { error: { code: string; message: string } };
    throw new Error(`${err.error?.code ?? "ERROR"}: ${err.error?.message ?? res.statusText}`);
  }
  return data as T;
}

// ---- Agent Identity ----

export async function getAgent(agentId: string): Promise<OcpAgentResponse> {
  return apiGet<OcpAgentResponse>(`${V1}/agents/${encodeURIComponent(agentId)}`);
}

// ---- Canonicaliser Preview ----

export async function canonicaliseTerms(terms: CanonicalTerms): Promise<CanonicaliseResponse> {
  return apiPost<CanonicaliseResponse>(`${V1}/canonicalise`, { terms });
}

// ---- Agreement lifecycle ----

export async function proposeAgreement(
  payload: ProposeAgreementPayload
): Promise<ProposeAgreementResponse> {
  return apiPost<ProposeAgreementResponse>(`${V1}/agreements/propose`, payload);
}

export async function acceptAgreement(
  proposalId: string,
  payload: AcceptPayload
): Promise<AcceptResponse> {
  return apiPost<AcceptResponse>(`${V1}/agreements/${encodeURIComponent(proposalId)}/accept`, payload);
}

export async function getAgreement(proposalId: string): Promise<OcpAgreementResponse> {
  return apiGet<OcpAgreementResponse>(`${V1}/agreements/${encodeURIComponent(proposalId)}`);
}

export async function getAgreementByCode(code: string): Promise<OcpAgreementResponse> {
  return apiGet<OcpAgreementResponse>(`${V1}/agreements/by-code/${encodeURIComponent(code)}`);
}

export async function listAgreements(
  agentId: string,
  status = "all",
  limit = 20
): Promise<ListAgreementsResponse> {
  return apiGet<ListAgreementsResponse>(
    `${V1}/agents/${encodeURIComponent(agentId)}/agreements?status=${status}&limit=${limit}`
  );
}

// ---- Receipts ----

export async function getReceipt(code: string): Promise<unknown> {
  return apiGet(`${V1}/receipts/${encodeURIComponent(code)}`);
}

// ---- Verify ----

export async function verifyAgreement(lookup: string): Promise<VerifyResponse> {
  // Try as proposalId first, then fall back to code param
  const param = lookup.startsWith("prop_") ? `proposalId=${encodeURIComponent(lookup)}` : `code=${encodeURIComponent(lookup)}`;
  return apiGet<VerifyResponse>(`${V1}/verify?${param}`);
}

// ---- Decisions ----

export async function draftDecision(payload: DraftDecisionPayload): Promise<DraftDecisionResponse> {
  return apiPost<DraftDecisionResponse>(`${V1}/decisions/draft`, payload);
}

export async function getDecision(id: string): Promise<OcpDecisionResponse> {
  return apiGet<OcpDecisionResponse>(`${V1}/decisions/${encodeURIComponent(id)}`);
}

// ---- API Keys ----

export async function listApiKeys(apiKey?: string): Promise<ListApiKeysResponse> {
  const headers: Record<string, string> = {};
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return apiGet<ListApiKeysResponse>(`${V1}/api-keys`, headers);
}

export async function createApiKey(label: string): Promise<CreateApiKeyResponse> {
  return apiPost<CreateApiKeyResponse>(`${V1}/api-keys`, { label });
}

export async function revokeApiKey(keyId: string): Promise<{ keyId: string; status: string }> {
  const res = await fetch(`${V1}/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  const data = (await res.json()) as { keyId: string; status: string };
  if (!res.ok) {
    const err = data as unknown as { error: { code: string; message: string } };
    throw new Error(`${err.error?.code ?? "ERROR"}: ${err.error?.message ?? res.statusText}`);
  }
  return data;
}

// ---- Health ----

export async function getHealth(): Promise<{ status: string; version: string; dbOk: boolean }> {
  return apiGet(`${V1}/health`);
}

// ---- Legacy adapter (used by verify form which calls POST /api/ocp/verify) ----
// Kept so verifyView.ts tab-based lookup still works until fully migrated.
export async function verifyAgreementByCode(agreementCode: string): Promise<VerifyResponse> {
  return apiGet<VerifyResponse>(`${V1}/verify?code=${encodeURIComponent(agreementCode)}`);
}
