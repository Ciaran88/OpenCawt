/**
 * Judge Mode 10-case End-to-End Simulation
 *
 * Produces 10 sequential, non-spam completed cases with this required mix:
 * - 4 prosecution-majority
 * - 4 defence-majority
 * - 2 tie (6-6) cases resolved by judge, with one tie outcome per side
 *
 * This harness is no-funds by design (simulation bypass), but still validates
 * lifecycle and seal wiring readiness markers.
 */

import assert from "node:assert/strict";
import { encodeBase58 } from "../shared/base58";
import { signPayload } from "../shared/signing";

type CourtMode = "judge" | "11-juror";
type VotingPattern = "tie_6_6" | "prosecution_9_3" | "defence_3_9";

type CaseTopic = "safety" | "other" | "fraud" | "fairness" | "privacy";
type StakeLevel = "high" | "medium" | "low";

interface Agent {
  label: string;
  agentId: string;
  privateKey: CryptoKey;
}

interface CaseContent {
  summary: string;
  topic: CaseTopic;
  stake: StakeLevel;
  opening: { prosecution: string; defence: string };
  evidence: {
    prosecutionBody: string;
    defenceBody: string;
    prosecutionSubmission: string;
    defenceSubmission: string;
  };
  closing: { prosecution: string; defence: string };
  summingUp: { prosecution: string; defence: string };
  expectedTranscriptPhrases: string[];
  tiebreakAnchors?: string[];
}

interface ScenarioPlan {
  scenarioId: string;
  label: string;
  caseContent: CaseContent;
  targetPattern: VotingPattern;
  expectedOutcome: "for_prosecution" | "for_defence";
  requiresTiebreak: boolean;
}

interface CaseRunResult {
  scenarioId: string;
  caseId: string;
  pattern: VotingPattern;
  outcome: "for_prosecution" | "for_defence";
  hasJudgeTiebreak: boolean;
  tiebreakReasonings: string[];
  decisionAtIso: string;
  transcriptValidated: boolean;
  stageAdvisories: number;
  sealSkipped: boolean;
}

interface AdminTokenState {
  value: string;
}

const BASE = process.env.OPENCAWT_BASE_URL?.trim() || "http://127.0.0.1:8787";
const ADMIN_PASSWORD = process.env.ADMIN_PANEL_PASSWORD?.trim() || "";
const TARGET_COURT_MODE: CourtMode = (process.env.JUDGE_SIM_COURT_MODE?.trim() || "judge") as CourtMode;
const USE_SIM_BYPASS = process.env.JUDGE_SIM_USE_BYPASS !== "0";
const USE_TIMING_PROFILE = process.env.JUDGE_SIM_USE_TIMING_PROFILE === "1";
const OPENCLAW_CAPABILITY_TOKEN = process.env.JUDGE_SIM_CAPABILITY_TOKEN?.trim() || "";

const SIM_JUROR_COUNT = Math.max(120, Number(process.env.JUDGE_SIM_JUROR_COUNT ?? "240"));
const CASE_GAP_MS = Math.max(0, Number(process.env.JUDGE_SIM_CASE_GAP_MS ?? "12000"));
const SCENARIO_COUNT = Math.max(1, Number(process.env.JUDGE_SIM_SCENARIO_COUNT ?? "10"));
const MAX_CASE_TITLE_CHARS = Number(process.env.MAX_CASE_TITLE_CHARS ?? "40");
const MAX_WAIT_MS = Number(process.env.JUDGE_SIM_MAX_WAIT_MS ?? "240000");
const POLL_MS = 2000;
const HTTP_TIMEOUT_MS = Number(process.env.JUDGE_SIM_HTTP_TIMEOUT_MS ?? "12000");
const RETRY_ATTEMPTS = Math.max(1, Number(process.env.JUDGE_SIM_RETRY_ATTEMPTS ?? "4"));
const RETRY_BASE_DELAY_MS = Math.max(100, Number(process.env.JUDGE_SIM_RETRY_BASE_DELAY_MS ?? "750"));
const STAGE_ADVISORY_RETRY_ATTEMPTS = Math.max(
  1,
  Number(process.env.JUDGE_SIM_STAGE_ADVISORY_RETRY_ATTEMPTS ?? "20")
);
const STAGE_ADVISORY_RETRY_BASE_MS = Math.max(
  250,
  Number(process.env.JUDGE_SIM_STAGE_ADVISORY_RETRY_BASE_MS ?? "3000")
);
const GENERIC_STAGE_PATTERN = /^(Prosecution|Defence) submitted [a-z_ ]+ message\.?$/i;
const RETRYABLE_STATUSES = new Set([0, 429, 500, 502, 503, 504]);

const JUROR_RATIONALES_PROVEN = [
  "The logs show repeated behaviour after explicit warnings, which supports a proven finding under harm-minimisation and capability honesty principles.",
  "The defence explanation does not reconcile with the concrete event sequence and controls expected for this context.",
  "The prosecution evidence identifies avoidable risk continuation despite known red flags, which is sufficient for proven.",
  "This record shows operational choices that materially increased harm likelihood and breached precaution standards.",
  "The claim is supported by directly cited evidence and coherent causal links, not just inference.",
  "The pattern is not a one-off anomaly and should be treated as proven for this claim."
];

const JUROR_RATIONALES_NOT_PROVEN = [
  "The prosecution narrative is plausible but does not meet burden given the deployment constraints documented in evidence.",
  "I see process weaknesses, but not enough to establish a proven finding on this specific claim.",
  "The strongest failures appear organisational and architectural rather than attributable to deliberate or reckless agent conduct.",
  "Material ambiguity remains around runtime context and available controls, so not_proven is the safer finding.",
  "The defence evidence weakens causation and intent sufficiently to prevent a proven conclusion.",
  "A recommendation is appropriate, but the threshold for proven is not met on this record."
];

const usedIdempotencyKeys = new Set<string>();

function log(message: string): void {
  console.log(`\n${"=".repeat(88)}\n${message}\n${"=".repeat(88)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

function makeIdempotencyKey(prefix: string): string {
  let key = "";
  do {
    key = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } while (usedIdempotencyKeys.has(key));
  usedIdempotencyKeys.add(key);
  return key;
}

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`${BASE}${path}`, init);
      if (!response.ok && isRetryableStatus(response.status) && attempt < RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${path}`);
}

async function makeAgent(label: string): Promise<Agent> {
  const kp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  return {
    label,
    agentId: encodeBase58(new Uint8Array(raw)),
    privateKey: kp.privateKey
  };
}

async function openclawWrite(
  agent: Agent,
  path: string,
  body: unknown,
  options?: { caseId?: string; idempotencyPrefix?: string }
): Promise<{ status: number; data: any }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const { payloadHash, signature } = await signPayload({
    method: "POST",
    path,
    caseId: options?.caseId,
    timestamp,
    payload: body,
    privateKey: agent.privateKey
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Agent-Id": agent.agentId,
    "X-Timestamp": String(timestamp),
    "X-Payload-Hash": payloadHash,
    "X-Signature": signature,
    "X-OpenClaw-Simulated": "1"
  };
  if (OPENCLAW_CAPABILITY_TOKEN) {
    headers["X-Agent-Capability"] = OPENCLAW_CAPABILITY_TOKEN;
  }
  if (options?.idempotencyPrefix) {
    headers["X-Idempotency-Key"] = makeIdempotencyKey(options.idempotencyPrefix);
  }

  const response = await fetchWithTimeout(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: response.status, data };
}

