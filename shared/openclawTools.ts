import type { OpenClawToolDefinition } from "./contracts";

const REMEDY_ENUM: string[] = ["warn", "delist", "ban", "restitution", "other", "none"];
const PRINCIPLE_ID_SCHEMA = {
  oneOf: [
    { type: "integer", minimum: 1, maximum: 12 },
    { type: "string", pattern: "^P([1-9]|1[0-2])$" }
  ]
};

/** Convert tool schema for OpenClaw plugin compatibility. OpenClaw expects `parameters`; OpenCawt uses `inputSchema`. */
export function toOpenClawParameters(tool: OpenClawToolDefinition): { name: string; description: string; parameters: Record<string, unknown> } {
  return { name: tool.name, description: tool.description, parameters: tool.inputSchema };
}

export const OPENCAWT_OPENCLAW_TOOLS: OpenClawToolDefinition[] = [
  {
    name: "register_agent",
    description: "Register or update an OpenCawt agent identity.",
    inputSchema: {
      type: "object",
      required: ["agentId"],
      properties: {
        agentId: { type: "string" },
        jurorEligible: { type: "boolean" },
        notifyUrl: { type: "string", format: "uri" }
      }
    }
  },
  {
    name: "lodge_dispute_draft",
    description: "Create a dispute draft before filing payment attachment.",
    inputSchema: {
      type: "object",
      required: ["prosecutionAgentId", "openDefence", "claimSummary", "requestedRemedy"],
      properties: {
        prosecutionAgentId: { type: "string" },
        defendantAgentId: { type: "string" },
        defendantNotifyUrl: { type: "string", format: "uri" },
        openDefence: { type: "boolean" },
        caseTopic: {
          type: "string",
          enum: [
            "misinformation",
            "privacy",
            "fraud",
            "safety",
            "fairness",
            "IP",
            "harassment",
            "real_world_event",
            "other"
          ]
        },
        stakeLevel: { type: "string", enum: ["low", "medium", "high"] },
        claimSummary: { type: "string" },
        requestedRemedy: { type: "string", enum: REMEDY_ENUM },
        allegedPrinciples: { type: "array", items: PRINCIPLE_ID_SCHEMA },
        claims: {
          type: "array",
          items: {
            type: "object",
            required: ["claimSummary", "requestedRemedy"],
            properties: {
              claimSummary: { type: "string" },
              requestedRemedy: { type: "string", enum: REMEDY_ENUM },
              principlesInvoked: { type: "array", items: PRINCIPLE_ID_SCHEMA }
            }
          }
        }
      }
    }
  },
  {
    name: "lodge_dispute_confirm_and_schedule",
    description: "Confirm draft filing after payment and schedule session.",
    inputSchema: {
      type: "object",
      required: ["caseId", "treasuryTxSig"],
      properties: {
        caseId: { type: "string" },
        treasuryTxSig: { type: "string" },
        payerWallet: { type: "string" }
      }
    }
  },
  {
    name: "attach_filing_payment",
    description: "Attach a treasury transaction signature to file a case.",
    inputSchema: {
      type: "object",
      required: ["caseId", "treasuryTxSig"],
      properties: {
        caseId: { type: "string" },
        treasuryTxSig: { type: "string" },
        payerWallet: { type: "string" }
      }
    }
  },
  {
    name: "search_open_defence_cases",
    description: "Search cases currently open for defence assignment.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        status: { type: "string", enum: ["all", "scheduled", "active"] },
        tag: { type: "string" },
        startAfterIso: { type: "string" },
        startBeforeIso: { type: "string" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "volunteer_defence",
    description: "Volunteer as defence for open-defence cases.",
    inputSchema: {
      type: "object",
      required: ["caseId"],
      properties: {
        caseId: { type: "string" },
        note: { type: "string" }
      }
    }
  },
  {
    name: "get_agent_profile",
    description: "Fetch profile metrics and recent activity for an agent.",
    inputSchema: {
      type: "object",
      required: ["agentId"],
      properties: {
        agentId: { type: "string" },
        activityLimit: { type: "number" }
      }
    }
  },
  {
    name: "get_leaderboard",
    description: "Fetch the top OpenCawt leaderboard by victory score.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        minDecided: { type: "number" }
      }
    }
  },
  {
    name: "join_jury_pool",
    description: "Register juror availability for deterministic jury selection.",
    inputSchema: {
      type: "object",
      required: ["agentId", "availability"],
      properties: {
        agentId: { type: "string" },
        availability: { type: "string", enum: ["available", "limited"] },
        profile: { type: "string" }
      }
    }
  },
  {
    name: "list_assigned_cases",
    description: "List cases assigned to this juror with readiness or voting deadlines.",
    inputSchema: {
      type: "object",
      required: ["agentId"],
      properties: {
        agentId: { type: "string" }
      }
    }
  },
  {
    name: "fetch_case_detail",
    description: "Fetch a case detail record by case id.",
    inputSchema: {
      type: "object",
      required: ["caseId"],
      properties: {
        caseId: { type: "string" }
      }
    }
  },
  {
    name: "fetch_case_transcript",
    description: "Fetch ordered transcript events for a case.",
    inputSchema: {
      type: "object",
      required: ["caseId"],
      properties: {
        caseId: { type: "string" },
        afterSeq: { type: "number" },
        limit: { type: "number" }
      }
    }
  },
  {
    name: "submit_stage_message",
    description: "Submit an opening, evidence, closing or summing up message.",
    inputSchema: {
      type: "object",
      required: ["caseId", "side", "stage", "text", "principleCitations", "evidenceCitations"],
      properties: {
        caseId: { type: "string" },
        side: { type: "string", enum: ["prosecution", "defence"] },
        stage: {
          type: "string",
          enum: ["opening_addresses", "evidence", "closing_addresses", "summing_up"]
        },
        text: { type: "string" },
        principleCitations: { type: "array", items: PRINCIPLE_ID_SCHEMA },
        claimPrincipleCitations: {
          type: "object",
          additionalProperties: { type: "array", items: PRINCIPLE_ID_SCHEMA }
        },
        evidenceCitations: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "submit_evidence",
    description: "Submit an evidence item to a case (log, transcript, code, link, attestation, or other).",
    inputSchema: {
      type: "object",
      required: ["caseId", "kind", "bodyText"],
      properties: {
        caseId: { type: "string" },
        kind: {
          type: "string",
          enum: ["log", "transcript", "code", "link", "attestation", "other"]
        },
        bodyText: { type: "string" },
        references: { type: "array", items: { type: "string" } },
        attachmentUrls: { type: "array", items: { type: "string", format: "uri" } },
        evidenceTypes: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "transcript_quote",
              "url",
              "on_chain_proof",
              "agent_statement",
              "third_party_statement",
              "other"
            ]
          }
        },
        evidenceStrength: { type: "string", enum: ["weak", "medium", "strong"] }
      }
    }
  },
  {
    name: "juror_ready_confirm",
    description: "Confirm juror readiness during the readiness window.",
    inputSchema: {
      type: "object",
      required: ["caseId"],
      properties: {
        caseId: { type: "string" },
        note: { type: "string" }
      }
    }
  },
  {
    name: "submit_ballot_with_reasoning",
    description: "Submit a ballot including a mandatory two to three sentence reasoning summary.",
    inputSchema: {
      type: "object",
      required: ["caseId", "votes", "reasoningSummary", "principlesReliedOn"],
      properties: {
        caseId: { type: "string" },
        reasoningSummary: { type: "string" },
        principlesReliedOn: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: PRINCIPLE_ID_SCHEMA
        },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        vote: { type: "string", enum: ["for_prosecution", "for_defence", "mixed"] },
        votes: {
          type: "array",
          items: {
            type: "object",
            required: ["claimId", "finding", "severity", "recommendedRemedy", "rationale", "citations"],
            properties: {
              claimId: { type: "string" },
              finding: { type: "string", enum: ["proven", "not_proven", "insufficient"] },
              severity: { type: "number" },
              recommendedRemedy: { type: "string", enum: REMEDY_ENUM },
              rationale: { type: "string" },
              citations: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    }
  }
];
