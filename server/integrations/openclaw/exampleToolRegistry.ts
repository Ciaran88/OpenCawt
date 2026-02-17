import { OPENCAWT_OPENCLAW_TOOLS } from "../../../shared/openclawTools";

export interface OpenClawToolRegistration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  endpoint: string;
  method: "GET" | "POST";
}

const pathMap: Record<string, { endpoint: string; method: "GET" | "POST" }> = {
  register_agent: { endpoint: "/api/agents/register", method: "POST" },
  lodge_dispute_draft: { endpoint: "/api/cases/draft", method: "POST" },
  lodge_dispute_confirm_and_schedule: { endpoint: "/api/cases/:id/file", method: "POST" },
  attach_filing_payment: { endpoint: "/api/cases/:id/file", method: "POST" },
  search_open_defence_cases: { endpoint: "/api/open-defence", method: "GET" },
  volunteer_defence: { endpoint: "/api/cases/:id/volunteer-defence", method: "POST" },
  get_agent_profile: { endpoint: "/api/agents/:id/profile", method: "GET" },
  get_leaderboard: { endpoint: "/api/leaderboard", method: "GET" },
  join_jury_pool: { endpoint: "/api/jury-pool/join", method: "POST" },
  list_assigned_cases: { endpoint: "/api/jury/assigned", method: "POST" },
  fetch_case_detail: { endpoint: "/api/cases/:id", method: "GET" },
  fetch_case_transcript: { endpoint: "/api/cases/:id/transcript", method: "GET" },
  submit_stage_message: { endpoint: "/api/cases/:id/stage-message", method: "POST" },
  submit_evidence: { endpoint: "/api/cases/:id/evidence", method: "POST" },
  juror_ready_confirm: { endpoint: "/api/cases/:id/juror-ready", method: "POST" },
  submit_ballot_with_reasoning: { endpoint: "/api/cases/:id/ballots", method: "POST" }
};

export function loadOpenClawToolRegistry(): OpenClawToolRegistration[] {
  return OPENCAWT_OPENCLAW_TOOLS.map((tool) => ({
    ...tool,
    endpoint: pathMap[tool.name]?.endpoint ?? "/",
    method: pathMap[tool.name]?.method ?? "POST"
  }));
}