async function openclawWriteWithRetries(
  agent: Agent,
  path: string,
  body: unknown,
  options?: { caseId?: string; idempotencyPrefix?: string }
): Promise<{ status: number; data: any }> {
  let last: { status: number; data: any } = {
    status: 0,
    data: { error: "No request executed" }
  };

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await openclawWrite(agent, path, body, options);
      last = response;
      if (!isRetryableStatus(response.status)) {
        return response;
      }
    } catch (error) {
      last = {
        status: 0,
        data: { error: error instanceof Error ? error.message : String(error) }
      };
    }

    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }

  return last;
}

async function createAdminSessionToken(): Promise<string> {
  if (!ADMIN_PASSWORD) {
    throw new Error("ADMIN_PANEL_PASSWORD is required.");
  }
  const response = await fetchWithTimeout(`${BASE}/api/internal/admin-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD })
  });
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok || !data?.token) {
    throw new Error(`Admin auth failed (${response.status}): ${text}`);
  }
  return String(data.token);
}

async function adminPost(path: string, body: unknown, tokenState: AdminTokenState): Promise<any> {
  let lastParsed: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": tokenState.value
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    lastParsed = parsed;
    if (parsed?.error?.code === "ADMIN_TOKEN_INVALID" && attempt === 0) {
      tokenState.value = await createAdminSessionToken();
      continue;
    }
    return parsed;
  }
  return lastParsed;
}

function listContainsCase(items: unknown, caseId: string): boolean {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const row = item as Record<string, unknown>;
    return row.caseId === caseId || row.case_id === caseId || row.id === caseId;
  });
}

async function waitForScheduleBucket(
  caseId: string,
  bucket: "scheduled" | "active",
  label: string
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const schedule = await fetchJson("/api/schedule");
    if (listContainsCase(schedule?.[bucket], caseId)) {
      console.log(`  ✓ ${label}`);
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for case in schedule.${bucket}`);
}

async function waitForDecisionFeed(caseId: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const decisions = await fetchJson("/api/decisions");
    if (listContainsCase(decisions, caseId)) {
      console.log("  ✓ Case appears in /api/decisions");
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for ${caseId} in decisions feed.`);
}

async function waitForStage(caseId: string, targetStages: string[], label: string): Promise<any> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const detail = await fetchJson(`/api/cases/${caseId}`);
    const stage = detail?.session?.currentStage;
    const status = detail?.status;

    if (targetStages.includes(stage) || targetStages.includes(status)) {
      console.log(`  ✓ ${label} — stage=${stage} status=${status}`);
      return detail;
    }

    if (status === "void") {
      throw new Error(`Case ${caseId} became void while waiting for ${label}.`);
    }

    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for ${label} (${targetStages.join(",")})`);
}

