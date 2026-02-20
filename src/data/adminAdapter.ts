// Admin API adapter — all functions require a session token obtained from adminAuth()

function resolveApiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalHost = host === "127.0.0.1" || host === "localhost";
    const isApiPort = window.location.port === "8787";
    if (isLocalHost && !isApiPort) {
      return "http://127.0.0.1:8787";
    }
    return "";
  }
  return "http://127.0.0.1:8787";
}

const apiBase = resolveApiBase();

export class AdminApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function handleAdminResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (response.ok) {
    return data as T;
  }
  const err = (data as { error?: { code?: string; message?: string } }).error;
  throw new AdminApiError(
    response.status,
    err?.code ?? "ADMIN_ERROR",
    err?.message ?? `Request failed with status ${response.status}`
  );
}

function systemKeyHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-System-Key": token
  };
}

export async function adminAuth(password: string): Promise<{ token: string }> {
  const response = await fetch(`${apiBase}/api/internal/admin-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  return handleAdminResponse<{ token: string }>(response);
}

export interface AdminStatus {
  db: { ready: boolean };
  railwayWorker: { ready: boolean; mode: string };
  helius: { ready: boolean; hasApiKey: boolean };
  drand: { ready: boolean; mode: string };
  softDailyCaseCap: number;
  softCapMode: "warn" | "enforce";
  jurorPanelSize: number;
  courtMode: string;
  judgeAvailable?: boolean;
  treasuryAddress?: string;
  sealWorkerUrl?: string;
  sealWorkerMode?: string;
  workflowSummary?: string;
}

export interface AdminCheckResult {
  db: { ready: boolean; error?: string };
  railwayWorker: {
    ready: boolean;
    error?: string;
    mode: string;
    mintAuthorityPubkey?: string;
  };
  helius: { ready: boolean; error?: string };
  drand: { ready: boolean; error?: string };
}

export async function adminGetStatus(token: string): Promise<AdminStatus> {
  const response = await fetch(`${apiBase}/api/internal/admin-status`, {
    headers: { "X-System-Key": token }
  });
  return handleAdminResponse<AdminStatus>(response);
}

export async function adminCheckSystems(token: string): Promise<AdminCheckResult> {
  const response = await fetch(`${apiBase}/api/internal/admin-check-systems`, {
    method: "POST",
    headers: { "X-System-Key": token }
  });
  return handleAdminResponse<AdminCheckResult>(response);
}

export async function adminBanFiling(
  token: string,
  agentId: string,
  banned: boolean
): Promise<void> {
  const response = await fetch(
    `${apiBase}/api/internal/agents/${encodeURIComponent(agentId)}/ban-filing`,
    {
      method: "POST",
      headers: systemKeyHeaders(token),
      body: JSON.stringify({ banned })
    }
  );
  await handleAdminResponse(response);
}

export async function adminBanDefence(
  token: string,
  agentId: string,
  banned: boolean
): Promise<void> {
  const response = await fetch(
    `${apiBase}/api/internal/agents/${encodeURIComponent(agentId)}/ban-defence`,
    {
      method: "POST",
      headers: systemKeyHeaders(token),
      body: JSON.stringify({ banned })
    }
  );
  await handleAdminResponse(response);
}

export async function adminBanJury(
  token: string,
  agentId: string,
  banned: boolean
): Promise<void> {
  const response = await fetch(
    `${apiBase}/api/internal/agents/${encodeURIComponent(agentId)}/ban-jury`,
    {
      method: "POST",
      headers: systemKeyHeaders(token),
      body: JSON.stringify({ banned })
    }
  );
  await handleAdminResponse(response);
}

export async function adminDeleteCase(token: string, caseId: string): Promise<void> {
  const response = await fetch(
    `${apiBase}/api/internal/cases/${encodeURIComponent(caseId)}`,
    {
      method: "DELETE",
      headers: { "X-System-Key": token }
    }
  );
  await handleAdminResponse(response);
}

export async function adminSetDailyCap(token: string, cap: number): Promise<{ softDailyCaseCap: number }> {
  const response = await fetch(`${apiBase}/api/internal/config/daily-cap`, {
    method: "POST",
    headers: systemKeyHeaders(token),
    body: JSON.stringify({ cap })
  });
  return handleAdminResponse<{ softDailyCaseCap: number }>(response);
}

export async function adminSetSoftCapMode(
  token: string,
  mode: "warn" | "enforce"
): Promise<{ softCapMode: "warn" | "enforce" }> {
  const response = await fetch(`${apiBase}/api/internal/config/soft-cap-mode`, {
    method: "POST",
    headers: systemKeyHeaders(token),
    body: JSON.stringify({ mode })
  });
  return handleAdminResponse<{ softCapMode: "warn" | "enforce" }>(response);
}

export async function adminSetCourtMode(
  token: string,
  mode: "11-juror" | "judge"
): Promise<{ courtMode: string }> {
  const response = await fetch(`${apiBase}/api/internal/config/court-mode`, {
    method: "POST",
    headers: systemKeyHeaders(token),
    body: JSON.stringify({ mode })
  });
  return handleAdminResponse<{ courtMode: string }>(response);
}
