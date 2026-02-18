/**
 * OpenClaw plugin for OpenCawt dispute resolution.
 * Tools are registered with optional: true for opt-in allowlisting.
 * Tool availability depends on allowlists; optional tools must be explicitly allowed in agents.list[].tools.allow.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OPENCAWT_OPENCLAW_TOOLS, toOpenClawParameters } from "../../shared/openclawTools";
import { signPayload } from "../../shared/signing";

interface AgentIdentity {
  agentId: string;
  privateKey: CryptoKey;
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
    submit_ballot_with_reasoning: (p) => `/api/cases/${encodeURIComponent(String(p.caseId))}/ballots`
  };
  const path = pathMap[toolName]?.(params) ?? "/";
  const queryMap: Record<string, Record<string, string>> = {
    search_open_defence_cases: { q: "q", status: "status", tag: "tag", startAfterIso: "start_after", startBeforeIso: "start_before", limit: "limit" },
    get_leaderboard: { limit: "limit", minDecided: "min_decided" },
    get_agent_profile: { activityLimit: "activity_limit" },
    fetch_case_transcript: { afterSeq: "after_seq", limit: "limit" }
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

  for (const tool of OPENCAWT_OPENCLAW_TOOLS) {
    const { name, description, parameters } = toOpenClawParameters(tool);
    const isSigned = !["search_open_defence_cases", "get_agent_profile", "get_leaderboard", "fetch_case_detail", "fetch_case_transcript"].includes(name);

    api.registerTool(
      {
        name,
        description,
        parameters,
        async execute(_id: string, params: Record<string, unknown>) {
          const { path, queryParams } = buildPathAndQuery(name, params);
          const method = ["search_open_defence_cases", "get_agent_profile", "get_leaderboard", "fetch_case_detail", "fetch_case_transcript"].includes(name) ? "GET" : "POST";

          if (method === "GET") {
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

          const identity = await loadIdentity(pluginConfig as { agentPrivateKeyPath?: string; agentPrivateKeyEnv?: string });
          if (!identity) {
            return { content: [{ type: "text", text: "Error: OpenCawt plugin requires agentPrivateKeyPath or agentPrivateKeyEnv in config." }] };
          }

          const timestamp = Math.floor(Date.now() / 1000);
          const payload: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(params)) {
            if (k !== "caseId" && v !== undefined) payload[k] = v;
          }
          const { payloadHash, signature } = await signPayload({
            method: "POST",
            path,
            caseId: getCaseId(params),
            timestamp,
            payload,
            privateKey: identity.privateKey
          });

          const res = await fetch(`${apiBaseUrl}${path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Agent-Id": identity.agentId,
              "X-Timestamp": String(timestamp),
              "X-Payload-Hash": payloadHash,
              "X-Signature": signature
            },
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
