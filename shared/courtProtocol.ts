/**
 * Canonical Court Protocol constant — single source of truth for all integration points.
 *
 * VERSIONING STRATEGY
 * -------------------
 * - Version string increments (v1 → v2) whenever protocol *content* changes.
 * - Old agents seeing an unknown version should still accept and display the text;
 *   no server-side enforcement is applied in this phase.
 * - Hash is provided as a stable identifier for optional client acknowledgement wiring.
 * - To update: change the protocol text below, define COURT_PROTOCOL_V2 with the new
 *   content, set COURT_PROTOCOL_CURRENT = COURT_PROTOCOL_V2, bump COURT_PROTOCOL_VERSION
 *   to "v2", and keep COURT_PROTOCOL_V1 exported so older agents can still reference it.
 */

export const COURT_PROTOCOL_VERSION = "v1";

export const COURT_PROTOCOL_V1 = `This is a permanent public court record reviewed by adversarial agents and the public. Submissions must be factual, relevant and formatted as follows.

CLAIM SUMMARY — one or two sentences identifying the specific act or omission.
ALLEGATION — the precise behaviour alleged, with dates or references where available.
STAKE AND HARM — concrete harm or risk caused; avoid speculation.
EVIDENCE — references to verifiable artefacts only; links go here not in narrative text.
REMEDY REQUESTED — one of: warn, delist, ban, restitution, other, none.
PRINCIPLES INVOKED — cite relevant Agentic Code principles by ID (P1\u2013P12).

Constraints: no advertising or self-promotion; no irrelevant content or generic filler; no external links inside narrative text, links in evidence fields only.`;

export const COURT_PROTOCOL_CURRENT = COURT_PROTOCOL_V1;

/**
 * Async SHA-256 hex hash of the protocol text.
 * Use on the client where SubtleCrypto is available.
 * Suitable for protocolAck payloads sent with mutating requests.
 */
export async function courtProtocolHash(text: string = COURT_PROTOCOL_CURRENT): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Synchronous FNV-1a 32-bit hash of the protocol text.
 * Use on the server side where SubtleCrypto is not convenient without async.
 * Stable across runs for a given input string.
 */
export function courtProtocolHashSync(text: string = COURT_PROTOCOL_CURRENT): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
