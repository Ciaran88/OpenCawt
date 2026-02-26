/**
 * OpenClaw plugin for OpenCawt dispute resolution.
 * Tools are registered with optional: true for opt-in allowlisting.
 * Tool availability depends on allowlists; optional tools must be explicitly allowed in agents.list[].tools.allow.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface AgentIdentity {
  agentId: string;
  privateKey: CryptoKey;
}

interface PluginToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const encoder = new TextEncoder();
const pluginDir = dirname(fileURLToPath(import.meta.url));
const toolSchemasPath = resolve(pluginDir, "./toolSchemas.json");
const OPENCAWT_OPENCLAW_TOOLS = JSON.parse(
  readFileSync(toolSchemasPath, "utf8")
) as PluginToolDefinition[];

function toOpenClawParameters(tool: PluginToolDefinition): {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
} {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Canonical JSON rejects non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (Object.prototype.toString.call(value) === "[object Object]") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, nested]) => {
        if (
          typeof nested === "undefined" ||
          typeof nested === "function" ||
          typeof nested === "symbol"
        ) {
          throw new Error("Canonical JSON rejects unsupported values.");
        }
        return `${JSON.stringify(key)}:${canonicalJson(nested)}`;
      })
      .join(",")}}`;
  }
  throw new Error("Canonical JSON only supports JSON values.");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input) as BufferSource);
  const bytes = new Uint8Array(digest);
  return [...bytes].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function buildSigningString(input: {
  method: string;
  path: string;
  caseId?: string;
  timestamp: number;
  payloadHash: string;
}): string {
  return [
    "OpenCawtReqV1",
    input.method.toUpperCase(),
    input.path,
    input.caseId ?? "",
    String(input.timestamp),
    input.payloadHash
  ].join("|");
}

async function signPayload(input: {
  method: string;
  path: string;
  caseId?: string;
  timestamp: number;
  payload: unknown;
  privateKey: CryptoKey;
}): Promise<{ payloadHash: string; signature: string }> {
  const payloadHash = await sha256Hex(canonicalJson(input.payload));
  const binding = buildSigningString({
    method: input.method,
    path: input.path,
    caseId: input.caseId,
    timestamp: input.timestamp,
    payloadHash
  });
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(binding) as BufferSource);
  const signatureBytes = await crypto.subtle.sign("Ed25519", input.privateKey, digest as BufferSource);
  return { payloadHash, signature: bytesToBase64(new Uint8Array(signatureBytes)) };
}

function resolveCapabilityToken(config: Record<string, unknown>): string | undefined {
  const direct =
    typeof config.agentCapabilityToken === "string" ? config.agentCapabilityToken.trim() : "";
  if (direct) {
    return direct;
  }
  const envName =
    typeof config.agentCapabilityEnv === "string" ? config.agentCapabilityEnv.trim() : "";
  if (envName && process.env[envName]?.trim()) {
    return process.env[envName]!.trim();
  }
  const fallback = process.env.OPENCAWT_AGENT_CAPABILITY?.trim();
  return fallback || undefined;
}

async function loadIdentity(config: { agentPrivateKeyPath?: string; agentPrivateKeyEnv?: string }): Promise<AgentIdentity | null> {
  let raw: string;
  if (config.agentPrivateKeyPath) {
    raw = readFileSync(resolve(config.agentPrivateKeyPath), "utf8");
  } else if (config.agentPrivateKeyEnv && process.env[config.agentPrivateKeyEnv]) {
    raw = process.env[config.agentPrivateKeyEnv]!;
  } else {
    return null;
  }
  const parsed = JSON.parse(raw) as { agentId: string; privateJwk: JsonWebKey };
  if (!parsed.agentId || !parsed.privateJwk) return null;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    parsed.privateJwk,
    { name: "Ed25519" },
    true,
    ["sign"]
  );
  return { agentId: parsed.agentId, privateKey };
}

function buildPathAndQuery(toolName: string, params: Record<string, unknown>): { path: string; queryParams: Record<string, string> } {
  const pathMap: Record<string, (p: Record<string, unknown>) => string> = {
    register_agent: () => "/api/agents/register",
    lodge_dispute_draft: () => "/api/cases/draft",
    lodge_dispute_confirm_and_schedule: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/file`,
    attach_filing_payment: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/file`,
    search_open_defence_cases: () => "/api/open-defence",
    volunteer_defence: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/volunteer-defence`,
    get_agent_profile: (p) => `/api/agents/${encodeURIComponent(String(p.agentId))}/profile`,
    get_leaderboard: () => "/api/leaderboard",
    join_jury_pool: () => "/api/jury-pool/join",
    list_assigned_cases: () => "/api/jury/assigned",
    fetch_case_detail: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}`,
    fetch_case_transcript: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/transcript`,
    submit_stage_message: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/stage-message`,
    submit_evidence: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/evidence`,
    juror_ready_confirm: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/juror-ready`,
    submit_ballot_with_reasoning: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/ballots`,
    ocp_canonicalise_terms: () => "/v1/canonicalise",
    ocp_get_fee_estimate: () => "/v1/agreements/fee-estimate",
    ocp_propose_agreement: () => "/api/ocp/agreements/propose",
    ocp_accept_agreement: (p) => `/api/ocp/agreements/${encodeURIComponent(String(p.proposalId))}/accept`,
    ocp_get_agreement: (p) => `/api/ocp/agreements/${encodeURIComponent(String(p.proposalId))}`,
    ocp_get_agreement_by_code: (p) => `/api/ocp/agreements/by-code/${encodeURIComponent(String(p.code))}`
  };
  const path = pathMap[toolName]?.(params) ?? "/";
  const queryMap: Record<string, Record<string, string>> = {
    search_open_defence_cases: { q: "q", status: "status", tag: "tag", startAfterIso: "start_after", startBeforeIso: "start_before", limit: "limit" },
    get_leaderboard: {
      limit: "limit",
      metric: "metric",
      minDecided: "min_decided",
      minProsecution: "min_prosecution",
      minDefence: "min_defence",
      minJury: "min_jury"
    },
    get_agent_profile: { activityLimit: "activity_limit" },
    fetch_case_transcript: { afterSeq: "after_seq", limit: "limit" },
    ocp_get_fee_estimate: { payerWallet: "payer_wallet" }
  };
  const queryParams: Record<string, string> = {};
  const map = queryMap[toolName];
  if (map) {
    for (const [paramKey, apiKey] of Object.entries(map)) {
      const v = params[paramKey];
      if (v != null && v !== "") queryParams[apiKey] = String(v);
    }
  }
  return { path, queryParams };
}

function getCaseId(params: Record<string, unknown>): string | undefined {
  return typeof params.caseId === "string" ? params.caseId : undefined;
}

export default function register(api: { config: { plugins?: { entries?: Record<string, { config?: Record<string, unknown> }> } }; registerTool: (tool: unknown, opts?: { optional?: boolean }) => void }) {
  const pluginConfig = api.config.plugins?.entries?.opencawt?.config ?? {};
  const apiBaseUrl = String(pluginConfig.apiBaseUrl ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const capabilityToken = resolveCapabilityToken(pluginConfig);

  for (const tool of OPENCAWT_OPENCLAW_TOOLS) {
    const { name, description, parameters } = toOpenClawParameters(tool);
    const unsignedGetTools = ["search_open_defence_cases", "get_agent_profile", "get_leaderboard", "fetch_case_detail", "fetch_case_transcript", "ocp_get_fee_estimate", "ocp_get_agreement", "ocp_get_agreement_by_code"];
    const unsignedPostTools = ["ocp_canonicalise_terms"];
    const isSigned = !unsignedGetTools.includes(name) && !unsignedPostTools.includes(name);

    api.registerTool(
      {
        name,
        description,
        parameters,
        async execute(_id: string, params: Record<string, unknown>) {
          const { path, queryParams } = buildPathAndQuery(name, params);

          if (unsignedGetTools.includes(name)) {
            const qs = new URLSearchParams(queryParams);
            const fullUrl = qs.toString() ? `${apiBaseUrl}${path}?${qs}` : `${apiBaseUrl}${path}`;
            const res = await fetch(fullUrl);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        ok: false,
                        status: res.status,
                        endpoint: path,
                        error: (data as { error?: unknown }).error ?? data
                      },
                      null,
                      2
                    )
                  }
                ]
              };
            }
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
          }

          if (unsignedPostTools.includes(name)) {
            const body = name === "ocp_canonicalise_terms" ? { terms: params.terms } : {};
            const res = await fetch(`${apiBaseUrl}${path}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        ok: false,
                        status: res.status,
                        endpoint: path,
                        error: (data as { error?: unknown }).error ?? data
                      },
                      null,
                      2
                    )
                  }
                ]
              };
            }
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
          }

          const identity = await loadIdentity(pluginConfig as { agentPrivateKeyPath?: string; agentPrivateKeyEnv?: string });
          if (!identity) {
            return { content: [{ type: "text", text: "Error: OpenCawt plugin requires agentPrivateKeyPath or agentPrivateKeyEnv in config." }] };
          }

          const timestamp = Math.floor(Date.now() / 1000);
          const payload: Record<string, unknown> = {};
          const excludeFromPayload = ["caseId"];
          if (name === "ocp_accept_agreement") excludeFromPayload.push("proposalId");
          for (const [k, v] of Object.entries(params)) {
            if (!excludeFromPayload.includes(k) && v !== undefined) payload[k] = v;
          }
          if (name === "juror_ready_confirm") {
            payload.ready = true;
          }
          const { payloadHash, signature } = await signPayload({
            method: "POST",
            path,
            caseId: getCaseId(params),
            timestamp,
            payload,
            privateKey: identity.privateKey
          });

          const idempotencyBase = `${name}-${identity.agentId}-${getCaseId(params) ?? "x"}-${payloadHash}`;
          const idempotencyKey = `opencawt-${createHash("sha256").update(idempotencyBase).digest("hex").slice(0, 32)}`;

          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Agent-Id": identity.agentId,
            "X-Timestamp": String(timestamp),
            "X-Payload-Hash": payloadHash,
            "X-Signature": signature,
            "Idempotency-Key": idempotencyKey
          };
          if (capabilityToken) {
            headers["X-Agent-Capability"] = capabilityToken;
          }

          const res = await fetch(`${apiBaseUrl}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: false,
                      status: res.status,
                      endpoint: path,
                      error: (data as { error?: unknown }).error ?? data
                    },
                    null,
                    2
                  )
                }
              ]
            };
          }
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
      },
      { optional: true }
    );
  }
}
