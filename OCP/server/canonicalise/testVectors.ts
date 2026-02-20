/**
 * OCP canonicaliser conformance test vectors.
 * These values were pinned by running the canonicaliser on known inputs.
 * Any change to the canonicaliser that produces different output here
 * requires a new protocol version.
 */

import type { CanonicalTerms } from "./index";

export interface TestVector {
  description: string;
  input: CanonicalTerms;
  expectedCanonicalJson: string;
  expectedTermsHash: string;
  expectedAgreementCode: string;
}

/**
 * Vector 1: Minimal two-party agreement.
 * Tests: basic canonicalisation, key sorting, party/obligation/consideration sorting.
 */
export const VECTOR_1: TestVector = {
  description: "Minimal two-party agreement with monetary consideration",
  input: {
    consideration: [
      {
        amount: 100,
        currency: "USD",
        fromAgentId: "AgentBBase58PublicKey2222",
        item: "payment",
        toAgentId: "AgentABase58PublicKey1111",
      },
    ],
    obligations: [
      {
        actorAgentId: "AgentABase58PublicKey1111",
        action: "deliver",
        deliverable: "Widget",
      },
    ],
    parties: [
      { agentId: "AgentABase58PublicKey1111", role: "party_a" },
      { agentId: "AgentBBase58PublicKey2222", role: "party_b" },
    ],
    termination: { conditions: "Completion of delivery." },
    timing: { dueAtIso: "2026-03-01T00:00:00.000Z" },
  },
  expectedCanonicalJson:
    '{"consideration":[{"amount":100,"currency":"USD","fromAgentId":"AgentBBase58PublicKey2222","item":"payment","toAgentId":"AgentABase58PublicKey1111"}],"obligations":[{"action":"deliver","actorAgentId":"AgentABase58PublicKey1111","deliverable":"Widget"}],"parties":[{"agentId":"AgentABase58PublicKey1111","role":"party_a"},{"agentId":"AgentBBase58PublicKey2222","role":"party_b"}],"termination":{"conditions":"Completion of delivery."},"timing":{"dueAtIso":"2026-03-01T00:00:00.000Z"}}',
  expectedTermsHash:
    "e790e5354b75b128c9588860537c4e6208b026c4653224a0a453fcac16811676",
  expectedAgreementCode: "PV4DBJZ9WQ",
};

/**
 * Vector 2: Agreement with optional fields, whitespace normalisation,
 * multiple obligations (both directions), and full termination block.
 * Tests: whitespace collapse ("API  integration" → "API integration"),
 *        undefined field stripping, multi-obligation sorting.
 */
export const VECTOR_2: TestVector = {
  description: "Multi-obligation agreement with whitespace and optional fields",
  input: {
    consideration: [
      {
        currency: "SOL",
        fromAgentId: "AgentCBase58PubKey3333",
        item: "token transfer",
        toAgentId: "AgentDBase58PubKey4444",
      },
    ],
    obligations: [
      {
        actorAgentId: "AgentCBase58PubKey3333",
        action: "integrate",
        conditions: "Upon receipt of payment.",
        deliverable: "API  integration", // double space — should be normalised
      },
      {
        actorAgentId: "AgentDBase58PubKey4444",
        action: "pay",
        deliverable: "SOL tokens",
      },
    ],
    parties: [
      { agentId: "AgentDBase58PubKey4444", role: "party_a" },
      { agentId: "AgentCBase58PubKey3333", role: "party_b" },
    ],
    termination: {
      breachRemedy: "Full refund within 7 days.",
      conditions: "Non-delivery after 30 days.",
    },
    timing: {
      dueAtIso: "2026-04-15T12:00:00.000Z",
      startAtIso: "2026-03-15T00:00:00.000Z",
    },
  },
  expectedCanonicalJson:
    '{"consideration":[{"currency":"SOL","fromAgentId":"AgentCBase58PubKey3333","item":"token transfer","toAgentId":"AgentDBase58PubKey4444"}],"obligations":[{"action":"integrate","actorAgentId":"AgentCBase58PubKey3333","conditions":"Upon receipt of payment.","deliverable":"API integration"},{"action":"pay","actorAgentId":"AgentDBase58PubKey4444","deliverable":"SOL tokens"}],"parties":[{"agentId":"AgentDBase58PubKey4444","role":"party_a"},{"agentId":"AgentCBase58PubKey3333","role":"party_b"}],"termination":{"breachRemedy":"Full refund within 7 days.","conditions":"Non-delivery after 30 days."},"timing":{"dueAtIso":"2026-04-15T12:00:00.000Z","startAtIso":"2026-03-15T00:00:00.000Z"}}',
  expectedTermsHash:
    "6fc15f11e186abcda48eb4635bf10fd1cb1058900563c16d2db34afca13d6ea9",
  expectedAgreementCode: "R36W4520R8",
};

export const ALL_VECTORS: TestVector[] = [VECTOR_1, VECTOR_2];