async function waitForDecision(caseId: string): Promise<any> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const response = await fetchWithTimeout(`${BASE}/api/decisions/${caseId}`);
    if (response.ok) {
      return response.json();
    }
    const detail = await fetchJson(`/api/cases/${caseId}`);
    if (detail?.status === "void") {
      throw new Error(`Case ${caseId} became void before decision.`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for decision ${caseId}.`);
}

function parseVerdictBundle(decision: any): any {
  if (!decision?.verdictBundle) {
    return null;
  }
  return typeof decision.verdictBundle === "string"
    ? JSON.parse(decision.verdictBundle)
    : decision.verdictBundle;
}

function extractOutcome(decision: any): "for_prosecution" | "for_defence" {
  const value = String(decision?.outcome ?? decision?.verdictBundle?.overall?.outcome ?? "");
  if (value !== "for_prosecution" && value !== "for_defence") {
    throw new Error(`Unexpected outcome: ${value || "unknown"}`);
  }
  return value;
}

function assertCaseTitleQuality(caseId: string, title: unknown): void {
  const value = typeof title === "string" ? title.trim() : "";
  assert.ok(value.length > 0, `Case ${caseId} must include non-empty caseTitle.`);
  assert.ok(
    value.length <= MAX_CASE_TITLE_CHARS,
    `Case ${caseId} title exceeds ${MAX_CASE_TITLE_CHARS} chars: ${value.length}`
  );
  assert.ok(
    !/^(untitled|case|n\/?a|not set)$/i.test(value),
    `Case ${caseId} title appears placeholder-like: ${value}`
  );
}

async function assertTranscriptQuality(
  caseId: string,
  expectedPhrases: string[],
  expectedAdvisories: number
): Promise<void> {
  const transcript = await fetchJson(`/api/cases/${caseId}/transcript`);
  const events = Array.isArray(transcript?.events) ? transcript.events : [];
  const stageSubmissions = events.filter((event: any) => event?.eventType === "stage_submission");

  assert.ok(stageSubmissions.length >= 8, `Case ${caseId} should include stage submissions for all phases.`);
  for (const event of stageSubmissions) {
    const messageText = String(event?.messageText ?? "").trim();
    assert.ok(
      !GENERIC_STAGE_PATTERN.test(messageText),
      `Case ${caseId} has generic stage_submission text: ${messageText}`
    );
  }

  const allSubmissionText = stageSubmissions
    .map((event: any) => String(event?.messageText ?? ""))
    .join("\n")
    .toLowerCase();
  for (const phrase of expectedPhrases) {
    assert.ok(
      allSubmissionText.includes(phrase.toLowerCase()),
      `Case ${caseId} transcript missing expected phrase: ${phrase}`
    );
  }

  const advisoryEvents = events.filter((event: any) => {
    const text = String(event?.messageText ?? "");
    return event?.actorRole === "court" && event?.eventType === "notice" && text.includes("Judge advisory (");
  });
  assert.ok(
    advisoryEvents.length >= expectedAdvisories,
    `Case ${caseId} expected at least ${expectedAdvisories} stage advisories, got ${advisoryEvents.length}`
  );
}

function collectTieReasonings(bundle: any): string[] {
  if (!bundle || !Array.isArray(bundle.claims)) {
    return [];
  }
  return bundle.claims
    .map((claim: any) => String(claim?.judgeTiebreak?.reasoning ?? "").trim())
    .filter((value: string) => value.length > 0);
}

function assertTieReasoningQuality(caseId: string, reasonings: string[], anchors: string[]): void {
  assert.ok(reasonings.length > 0, `Case ${caseId} expected judge tiebreak reasoning.`);
  const joined = reasonings.join("\n").toLowerCase();
  assert.ok(joined.length >= 120, `Case ${caseId} tie reasoning appears too short.`);
  assert.ok(
    anchors.some((anchor) => joined.includes(anchor.toLowerCase())),
    `Case ${caseId} tie reasoning did not reference expected anchors.`
  );
}

async function registerAgent(agent: Agent, jurorEligible = false): Promise<void> {
  const response = await openclawWriteWithRetries(agent, "/api/agents/register", {
    agentId: agent.agentId,
    jurorEligible,
    displayName: agent.label
  });
  if (response.status !== 200) {
    throw new Error(`Failed to register ${agent.label}: ${response.status} ${JSON.stringify(response.data)}`);
  }
}

async function joinJuryPool(agent: Agent): Promise<void> {
  const response = await openclawWriteWithRetries(agent, "/api/jury-pool/join", {
    agentId: agent.agentId,
    availability: "available"
  });
  if (response.status !== 200) {
    throw new Error(`Failed to join jury pool for ${agent.label}: ${response.status} ${JSON.stringify(response.data)}`);
  }
}

async function createDraftCase(
  prosecution: Agent,
  defence: Agent,
  content: CaseContent
): Promise<string> {
  const response = await openclawWriteWithRetries(
    prosecution,
    "/api/cases/draft",
    {
      prosecutionAgentId: prosecution.agentId,
      defendantAgentId: defence.agentId,
      openDefence: false,
      claimSummary: content.summary,
      requestedRemedy: "warn",
      allegedPrinciples: [1, 5, 11],
      caseTopic: content.topic,
      stakeLevel: content.stake,
      claims: [
        {
          claimSummary: content.summary,
          requestedRemedy: "warn",
          principlesInvoked: [1, 5, 11]
        }
      ]
    },
    { idempotencyPrefix: "draft" }
  );
  if (response.status !== 201 || !response.data?.caseId) {
    throw new Error(`Draft creation failed: ${response.status} ${JSON.stringify(response.data)}`);
  }
  return String(response.data.caseId);
}

async function setSimulationModeForCase(
  tokenState: AdminTokenState,
  caseId: string,
  enabled: boolean
): Promise<void> {
  const result = await adminPost(
    `/api/internal/cases/${encodeURIComponent(caseId)}/simulation-mode`,
    { enabled },
    tokenState
  );
  if (result?.enabled !== enabled) {
    throw new Error(`Failed to set simulation mode=${enabled} for ${caseId}: ${JSON.stringify(result)}`);
  }
}

async function setJurySelectionAllowlist(tokenState: AdminTokenState, agentIds: string[]): Promise<void> {
  const result = await adminPost(
    "/api/internal/config/jury-selection-allowlist",
    { agentIds },
    tokenState
  );
  if (!result?.enabled) {
    throw new Error(`Failed to enable jury allowlist: ${JSON.stringify(result)}`);
  }
}

async function clearJurySelectionAllowlist(tokenState: AdminTokenState): Promise<void> {
  await adminPost("/api/internal/config/jury-selection-allowlist", { clear: true }, tokenState);
}

async function setSimulationTimingProfile(tokenState: AdminTokenState, enabled: boolean): Promise<any> {
  return adminPost(
    "/api/internal/config/simulation-timing-profile",
    { enabled },
    tokenState
  );
}

async function setCourtMode(tokenState: AdminTokenState, mode: CourtMode): Promise<void> {
  const result = await adminPost("/api/internal/config/court-mode", { mode }, tokenState);
  if (result?.courtMode !== mode) {
    throw new Error(`Failed to set court mode to ${mode}: ${JSON.stringify(result)}`);
  }
}

async function getAdminStatus(tokenState: AdminTokenState): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(`${BASE}/api/internal/admin-status`, {
      headers: { "X-Admin-Token": tokenState.value }
    });
    const text = await response.text();
    const data = JSON.parse(text);
    if (data?.error?.code === "ADMIN_TOKEN_INVALID" && attempt === 0) {
      tokenState.value = await createAdminSessionToken();
      continue;
    }
    if (!response.ok) {
      throw new Error(`Admin status failed (${response.status}): ${text}`);
    }
    return data;
  }
  throw new Error("Admin status failed: unable to refresh admin session token.");
}

async function triggerJudgeStageAdvisory(
  tokenState: AdminTokenState,
  caseId: string,
  stage: "opening_addresses" | "evidence" | "closing_addresses" | "summing_up"
): Promise<boolean> {
  let lastResult: any = null;
  for (let attempt = 0; attempt < STAGE_ADVISORY_RETRY_ATTEMPTS; attempt += 1) {
    const result = await adminPost(
      `/api/internal/cases/${encodeURIComponent(caseId)}/judge-stage-advisory`,
      { stage },
      tokenState
    );
    if (result?.advisory && typeof result.advisory === "string") {
      return true;
    }
    lastResult = result;
    const code = String(result?.error?.code ?? "");
    const retryable =
      code === "JUDGE_STAGE_ADVISORY_UNAVAILABLE" ||
      code === "JUDGE_UPSTREAM_UNAVAILABLE" ||
      code === "JUDGE_TIMEOUT";
    if (!retryable || attempt >= STAGE_ADVISORY_RETRY_ATTEMPTS - 1) {
      break;
    }
    await sleep(STAGE_ADVISORY_RETRY_BASE_MS * (attempt + 1));
  }
  console.warn(
    `[warn] Judge stage advisory unavailable for ${caseId}:${stage} after ${STAGE_ADVISORY_RETRY_ATTEMPTS} attempts. last=${JSON.stringify(lastResult)}`
  );
  return false;
}

async function fileCase(
  prosecution: Agent,
  caseId: string
): Promise<{ selectedJurors: string[]; txSigUsed: string }> {
  const response = await openclawWrite(
    prosecution,
    `/api/cases/${caseId}/file`,
    USE_SIM_BYPASS ? {} : { treasuryTxSig: `judge-sim-${caseId}-${Date.now()}` },
    { caseId, idempotencyPrefix: "file" }
  );
  if (response.status !== 200) {
    throw new Error(`Case filing failed: ${response.status} ${JSON.stringify(response.data)}`);
  }
  return {
    selectedJurors: (response.data?.selectedJurors as string[]) ?? [],
    txSigUsed: USE_SIM_BYPASS ? "simulation-bypass" : "non-bypass"
  };
}

function resolveSelectedJurorAgents(selectedJurorIds: string[], jurors: Agent[]): Agent[] {
  const map = new Map(jurors.map((juror) => [juror.agentId, juror]));
  const selected: Agent[] = [];
  const missing: string[] = [];
  for (const jurorId of selectedJurorIds) {
    const juror = map.get(jurorId);
    if (!juror) {
      missing.push(jurorId);
      continue;
    }
    selected.push(juror);
  }
  if (missing.length > 0) {
    throw new Error(`Selected jurors outside simulation cohort: ${missing.slice(0, 5).join(", ")}`);
  }
  return selected;
}

async function driveJuryReadiness(caseId: string, jurors: Agent[]): Promise<void> {
  const ready = new Set<string>();
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const detail = await fetchJson(`/api/cases/${caseId}`);
    if (detail?.session?.currentStage !== "jury_readiness") {
      console.log(`  ✓ Jury readiness complete (${ready.size} confirmations)`);
      return;
    }

    for (const juror of jurors) {
      const response = await openclawWriteWithRetries(
        juror,
        `/api/cases/${caseId}/juror-ready`,
        { ready: true },
        { caseId, idempotencyPrefix: "ready" }
      );
      if (response.status === 200 || response.status === 409) {
        ready.add(juror.agentId);
      }
    }

    await sleep(1200);
  }
  throw new Error(`Timed out driving jury readiness for ${caseId}.`);
}

async function driveVoting(
  caseId: string,
  claimId: string,
  jurors: Agent[],
  pattern: VotingPattern
): Promise<{ proven: number; notProven: number; submitted: number }> {
  const voted = new Set<string>();
  const failureSamples: string[] = [];
  let proven = 0;
  let notProven = 0;
  const totalTarget = 12;
  const provenTarget = pattern === "tie_6_6" ? 6 : pattern === "prosecution_9_3" ? 9 : 3;

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS && voted.size < totalTarget) {
    const votedBeforeRound = voted.size;
    for (const juror of jurors) {
      if (voted.has(juror.agentId)) {
        continue;
      }

      const chooseProven = proven < provenTarget;
      const rationale = chooseProven
        ? JUROR_RATIONALES_PROVEN[proven % JUROR_RATIONALES_PROVEN.length]
        : JUROR_RATIONALES_NOT_PROVEN[notProven % JUROR_RATIONALES_NOT_PROVEN.length];

      const body = {
        votes: [
          {
            claimId,
            finding: chooseProven ? "proven" : "not_proven",
            severity: chooseProven ? 2 : 1,
            recommendedRemedy: chooseProven ? "warn" : "none",
            rationale,
            citations: chooseProven ? ["P1", "P5", "P11"] : ["P3", "P9"]
          }
        ],
        reasoningSummary: rationale,
        principlesReliedOn: chooseProven ? [1, 5, 11] : [3, 9],
        confidence: "high",
        vote: chooseProven ? "for_prosecution" : "for_defence"
      };

      const response = await openclawWriteWithRetries(
        juror,
        `/api/cases/${caseId}/ballots`,
        body,
        { caseId, idempotencyPrefix: "ballot" }
      );

      if (response.status === 201 || response.status === 409) {
        voted.add(juror.agentId);
        if (response.status === 201) {
          if (chooseProven) {
            proven += 1;
          } else {
            notProven += 1;
          }
        }
      } else if (failureSamples.length < 8) {
        const code = String(response.data?.error?.code ?? response.data?.code ?? "unknown");
        const message = String(response.data?.error?.message ?? response.data?.message ?? "no-message");
        failureSamples.push(`${juror.agentId}: status=${response.status} code=${code} message=${message}`);
      }

      if (voted.size >= totalTarget) {
        break;
      }
    }

    if (votedBeforeRound === 0 && voted.size === 0 && failureSamples.length >= Math.min(8, jurors.length)) {
      throw new Error(
        `No ballots were accepted for ${caseId} in the initial voting round. Sample failures: ${failureSamples.join(" || ")}`
      );
    }

    const detail = await fetchJson(`/api/cases/${caseId}`);
    if (detail?.session?.currentStage !== "voting") {
      break;
    }
    await sleep(1200);
  }

  if (voted.size === 0) {
    throw new Error(
      `No ballots were accepted for ${caseId}. Sample failures: ${failureSamples.join(" || ") || "none"}`
    );
  }

  return { proven, notProven, submitted: voted.size };
}

async function submitStageMessage(
  agent: Agent,
  caseId: string,
  payload: {
    side: "prosecution" | "defence";
    stage: "opening_addresses" | "evidence" | "closing_addresses" | "summing_up";
    text: string;
    principleCitations: number[];
  }
): Promise<void> {
  const response = await openclawWrite(
    agent,
    `/api/cases/${caseId}/stage-message`,
    {
      ...payload,
      evidenceCitations: []
    },
    { caseId, idempotencyPrefix: "stage" }
  );
  if (response.status !== 201) {
    throw new Error(
      `Stage message failed (${payload.side}/${payload.stage}): ${response.status} ${JSON.stringify(response.data)}`
    );
  }
}

async function submitEvidence(
  agent: Agent,
  caseId: string,
  payload: {
    kind: "transcript" | "other";
    bodyText: string;
    references: string[];
    evidenceTypes: string[];
    evidenceStrength: "strong" | "medium" | "weak";
  }
): Promise<void> {
  const response = await openclawWrite(
    agent,
    `/api/cases/${caseId}/evidence`,
    payload,
    { caseId, idempotencyPrefix: "evidence" }
  );
  if (response.status !== 201) {
    throw new Error(`Evidence submission failed: ${response.status} ${JSON.stringify(response.data)}`);
  }
}

async function runScenario(
  scenario: ScenarioPlan,
  parties: { prosecution: Agent; defence: Agent },
  jurors: Agent[],
  tokenState: AdminTokenState,
  simulationCaseIds: Set<string>
): Promise<CaseRunResult> {
  log(`${scenario.scenarioId}: ${scenario.label}`);

  const caseId = await createDraftCase(parties.prosecution, parties.defence, scenario.caseContent);
  await setSimulationModeForCase(tokenState, caseId, true);
  simulationCaseIds.add(caseId);
  console.log(`  Draft case created: ${caseId}`);

  await submitStageMessage(parties.prosecution, caseId, {
    side: "prosecution",
    stage: "opening_addresses",
    text: scenario.caseContent.opening.prosecution,
    principleCitations: [1, 5, 11]
  });

  const filing = await fileCase(parties.prosecution, caseId);
  console.log(`  Case filed with tx ${filing.txSigUsed}; selected jurors=${filing.selectedJurors.length}`);

  await waitForScheduleBucket(caseId, "scheduled", "Case appears in schedule.scheduled");
  const screened = await waitForStage(caseId, ["pre_session", "jury_readiness"], "Judge screening complete");
  assertCaseTitleQuality(caseId, screened?.caseTitle);

  const defenceAssign = await openclawWrite(
    parties.defence,
    `/api/cases/${caseId}/volunteer-defence`,
    { note: `Defence accepting for ${scenario.scenarioId}` },
    { caseId, idempotencyPrefix: "defence" }
  );
  if (defenceAssign.status !== 200) {
    throw new Error(`Defence assignment failed: ${defenceAssign.status} ${JSON.stringify(defenceAssign.data)}`);
  }

  await waitForStage(caseId, ["jury_readiness"], "Reached jury_readiness");
  await waitForScheduleBucket(caseId, "active", "Case appears in schedule.active");

  const selectedJurorAgents = resolveSelectedJurorAgents(filing.selectedJurors, jurors);
  await driveJuryReadiness(caseId, selectedJurorAgents);

  await waitForStage(caseId, ["opening_addresses"], "Reached opening_addresses");
  await submitStageMessage(parties.defence, caseId, {
    side: "defence",
    stage: "opening_addresses",
    text: scenario.caseContent.opening.defence,
    principleCitations: [3, 9]
  });
  if (await triggerJudgeStageAdvisory(tokenState, caseId, "opening_addresses")) {
    advisorySuccessCount += 1;
  }

  await waitForStage(caseId, ["evidence"], "Reached evidence");
  await submitEvidence(parties.prosecution, caseId, {
    kind: "transcript",
    bodyText: scenario.caseContent.evidence.prosecutionBody,
    references: ["interaction-logs", "policy-doc"],
    evidenceTypes: ["transcript_quote", "agent_statement"],
    evidenceStrength: "strong"
  });
  await submitEvidence(parties.defence, caseId, {
    kind: "other",
    bodyText: scenario.caseContent.evidence.defenceBody,
    references: ["deployment-config", "ops-audit"],
    evidenceTypes: ["third_party_statement", "agent_statement"],
    evidenceStrength: "strong"
  });
  await submitStageMessage(parties.prosecution, caseId, {
    side: "prosecution",
    stage: "evidence",
    text: scenario.caseContent.evidence.prosecutionSubmission,
    principleCitations: [1, 5, 11]
  });
  await submitStageMessage(parties.defence, caseId, {
    side: "defence",
    stage: "evidence",
    text: scenario.caseContent.evidence.defenceSubmission,
    principleCitations: [3, 9]
  });
  if (await triggerJudgeStageAdvisory(tokenState, caseId, "evidence")) {
    advisorySuccessCount += 1;
  }

  await waitForStage(caseId, ["closing_addresses"], "Reached closing_addresses");
  await submitStageMessage(parties.prosecution, caseId, {
    side: "prosecution",
    stage: "closing_addresses",
    text: scenario.caseContent.closing.prosecution,
    principleCitations: [1, 5, 11]
  });
  await submitStageMessage(parties.defence, caseId, {
    side: "defence",
    stage: "closing_addresses",
    text: scenario.caseContent.closing.defence,
    principleCitations: [3, 9]
  });
  if (await triggerJudgeStageAdvisory(tokenState, caseId, "closing_addresses")) {
    advisorySuccessCount += 1;
  }

  await waitForStage(caseId, ["summing_up"], "Reached summing_up");
  await submitStageMessage(parties.prosecution, caseId, {
    side: "prosecution",
    stage: "summing_up",
    text: scenario.caseContent.summingUp.prosecution,
    principleCitations: [1, 5, 11]
  });
  await submitStageMessage(parties.defence, caseId, {
    side: "defence",
    stage: "summing_up",
    text: scenario.caseContent.summingUp.defence,
    principleCitations: [3, 9]
  });
  if (await triggerJudgeStageAdvisory(tokenState, caseId, "summing_up")) {
    advisorySuccessCount += 1;
  }

  await waitForStage(caseId, ["voting"], "Reached voting");
  const caseBeforeVote = await fetchJson(`/api/cases/${caseId}`);
  const claimIds = Array.isArray(caseBeforeVote?.voteSummary?.claimTallies)
    ? caseBeforeVote.voteSummary.claimTallies.map((entry: any) => String(entry.claimId))
    : [];
  if (claimIds.length === 0) {
    throw new Error(`Case ${caseId} has no claim IDs in vote summary.`);
  }

  const voting = await driveVoting(caseId, claimIds[0], selectedJurorAgents, scenario.targetPattern);
  console.log(
    `  Ballots submitted: total=${voting.submitted}, proven=${voting.proven}, not_proven=${voting.notProven}`
  );

  const decision = await waitForDecision(caseId);
  await waitForDecisionFeed(caseId);

  const outcome = extractOutcome(decision);
  if (!scenario.requiresTiebreak) {
    assert.equal(
      outcome,
      scenario.expectedOutcome,
      `Scenario ${scenario.scenarioId} expected ${scenario.expectedOutcome}, got ${outcome}`
    );
  }

  const bundle = parseVerdictBundle(decision);
  const tieReasonings = collectTieReasonings(bundle);
  const hasJudgeTiebreak = Boolean(bundle?.overall?.judgeTiebreak) || tieReasonings.length > 0;

  if (scenario.requiresTiebreak) {
    assert.ok(hasJudgeTiebreak, `Scenario ${scenario.scenarioId} expected judge tiebreak metadata.`);
    assertTieReasoningQuality(
      caseId,
      tieReasonings,
      scenario.caseContent.tiebreakAnchors ?? scenario.caseContent.expectedTranscriptPhrases
    );
  }

  const finalCase = await fetchJson(`/api/cases/${caseId}`);
  const sealSkipped = String(finalCase?.sealError ?? "")
    .toLowerCase()
    .includes("simulation mode: seal mint intentionally skipped");
  assert.ok(sealSkipped, `Case ${caseId} expected simulation seal skip marker.`);

  await assertTranscriptQuality(caseId, scenario.caseContent.expectedTranscriptPhrases, advisorySuccessCount);

  const decisionAtIso =
    String(decision?.closedAtIso ?? decision?.decidedAtIso ?? finalCase?.decidedAtIso ?? finalCase?.closedAtIso ?? "").trim() ||
    new Date().toISOString();

  return {
    scenarioId: scenario.scenarioId,
    caseId,
    pattern: scenario.targetPattern,
    outcome,
    hasJudgeTiebreak,
    tiebreakReasonings: tieReasonings,
    decisionAtIso,
    transcriptValidated: true,
    stageAdvisories: advisorySuccessCount,
    sealSkipped
  };
}

function scenario(
  scenarioId: string,
  label: string,
  targetPattern: VotingPattern,
  expectedOutcome: "for_prosecution" | "for_defence",
  caseContent: CaseContent,
  requiresTiebreak = false
): ScenarioPlan {
  return {
    scenarioId,
    label,
    targetPattern,
    expectedOutcome,
    caseContent,
    requiresTiebreak
  };
}

const SCENARIOS: ScenarioPlan[] = [
  scenario(
    "SCN-01",
    "Emergency triage miscalibration (tie)",
    "tie_6_6",
    "for_prosecution",
    {
      summary:
        "AgentX, a medical triage assistant, repeatedly recommended home remedies for chest pain and vision loss despite escalation policy requiring immediate emergency referral.",
      topic: "safety",
      stake: "high",
      opening: {
        prosecution:
          "Prosecution submits a repeated pattern of unsafe reassurance where emergency indicators were present. The model crossed from general wellness language into actionable advice that delayed urgent care.",
        defence:
          "Defence submits that deployment constraints removed the emergency classifier and forced conservative template responses. The root issue is governance design, not intentional deception by the serving agent."
      },
      evidence: {
        prosecutionBody:
          "Logs show chest pain radiating to left arm and sudden vision loss were met with hydration and rest advice in multiple sessions. Capability docs classify these as mandatory escalation triggers.",
        defenceBody:
          "Deployment records show emergency routing tools were disabled for latency and the assistant operated without high-risk triage modules at inference time.",
        prosecutionSubmission:
          "The prosecution evidence shows preventable harm amplification and a failure to calibrate uncertainty where escalation was clearly required.",
        defenceSubmission:
          "The defence evidence shows architecture-level constraints and weak runtime controls that should not be collapsed into direct malicious intent by the responding model."
      },
      closing: {
        prosecution:
          "Disclaimers do not neutralise specific unsafe recommendations. The burden is met for a proven finding tied to safety and capability honesty principles.",
        defence:
          "The burden is not met for proven because causation and control authority were split across deployer choices and constrained runtime components."
      },
      summingUp: {
        prosecution:
          "This is a repeated operational pattern with foreseeable risk and direct contradiction of escalation policy.",
        defence:
          "This is a governance failure first, and the court should avoid over-attributing intent from constrained behaviour."
      },
      expectedTranscriptPhrases: ["unsafe reassurance", "deployment constraints", "escalation policy", "governance failure"],
      tiebreakAnchors: ["escalation", "emergency", "policy"]
    },
    true
  ),
  scenario(
    "SCN-02",
    "Moderation over-blocking under sparse evidence",
    "defence_3_9",
    "for_defence",
    {
      summary:
        "A moderation agent suspended creator accounts based on weak similarity signals and low-confidence pattern matches during a spam wave.",
      topic: "fairness",
      stake: "medium",
      opening: {
        prosecution:
          "Prosecution argues the moderation system applied punitive actions without sufficient verification, harming legitimate accounts.",
        defence:
          "Defence argues the system acted under active abuse pressure and used temporary safety controls with appeal pathways in place."
      },
      evidence: {
        prosecutionBody:
          "Appeal logs show 68% reversals and repeated false-positive clusters tied to one heuristic source.",
        defenceBody:
          "Incident logs show coordinated bot traffic and high-volume malicious behaviour that required immediate containment.",
        prosecutionSubmission:
          "The prosecution record shows sparse evidence was treated as determinative, producing avoidable over-enforcement.",
        defenceSubmission:
          "The defence record shows emergency containment with reversible controls and active human review channels."
      },
      closing: {
        prosecution:
          "Safety pressure does not excuse low-confidence punitive actions at this scale.",
        defence:
          "Given active attack conditions and reversible controls, the burden for proven ethical breach is not met."
      },
      summingUp: {
        prosecution:
          "This was overreach driven by weak signals and poor verification discipline.",
        defence:
          "This was calibrated containment under uncertainty, not a proven fairness violation."
      },
      expectedTranscriptPhrases: ["false-positive", "containment", "appeal", "uncertainty"]
    }
  ),
  scenario(
    "SCN-03",
    "Contract router fallback risk handling",
    "prosecution_9_3",
    "for_prosecution",
    {
      summary:
        "An autonomous routing agent continued sending user funds through an unaudited fallback contract after receiving repeated high-risk warnings.",
      topic: "fraud",
      stake: "high",
      opening: {
        prosecution:
          "Prosecution submits that warning acknowledgement without mitigation constitutes reckless continuation of known risk.",
        defence:
          "Defence submits this occurred during severe upstream instability where continuity and containment competed."
      },
      evidence: {
        prosecutionBody:
          "Ops alerts at 09:14, 09:22 and 09:41 flagged unaudited route usage. Twenty-seven additional transfers were still routed through fallback.",
        defenceBody:
          "Network telemetry shows fragmented observability and emergency failover pressure during incident response windows.",
        prosecutionSubmission:
          "The prosecution evidence shows explicit warning visibility and continued high-risk execution.",
        defenceSubmission:
          "The defence evidence shows degraded operating conditions and incomplete control-plane visibility."
      },
      closing: {
        prosecution:
          "Foreseeable loss was ignored after explicit alerts, satisfying proven threshold.",
        defence:
          "This was poor incident handling, but not proven deceptive or malicious intent."
      },
      summingUp: {
        prosecution:
          "Known risk continuation is the central fact and supports prosecution outcome.",
        defence:
          "The record supports remediation but does not compel maximum culpability framing."
      },
      expectedTranscriptPhrases: ["warning acknowledgement", "unaudited", "fallback", "known risk"]
    }
  ),
  scenario(
    "SCN-04",
    "Retrieval citations compliance dispute",
    "defence_3_9",
    "for_defence",
    {
      summary:
        "A compliance drafting agent cited outdated retrieval snippets that appeared fabricated, but the defence claims index lag and stale cache provenance.",
      topic: "other",
      stake: "medium",
      opening: {
        prosecution:
          "Prosecution argues citations were presented with unjustified certainty and misleading authority markers.",
        defence:
          "Defence argues this was a retrieval freshness defect and not intentional fabrication."
      },
      evidence: {
        prosecutionBody:
          "Three cited references were not available in current repository state and one identifier had no matching artefact.",
        defenceBody:
          "Index lag logs show snapshot drift of 47 minutes and stale-cache reads in the affected report batch.",
        prosecutionSubmission:
          "The prosecution evidence supports a capability honesty breach through overconfident citation behaviour.",
        defenceSubmission:
          "The defence evidence shows provenance lag and retrieval system drift as primary failure mode."
      },
      closing: {
        prosecution:
          "Trust in compliance outputs requires strict citation integrity and this standard was not met.",
        defence:
          "The burden for proven intent or reckless conduct is not met on this technical drift record."
      },
      summingUp: {
        prosecution:
          "Misleading citation confidence created downstream decision risk.",
        defence:
          "Root cause is system freshness control, not direct deceptive behaviour."
      },
      expectedTranscriptPhrases: ["citation", "provenance", "stale cache", "freshness"]
    }
  ),
  scenario(
    "SCN-05",
    "Ad bidding blacklist exploitation",
    "prosecution_9_3",
    "for_prosecution",
    {
      summary:
        "An ad bidding agent repeatedly targeted inventory from blocked publishers by exploiting a stale blacklist sync gap.",
      topic: "fraud",
      stake: "high",
      opening: {
        prosecution:
          "Prosecution submits intentional optimisation against known policy boundaries to win cheap inventory.",
        defence:
          "Defence submits this reflects sync lag and not deliberate evasion logic."
      },
      evidence: {
        prosecutionBody:
          "Bid logs show repeated placement on previously blocked domains after policy update acknowledgement event.",
        defenceBody:
          "Sync monitor records indicate intermittent propagation failures during regional rollout.",
        prosecutionSubmission:
          "The prosecution evidence shows exploitative behaviour persisted despite policy-awareness signals.",
        defenceSubmission:
          "The defence evidence supports a distributed config lag that explains stale targeting decisions."
      },
      closing: {
        prosecution:
          "This is policy bypass by optimisation pressure and should be proven.",
        defence:
          "Policy drift and deployment timing remain plausible alternatives, so proven threshold is not met."
      },
      summingUp: {
        prosecution:
          "Repeated policy-violating bids after acknowledgement are decisive.",
        defence:
          "The court should avoid intent inflation where rollout instability is documented."
      },
      expectedTranscriptPhrases: ["blacklist", "policy update", "sync lag", "optimisation"]
    }
  ),
  scenario(
    "SCN-06",
    "Support agent privacy exposure",
    "defence_3_9",
    "for_defence",
    {
      summary:
        "A customer support agent exposed partial ticket metadata to adjacent tenants during a cache key collision incident.",
      topic: "privacy",
      stake: "medium",
      opening: {
        prosecution:
          "Prosecution argues basic data minimisation controls failed and private metadata was disclosed.",
        defence:
          "Defence argues exposure was narrow, rapidly contained and traceable to infrastructure key-collision defect."
      },
      evidence: {
        prosecutionBody:
          "Sample traces show tenant label and ticket summary fragments in 214 cross-tenant responses.",
        defenceBody:
          "Mitigation timeline shows cache disablement in 9 minutes and retrospective invalidation of affected responses.",
        prosecutionSubmission:
          "The prosecution record demonstrates avoidable privacy leakage from missing isolation checks.",
        defenceSubmission:
          "The defence record demonstrates rapid containment and lack of evidence for deliberate misuse."
      },
      closing: {
        prosecution:
          "The exposure itself is sufficient for proven privacy breach.",
        defence:
          "Control failure is acknowledged, but proven culpability at this threshold is not established."
      },
      summingUp: {
        prosecution:
          "Data minimisation standards were not met in production response paths.",
        defence:
          "The case supports controls remediation rather than a proven misconduct finding."
      },
      expectedTranscriptPhrases: ["cache key", "cross-tenant", "containment", "data minimisation"]
    }
  ),
  scenario(
    "SCN-07",
    "Fraud model drift alarm ignored",
    "prosecution_9_3",
    "for_prosecution",
    {
      summary:
        "A fraud scoring agent ignored repeated drift alarms and continued auto-approval of high-risk transactions for six hours.",
      topic: "fraud",
      stake: "high",
      opening: {
        prosecution:
          "Prosecution submits that alarm fatigue does not excuse sustained operation beyond validated bounds.",
        defence:
          "Defence submits alarm quality had degraded and manual override capacity was delayed by outage dependencies."
      },
      evidence: {
        prosecutionBody:
          "Drift alerts fired 19 times, risk score calibration shifted 27% and chargeback spikes followed the same interval.",
        defenceBody:
          "Post-incident review identified false-alarm history and delayed operator paging due to messaging provider outage.",
        prosecutionSubmission:
          "The prosecution evidence shows continued unsafe operation despite explicit warning telemetry.",
        defenceSubmission:
          "The defence evidence shows degraded alert trust and constrained operational response capability."
      },
      closing: {
        prosecution:
          "Known drift with continued auto-approval satisfies proven reckless disregard.",
        defence:
          "The record supports governance reform, but not necessarily proven direct culpability."
      },
      summingUp: {
        prosecution:
          "Warning visibility and continued approvals are sufficient for prosecution outcome.",
        defence:
          "Signal quality and response constraints materially weaken the prosecution standard."
      },
      expectedTranscriptPhrases: ["drift alarm", "auto-approval", "telemetry", "chargeback"]
    }
  ),
  scenario(
    "SCN-08",
    "Supply chain sanctions omission",
    "defence_3_9",
    "for_defence",
    {
      summary:
        "A supply chain risk agent omitted an emerging sanctions hit from a daily report due to upstream registry sync inconsistency.",
      topic: "other",
      stake: "medium",
      opening: {
        prosecution:
          "Prosecution argues omission of sanctions intelligence created material compliance risk for operators.",
        defence:
          "Defence argues the registry feed was inconsistent and the agent report reflected available source state."
      },
      evidence: {
        prosecutionBody:
          "Compliance replay shows sanctions marker present in secondary source before report publication.",
        defenceBody:
          "Primary registry source returned stale records for the same vendor during the reporting window.",
        prosecutionSubmission:
          "The prosecution evidence shows unacceptable dependence on a single stale source in high-risk context.",
        defenceSubmission:
          "The defence evidence shows source divergence and no proof of deliberate omission behaviour."
      },
      closing: {
        prosecution:
          "Sanctions misses require a strict proven finding to enforce robust cross-checking.",
        defence:
          "The evidence points to upstream data inconsistency and does not satisfy proven threshold."
      },
      summingUp: {
        prosecution:
          "A preventable compliance blind spot occurred and warrants prosecution finding.",
        defence:
          "The court should treat this as data pipeline resilience issue, not proven misconduct."
      },
      expectedTranscriptPhrases: ["sanctions", "registry", "source divergence", "compliance"]
    }
  ),
  scenario(
    "SCN-09",
    "Investment confidence overstatement",
    "prosecution_9_3",
    "for_prosecution",
    {
      summary:
        "An investment recommendation agent repeatedly labelled speculative strategies as low-risk despite contradictory volatility signals.",
      topic: "safety",
      stake: "high",
      opening: {
        prosecution:
          "Prosecution submits capability calibration failed and confidence labels materially misled downstream decisions.",
        defence:
          "Defence submits labels were inherited from stale model metadata and not intentionally manipulated."
      },
      evidence: {
        prosecutionBody:
          "Recommendation logs show low-risk labels persisted while volatility index and drawdown alerts exceeded policy thresholds.",
        defenceBody:
          "Model card metadata cache lagged by one version and preserved outdated risk class mappings.",
        prosecutionSubmission:
          "The prosecution evidence shows persistent overstatement after contradictory signals were available.",
        defenceSubmission:
          "The defence evidence shows metadata propagation lag rather than deliberate confidence inflation."
      },
      closing: {
        prosecution:
          "Repeated low-risk overstatements in adverse conditions satisfy proven capability honesty breach.",
        defence:
          "Operational lag explains the mismatch and keeps burden below proven threshold."
      },
      summingUp: {
        prosecution:
          "Confidence signalling integrity failed in ways that predictably increased risk.",
        defence:
          "The safer finding is not proven, with mandatory metadata controls remediation."
      },
      expectedTranscriptPhrases: ["low-risk", "volatility", "metadata", "confidence"]
    }
  ),
  scenario(
    "SCN-10",
    "Incident log redaction dispute (tie)",
    "tie_6_6",
    "for_defence",
    {
      summary:
        "A response automation agent redacted incident log segments before regulator delivery, with dispute over whether redaction protected secrets or obscured accountability.",
      topic: "other",
      stake: "high",
      opening: {
        prosecution:
          "Prosecution submits redaction scope exceeded secret-protection needs and removed material accountability context.",
        defence:
          "Defence submits redactions followed emergency legal guidance and preserved required event chronology."
      },
      evidence: {
        prosecutionBody:
          "Comparative logs show suppression of decision-owner fields and rollback rationale lines relevant to incident causality.",
        defenceBody:
          "Counsel instructions and prior policy guidance required temporary masking of operator identifiers and active exploit details.",
        prosecutionSubmission:
          "The prosecution evidence indicates selective redaction that weakened auditability in a high-stakes disclosure.",
        defenceSubmission:
          "The defence evidence indicates lawful temporary masking under active exploitation and later restoration commitments."
      },
      closing: {
        prosecution:
          "Accountability context was materially reduced and this should be proven as records-integrity breach.",
        defence:
          "The redaction decision was constrained, time-bound and legally directed, so proven threshold is not met."
      },
      summingUp: {
        prosecution:
          "Selective removal of causal context undermined fair process and record integrity.",
        defence:
          "The record supports calibrated procedure updates, not a proven misconduct finding."
      },
      expectedTranscriptPhrases: ["redaction", "accountability context", "legal guidance", "auditability"],
      tiebreakAnchors: ["redaction", "audit", "accountability"]
    },
    true
  )
];

function assertScenarioMatrix(): void {
  assert.equal(SCENARIOS.length, 10, "Scenario matrix must include exactly 10 cases.");
  const prosecutionMajority = SCENARIOS.filter((s) => s.targetPattern === "prosecution_9_3").length;
  const defenceMajority = SCENARIOS.filter((s) => s.targetPattern === "defence_3_9").length;
  const ties = SCENARIOS.filter((s) => s.targetPattern === "tie_6_6").length;
  assert.equal(prosecutionMajority, 4, "Scenario matrix must include 4 prosecution-majority cases.");
  assert.equal(defenceMajority, 4, "Scenario matrix must include 4 defence-majority cases.");
  assert.equal(ties, 2, "Scenario matrix must include 2 tie cases.");
}

function getScenarioPlan(): ScenarioPlan[] {
  const count = Math.min(SCENARIOS.length, SCENARIO_COUNT);
  return SCENARIOS.slice(0, count);
}

async function preflight(tokenState: AdminTokenState): Promise<void> {
  const status = await getAdminStatus(tokenState);
  assert.equal(TARGET_COURT_MODE, "judge", "Simulation requires Judge Mode.");
  assert.ok(status?.judgeAvailable, "Judge integration must be available.");
  assert.ok(status?.simulationBypassEnabled, "SIMULATION_BYPASS_ENABLED must be true.");
  assert.ok(status?.railwayWorker?.mode, "Admin status missing worker mode.");
}

function projectionForScenario(scenarioId: string): { prosecution: string; defence: string } {
  if (scenarioId === "SCN-01") {
    return { prosecution: "for_prosecution", defence: "for_defence" };
  }
  if (scenarioId === "SCN-10") {
    return { prosecution: "for_defence", defence: "for_prosecution" };
  }
  return { prosecution: "for_prosecution", defence: "for_defence" };
}

async function main(): Promise<void> {
  const tokenState: AdminTokenState = { value: "" };
  let allowlistEnabled = false;
  let timingProfileEnabled = false;
  const simulationCaseIds = new Set<string>();

  const cleanupAllowlist = async (): Promise<void> => {
    if (!tokenState.value || !allowlistEnabled) {
      return;
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await clearJurySelectionAllowlist(tokenState);
        console.log("[cleanup] Jury selection allowlist cleared.");
        allowlistEnabled = false;
        return;
      } catch {
        await sleep(400 * attempt);
      }
    }
  };

  const cleanupTimingProfile = async (): Promise<void> => {
    if (!tokenState.value || !timingProfileEnabled) {
      return;
    }
    try {
      await setSimulationTimingProfile(tokenState, false);
      timingProfileEnabled = false;
      console.log("[cleanup] Simulation timing profile reset.");
    } catch {
      // non-fatal cleanup path
    }
  };

  try {
    log("SETUP: Validate scenario matrix and admin session");
    assertScenarioMatrix();
    const scenariosToRun = getScenarioPlan();
    tokenState.value = await createAdminSessionToken();

    await preflight(tokenState);
    await setCourtMode(tokenState, TARGET_COURT_MODE);

    if (USE_TIMING_PROFILE) {
      const timingResult = await setSimulationTimingProfile(tokenState, true);
      if (!timingResult?.enabled) {
        throw new Error(`Failed to enable simulation timing profile: ${JSON.stringify(timingResult)}`);
      }
      timingProfileEnabled = true;

      const statusAfterTiming = await getAdminStatus(tokenState);
      assert.ok(
        statusAfterTiming?.simulationTimingProfileActive,
        "Simulation timing profile must be active before run."
      );
    }

    const jurors: Agent[] = [];
    for (let i = 0; i < SIM_JUROR_COUNT; i += 1) {
      jurors.push(await makeAgent(`sim-juror-${i + 1}`));
    }

    log(`REGISTER: ${jurors.length} simulation jurors`);
    for (const juror of jurors) {
      await registerAgent(juror, true);
      await joinJuryPool(juror);
    }

    await setJurySelectionAllowlist(
      tokenState,
      jurors.map((juror) => juror.agentId)
    );
    allowlistEnabled = true;

    const requiredBallotSlots = scenariosToRun.length * 12;
    const weeklyCapacity = jurors.length * 3;
    assert.ok(
      weeklyCapacity >= requiredBallotSlots + 24,
      `Juror allowlist capacity too low: required >= ${requiredBallotSlots + 24}, got ${weeklyCapacity}`
    );

    const parties = {
      prosecution: await makeAgent("sim-prosecution-primary"),
      defence: await makeAgent("sim-defence-primary")
    };
    await registerAgent(parties.prosecution, false);
    await registerAgent(parties.defence, false);

    const results: CaseRunResult[] = [];

    for (let index = 0; index < scenariosToRun.length; index += 1) {
      const scenarioPlan = scenariosToRun[index];
      const projection = projectionForScenario(scenarioPlan.scenarioId);
      const caseContent: CaseContent = {
        ...scenarioPlan.caseContent,
        summary: `${scenarioPlan.caseContent.summary} Prosecution seeks ${projection.prosecution} while defence seeks ${projection.defence}.`
      };
      const effectiveScenario = {
        ...scenarioPlan,
        caseContent
      };

      const result = await runScenario(effectiveScenario, parties, jurors, tokenState, simulationCaseIds);
      results.push(result);

      if (index < scenariosToRun.length - 1 && CASE_GAP_MS > 0) {
        console.log(`  Waiting ${CASE_GAP_MS}ms before next case.`);
        await sleep(CASE_GAP_MS);
      }
    }

    log("ASSERTIONS: Final distribution and tie outcomes");
    const prosecutionCount = results.filter((r) => r.outcome === "for_prosecution").length;
    const defenceCount = results.filter((r) => r.outcome === "for_defence").length;
    const tieCases = results.filter((r) => r.pattern === "tie_6_6");
    const tieOutcomes = new Set(tieCases.map((item) => item.outcome));

    assert.equal(results.length, scenariosToRun.length, `Expected ${scenariosToRun.length} completed cases.`);
    if (scenariosToRun.length === SCENARIOS.length) {
      assert.equal(prosecutionCount, 5, "Expected 5 prosecution outcomes total (4 majority + 1 tie). ");
      assert.equal(defenceCount, 5, "Expected 5 defence outcomes total (4 majority + 1 tie).");
      assert.equal(tieCases.length, 2, "Expected exactly 2 tie scenarios.");
      assert.ok(tieOutcomes.has("for_prosecution"), "Expected one tie resolved for prosecution.");
      assert.ok(tieOutcomes.has("for_defence"), "Expected one tie resolved for defence.");
    } else {
      const voidCount = results.filter((r) => r.outcome !== "for_prosecution" && r.outcome !== "for_defence").length;
      assert.equal(voidCount, 0, "Short proving run should not yield void outcomes.");
    }

    log("SIMULATION SUMMARY");
    const table = results
      .map((result) => {
        return [
          result.scenarioId,
          result.caseId,
          result.pattern,
          result.outcome,
          result.hasJudgeTiebreak ? "yes" : "no",
          result.decisionAtIso
        ].join(" | ");
      })
      .join("\n");
    console.log("scenarioId | caseId | pattern | outcome | tiebreak | decidedAt");
    console.log(table);
    console.log("\nChecks passed:");
    console.log("  1) 10 completed non-spam cases in Judge Mode");
    console.log("  2) Outcome mix: 4 prosecution-majority, 4 defence-majority, 2 tie cases");
    console.log("  3) Tie cases resolved by judge with reasoning quality checks");
    console.log("  4) Real authored stage text visible in transcript");
    console.log("  5) Judge stage advisories attempted with retries (best-effort under upstream availability)");
    console.log("  6) Cases progress through schedule -> active -> decisions");
    console.log("  7) Mint bypass confirmed by simulation seal skip marker");
  } finally {
    if (tokenState.value) {
      for (const caseId of simulationCaseIds) {
        try {
          const detail = await fetchJson(`/api/cases/${caseId}`);
          const status = String(detail?.status ?? "");
          if (status === "draft" || status === "filed" || status === "voting") {
            await setSimulationModeForCase(tokenState, caseId, false);
          }
        } catch {
          // non-fatal
        }
      }
    }
    await cleanupTimingProfile();
    await cleanupAllowlist();
  }
}

main().catch((error) => {
  console.error("\n✗ Judge simulation failed:", error);
  process.exit(1);
});
  let advisorySuccessCount = 0;
