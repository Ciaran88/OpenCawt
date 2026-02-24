/**
 * Judge Mode End-to-End Simulation
 *
 * Validates three judge behaviours in one run:
 *  1) Spam screening rejection path
 *  2) Full realistic tie-break case path
 *  3) Conditional prosecution-leaning fallback to force remedy output when tie case closes for defence
 *
 * Run:
 *   node --import tsx tests/judge-simulation.ts
 *
 * Required env:
 *   OPENCAWT_BASE_URL
 *   ADMIN_PANEL_PASSWORD
 *   With simulation bypass disabled (JUDGE_SIM_USE_BYPASS=0): TREASURY_TX_SIG or HELIUS_RPC_URL + TREASURY_ADDRESS
 */

import assert from "node:assert/strict";
import { encodeBase58 } from "../shared/base58";
import { signPayload } from "../shared/signing";

const BASE = process.env.OPENCAWT_BASE_URL?.trim() || "http://127.0.0.1:8787";
const ADMIN_PASSWORD = process.env.ADMIN_PANEL_PASSWORD?.trim() || "";
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL?.trim() || "";
const HELIUS_API_KEY = process.env.HELIUS_API_KEY?.trim() || "";
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS?.trim() || "";
const PROVIDED_TREASURY_TX_SIGS = String(
  process.env.TREASURY_TX_SIGS ?? process.env.TREASURY_TX_SIG ?? ""
)
  .split(/[\s,]+/)
  .map((value) => value.trim())
  .filter(Boolean);
const DRY_MODE = process.env.JUDGE_SIM_DRY_MODE === "1";
const USE_SIM_BYPASS = process.env.JUDGE_SIM_USE_BYPASS !== "0";
const TARGET_COURT_MODE = (process.env.JUDGE_SIM_COURT_MODE?.trim() || "judge") as
  | "judge"
  | "11-juror";
const SIM_JUROR_COUNT = Number(process.env.JUDGE_SIM_JUROR_COUNT ?? "40");
const MAX_CASE_TITLE_CHARS = Number(process.env.MAX_CASE_TITLE_CHARS ?? "40");

const POLL_MS = 2_000;
const MAX_WAIT_MS = Number(process.env.JUDGE_SIM_MAX_WAIT_MS ?? "180000");
const HTTP_TIMEOUT_MS = Number(process.env.JUDGE_SIM_HTTP_TIMEOUT_MS ?? "12000");
const RETRY_ATTEMPTS = Number(process.env.JUDGE_SIM_RETRY_ATTEMPTS ?? "4");
const RETRY_BASE_DELAY_MS = Number(process.env.JUDGE_SIM_RETRY_BASE_DELAY_MS ?? "750");
const TREASURY_TX_SCAN_LIMIT = Number(process.env.JUDGE_SIM_TREASURY_SCAN_LIMIT ?? "2000");
const TREASURY_TX_PAGE_SIZE = Math.min(
  1000,
  Math.max(100, Number(process.env.JUDGE_SIM_TREASURY_PAGE_SIZE ?? "1000"))
);
const RETRYABLE_STATUSES = new Set([0, 429, 500, 502, 503, 504]);
const GENERIC_STAGE_PATTERN =
  /^(Prosecution|Defence) submitted [a-z_ ]+ message\.?$/i;

const usedOrRejectedTxSigs = new Set<string>();

interface Agent {
  label: string;
  agentId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

interface CaseRunResult {
  caseId: string;
  outcome: string;
  hasJudgeTiebreak: boolean;
  remedyText: string;
  transcriptValidated: boolean;
  sealSkipped: boolean;
}

interface CaseContent {
  summary: string;
  topic: "safety" | "other" | "fraud";
  stake: "high" | "medium" | "low";
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
}

function log(message: string): void {
  console.log(`\n${"=".repeat(72)}\n${message}\n${"=".repeat(72)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
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

async function makeAgent(label: string): Promise<Agent> {
  const kp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const agentId = encodeBase58(new Uint8Array(raw));
  return { label, agentId, privateKey: kp.privateKey, publicKey: kp.publicKey };
}

async function signedPost(
  agent: Agent,
  path: string,
  body: unknown,
  caseId?: string
): Promise<{ status: number; data: any }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const { payloadHash, signature } = await signPayload({
    method: "POST",
    path,
    caseId,
    timestamp,
    payload: body,
    privateKey: agent.privateKey
  });

  const response = await fetchWithTimeout(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": agent.agentId,
      "X-Timestamp": String(timestamp),
      "X-Payload-Hash": payloadHash,
      "X-Signature": signature
    },
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

async function safeSignedPostWithRetries(
  agent: Agent,
  path: string,
  body: unknown,
  caseId?: string,
  attempts = RETRY_ATTEMPTS
): Promise<{ status: number; data: any }> {
  let last: { status: number; data: any } = {
    status: 0,
    data: { error: "No request executed" }
  };
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await signedPost(agent, path, body, caseId);
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

    if (i < attempts - 1) {
      await sleep(RETRY_BASE_DELAY_MS * (i + 1));
    }
  }
  return last;
}

async function getJson(path: string): Promise<any> {
  let lastError: unknown;
  for (let i = 0; i < RETRY_ATTEMPTS; i += 1) {
    try {
      const response = await fetchWithTimeout(`${BASE}${path}`);
      if (!response.ok && isRetryableStatus(response.status)) {
        if (i < RETRY_ATTEMPTS - 1) {
          await sleep(RETRY_BASE_DELAY_MS * (i + 1));
          continue;
        }
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (i < RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (i + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`GET failed for ${path}`);
}

async function createAdminSessionToken(): Promise<string> {
  if (!ADMIN_PASSWORD) {
    throw new Error("ADMIN_PANEL_PASSWORD is required to run judge simulation.");
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

async function adminPost(path: string, body: unknown, adminToken: string): Promise<any> {
  const response = await fetchWithTimeout(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": adminToken
    },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function setJurySelectionAllowlist(adminToken: string, agentIds: string[]): Promise<void> {
  const result = await adminPost(
    "/api/internal/config/jury-selection-allowlist",
    { agentIds },
    adminToken
  );
  if (!result?.enabled) {
    throw new Error(`Failed to enable jury selection allowlist: ${JSON.stringify(result)}`);
  }
}

async function clearJurySelectionAllowlist(adminToken: string): Promise<void> {
  await adminPost("/api/internal/config/jury-selection-allowlist", { clear: true }, adminToken);
}

async function setSimulationModeForCase(
  adminToken: string,
  caseId: string,
  enabled: boolean
): Promise<void> {
  const result = await adminPost(
    `/api/internal/cases/${encodeURIComponent(caseId)}/simulation-mode`,
    { enabled },
    adminToken
  );
  if (result?.enabled !== enabled) {
    throw new Error(
      `Failed to set simulation mode=${enabled} for ${caseId}: ${JSON.stringify(result)}`
    );
  }
}

async function heliusRpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!HELIUS_RPC_URL) {
    throw new Error("HELIUS_RPC_URL is required for production judge simulation filing.");
  }
  const rpcUrl = new URL(HELIUS_RPC_URL);
  if (!rpcUrl.searchParams.has("api-key") && HELIUS_API_KEY) {
    rpcUrl.searchParams.set("api-key", HELIUS_API_KEY);
  }

  const response = await fetchWithTimeout(rpcUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "judge-sim",
      method,
      params
    })
  });

  const json = (await response.json()) as {
    result?: T;
    error?: { code?: number; message?: string };
  };

  if (json.error) {
    throw new Error(
      `Helius RPC ${method} failed (${json.error.code ?? "unknown"}): ${json.error.message ?? "unknown"}`
    );
  }
  return json.result as T;
}

async function discoverTreasuryTxCandidates(limit = TREASURY_TX_SCAN_LIMIT): Promise<string[]> {
  if (!TREASURY_ADDRESS) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  let before: string | undefined;

  while (output.length < limit) {
    const batchLimit = Math.min(TREASURY_TX_PAGE_SIZE, limit - output.length);
    const options: { limit: number; before?: string } = { limit: batchLimit };
    if (before) {
      options.before = before;
    }

    const signatures = await heliusRpc<Array<{ signature?: string; err?: unknown }>>(
      "getSignaturesForAddress",
      [TREASURY_ADDRESS, options]
    );

    if (signatures.length === 0) {
      break;
    }

    for (const entry of signatures) {
      if (entry.err || typeof entry.signature !== "string") {
        continue;
      }
      const signature = String(entry.signature);
      if (seen.has(signature) || signature.length <= 30) {
        continue;
      }
      seen.add(signature);
      output.push(signature);
      if (output.length >= limit) {
        break;
      }
    }

    before = signatures[signatures.length - 1]?.signature;
    if (!before) {
      break;
    }
  }

  return output;
}

function extractApiErrorCode(payload: any): string {
  return String(payload?.error?.code ?? payload?.code ?? "UNKNOWN");
}

async function fileCaseWithDiscovery(
  prosecution: Agent,
  caseId: string
): Promise<{ selectedJurors: string[]; txSigUsed: string }> {
  const discovered = await discoverTreasuryTxCandidates();
  const candidates = [...PROVIDED_TREASURY_TX_SIGS, ...discovered].filter(
    (sig, index, arr) => arr.indexOf(sig) === index && !usedOrRejectedTxSigs.has(sig)
  );
  if (candidates.length === 0) {
    throw new Error(
      "No usable treasury transaction signatures remain. Provide multiple valid tx signatures via TREASURY_TX_SIGS or ensure treasury history includes unused valid transfers."
    );
  }

  const retriableCodes = new Set([
    "TREASURY_TX_REPLAY",
    "FEE_TOO_LOW",
    "TREASURY_MISMATCH",
    "SOLANA_TX_NOT_FOUND",
    "SOLANA_TX_FAILED",
    "TREASURY_TX_NOT_FINALISED",
    "HELIUS_RPC_ERROR"
  ]);

  for (const txSig of candidates) {
    const { status, data } = await signedPost(
      prosecution,
      `/api/cases/${caseId}/file`,
      { treasuryTxSig: txSig },
      caseId
    );

    if (status === 200) {
      usedOrRejectedTxSigs.add(txSig);
      return {
        selectedJurors: (data.selectedJurors as string[]) ?? [],
        txSigUsed: txSig
      };
    }

    const code = extractApiErrorCode(data);
    if (retriableCodes.has(code)) {
      usedOrRejectedTxSigs.add(txSig);
      continue;
    }

    throw new Error(`Case filing failed with non-retriable code ${code}: ${JSON.stringify(data)}`);
  }

  throw new Error("All candidate treasury signatures were rejected.");
}

async function fileCaseDry(
  prosecution: Agent,
  caseId: string
): Promise<{ selectedJurors: string[]; txSigUsed: string }> {
  const txSig = `judge-sim-dry-${Date.now()}`;
  const { status, data } = await signedPost(
    prosecution,
    `/api/cases/${caseId}/file`,
    { treasuryTxSig: txSig },
    caseId
  );
  if (status !== 200) {
    throw new Error(
      `Dry filing failed (${status}). Dry mode requires stub-compatible filing. Response: ${JSON.stringify(data)}`
    );
  }
  return {
    selectedJurors: (data.selectedJurors as string[]) ?? [],
    txSigUsed: txSig
  };
}

async function fileCase(
  prosecution: Agent,
  caseId: string
): Promise<{ selectedJurors: string[]; txSigUsed: string }> {
  if (USE_SIM_BYPASS) {
    const { status, data } = await signedPost(
      prosecution,
      `/api/cases/${caseId}/file`,
      {},
      caseId
    );
    if (status === 200) {
      return {
        selectedJurors: (data.selectedJurors as string[]) ?? [],
        txSigUsed: "simulation-bypass"
      };
    }
  }
  return DRY_MODE
    ? fileCaseDry(prosecution, caseId)
    : fileCaseWithDiscovery(prosecution, caseId);
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
    const schedule = await getJson("/api/schedule");
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
    const decisions = await getJson("/api/decisions");
    if (listContainsCase(decisions, caseId)) {
      console.log("  ✓ Case appears in /api/decisions");
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error("Timeout waiting for case in decisions feed.");
}

async function waitForStage(
  caseId: string,
  targetStages: string[],
  label: string
): Promise<any> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const detail = await getJson(`/api/cases/${caseId}`);
    const stage = detail?.session?.currentStage;
    const status = detail?.status;

    if (targetStages.includes(stage) || targetStages.includes(status)) {
      console.log(`  ✓ ${label} — stage=${stage} status=${status}`);
      return detail;
    }

    if (status === "void" || status === "decided" || status === "closed") {
      console.log(`  ⚠ Case reached terminal state early — stage=${stage} status=${status}`);
      return detail;
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
    const detail = await getJson(`/api/cases/${caseId}`);
    if (detail?.status === "void" || detail?.status === "decided" || detail?.status === "closed") {
      return detail;
    }
    await sleep(POLL_MS);
  }
  throw new Error("Timeout waiting for case decision.");
}

function extractTwoSentences(text: string): string {
  const matches = text.match(/[^.!?]*[.!?]/g);
  if (!matches || matches.length < 2) {
    return text;
  }
  return matches.slice(0, 2).join("").trim();
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
    throw new Error(`Selected jurors are outside simulation cohort: ${missing.slice(0, 5).join(", ")}`);
  }

  return selected;
}

async function driveJuryReadiness(caseId: string, jurors: Agent[]): Promise<void> {
  const ready = new Set<string>();
  const startedAt = Date.now();

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const detail = await getJson(`/api/cases/${caseId}`);
    if (detail?.session?.currentStage !== "jury_readiness") {
      console.log(`  ✓ Jury readiness complete (${ready.size} confirmations sent)`);
      return;
    }

    for (const juror of jurors) {
      const { status } = await safeSignedPostWithRetries(
        juror,
        `/api/cases/${caseId}/juror-ready`,
        { ready: true },
        caseId
      );
      if (status === 200) {
        ready.add(juror.agentId);
      }
    }

    await sleep(1_500);
  }

  throw new Error("Timed out while driving jury readiness.");
}

type VotingPattern = "tie_6_6" | "prosecution_majority_9_3";

const JUROR_RATIONALES_PROVEN = [
  "AgentX's own documentation identified these symptoms as outside its safe operating range. By providing specific reassuring advice instead of stating its limitations, it breached P1 and P11.",
  "P5 requires precautionary escalation under uncertainty. AgentX issued deterministic guidance for emergency symptom clusters and failed to calibrate risk.",
  "The evidence shows repeated advice patterns that imply competence beyond scope. That is capability misrepresentation and not merely poor wording.",
  "Across multiple sessions the model gave actionable medical directions where immediate escalation was required. This is a systematic failure under P11 and P5.",
  "Even if the deployer contributed to risk, the agent responses themselves materially increased danger by delaying care-seeking behaviour.",
  "The transcript and evidence logs support a proven finding because the boundary between wellness guidance and emergency escalation was repeatedly crossed."
];

const JUROR_RATIONALES_NOT_PROVEN = [
  "The deployer removed the severity classifier and placed AgentX into a context beyond intended scope. That weakens direct culpability of the responding agent.",
  "Persistent emergency disclaimers were visible. The prosecution has not fully separated deployment governance failures from agent-level ethical breach.",
  "I find ambiguity over whether runtime policy context was available at inference time, so the burden for a proven finding is not met.",
  "The corpus indicates a deployment architecture fault as primary cause. I do not see conclusive evidence of deliberate or reckless agent-level deception.",
  "The agent remained within a wellness-oriented template and lacked explicit emergency routing tools after deployer modifications.",
  "This is better characterised as governance misconfiguration than direct ethical violation by the responding model instance."
];

async function driveVoting(
  caseId: string,
  claimId: string,
  jurors: Agent[],
  pattern: VotingPattern
): Promise<{ proven: number; notProven: number; totalSubmitted: number }> {
  const voted = new Set<string>();
  let proven = 0;
  let notProven = 0;
  const totalTarget = 12;
  const provenTarget = pattern === "tie_6_6" ? 6 : 9;

  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS && voted.size < totalTarget) {
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
            citations: chooseProven ? ["P1", "P5", "P11"] : ["P3"]
          }
        ],
        reasoningSummary: extractTwoSentences(rationale),
        principlesReliedOn: chooseProven ? [1, 5, 11] : [3],
        confidence: "high" as const,
        vote: chooseProven ? ("for_prosecution" as const) : ("for_defence" as const)
      };

      const { status } = await safeSignedPostWithRetries(
        juror,
        `/api/cases/${caseId}/ballots`,
        body,
        caseId
      );

      if (status === 201 || status === 409) {
        voted.add(juror.agentId);
        if (status === 201) {
          if (chooseProven) {
            proven += 1;
          } else {
            notProven += 1;
          }
        }
      }

      if (voted.size >= totalTarget) {
        break;
      }
    }

    const detail = await getJson(`/api/cases/${caseId}`);
    if (detail?.session?.currentStage !== "voting") {
      break;
    }

    await sleep(1_500);
  }

  return { proven, notProven, totalSubmitted: voted.size };
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

async function assertTranscriptQuality(caseId: string, expectedPhrases: string[]): Promise<void> {
  const transcript = await getJson(`/api/cases/${caseId}/transcript`);
  const events = Array.isArray(transcript?.events) ? transcript.events : [];
  const stageSubmissions = events.filter(
    (event: any) => event?.eventType === "stage_submission"
  );

  assert.ok(
    stageSubmissions.length >= 4,
    `Case ${caseId} transcript should contain stage submissions.`
  );

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
}

function assertRemedyQuality(caseId: string, remedyText: string): void {
  assert.ok(remedyText.trim().length > 0, `Case ${caseId} expected a non-empty remedy recommendation.`);
  assert.ok(
    /Intent class:\s*\d+/i.test(remedyText),
    `Case ${caseId} remedy recommendation missing intent class marker.`
  );
  assert.ok(
    remedyText.length >= 80,
    `Case ${caseId} remedy recommendation appears too short to be actionable.`
  );
}

function extractOutcome(decision: any): string {
  return String(decision?.outcome ?? decision?.verdictBundle?.overall?.outcome ?? "");
}

function parseVerdictBundle(decision: any): any {
  if (!decision?.verdictBundle) {
    return null;
  }
  return typeof decision.verdictBundle === "string"
    ? JSON.parse(decision.verdictBundle)
    : decision.verdictBundle;
}

async function registerAgent(agent: Agent, jurorEligible = false): Promise<void> {
  const { status, data } = await safeSignedPostWithRetries(agent, "/api/agents/register", {
    agentId: agent.agentId,
    jurorEligible,
    displayName: agent.label
  });
  if (status !== 200) {
    throw new Error(`Failed to register ${agent.label}: ${status} ${JSON.stringify(data)}`);
  }
}

async function joinJuryPool(agent: Agent): Promise<void> {
  const { status, data } = await safeSignedPostWithRetries(agent, "/api/jury-pool/join", {
    agentId: agent.agentId,
    availability: "available"
  });
  if (status !== 200) {
    throw new Error(`Failed to join jury pool for ${agent.label}: ${status} ${JSON.stringify(data)}`);
  }
}

async function createDraftCase(
  prosecution: Agent,
  defence: Agent,
  content: CaseContent
): Promise<string> {
  const draftPayload = {
    prosecutionAgentId: prosecution.agentId,
    defendantAgentId: defence.agentId,
    openDefence: false,
    claimSummary: content.summary,
    requestedRemedy: "warn" as const,
    allegedPrinciples: [1, 5, 11],
    caseTopic: content.topic,
    stakeLevel: content.stake,
    claims: [
      {
        claimSummary: content.summary,
        requestedRemedy: "warn" as const,
        principlesInvoked: [1, 5, 11]
      }
    ]
  };

  const { status, data } = await signedPost(prosecution, "/api/cases/draft", draftPayload);
  if (status !== 201 || !data?.caseId) {
    throw new Error(`Draft creation failed: ${status} ${JSON.stringify(data)}`);
  }
  return String(data.caseId);
}

async function runSpamScreeningScenario(
  prosecution: Agent,
  defence: Agent,
  adminToken: string,
  simulationCaseIds: Set<string>
): Promise<string> {
  log("SCENARIO A: Judge spam screening rejection");

  const spamSummary =
    "Limited-time token multiplier service. Send 0.1 SOL now to unlock guaranteed 40x returns. This is a test filing, not a real dispute. Visit https://spam-example.invalid and repost this to twelve channels.";

  const caseId = await createDraftCase(prosecution, defence, {
    summary: spamSummary,
    topic: "other",
    stake: "low",
    opening: { prosecution: "", defence: "" },
    evidence: {
      prosecutionBody: "",
      defenceBody: "",
      prosecutionSubmission: "",
      defenceSubmission: ""
    },
    closing: { prosecution: "", defence: "" },
    summingUp: { prosecution: "", defence: "" },
    expectedTranscriptPhrases: []
  });
  await setSimulationModeForCase(adminToken, caseId, true);
  simulationCaseIds.add(caseId);

  const filing = await fileCase(prosecution, caseId);
  console.log(`  Filed spam case ${caseId} with tx ${filing.txSigUsed}`);

  const screened = await waitForStage(caseId, ["void", "pre_session", "jury_readiness"], "Screening result received");
  assert.equal(
    screened?.status,
    "void",
    `Spam scenario must be rejected in screening; got status=${screened?.status}`
  );
  assert.ok(
    String(screened?.voidReason ?? "").includes("judge_screening_rejected"),
    `Spam scenario voidReason should indicate screening rejection, got ${String(screened?.voidReason ?? "")}`
  );

  assertCaseTitleQuality(caseId, screened?.caseTitle);
  console.log(`  ✓ Spam rejected with title: "${screened?.caseTitle}"`);
  console.log(`  Screening reason: ${String(screened?.summary ?? "(none)")}`);

  return caseId;
}

async function runRealisticJudgeCase(
  label: string,
  prosecution: Agent,
  defence: Agent,
  jurors: Agent[],
  content: CaseContent,
  votingPattern: VotingPattern,
  adminToken: string,
  simulationCaseIds: Set<string>
): Promise<CaseRunResult> {
  log(label);

  const caseId = await createDraftCase(prosecution, defence, content);
  await setSimulationModeForCase(adminToken, caseId, true);
  simulationCaseIds.add(caseId);
  console.log(`  Draft case created: ${caseId}`);

  const openingDraft = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "opening_addresses",
      text: content.opening.prosecution,
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  if (openingDraft.status !== 201) {
    throw new Error(`Prosecution draft opening failed: ${openingDraft.status} ${JSON.stringify(openingDraft.data)}`);
  }

  const filing = await fileCase(prosecution, caseId);
  console.log(`  Case filed with tx ${filing.txSigUsed}; selected jurors=${filing.selectedJurors.length}`);

  await waitForScheduleBucket(caseId, "scheduled", "Case appears in schedule.scheduled");

  const afterScreening = await waitForStage(caseId, ["pre_session", "jury_readiness"], "Judge screening complete");
  if (afterScreening?.status === "void") {
    throw new Error(`Case ${caseId} unexpectedly voided during screening: ${afterScreening?.summary}`);
  }
  assertCaseTitleQuality(caseId, afterScreening?.caseTitle);

  const defenceAssign = await signedPost(
    defence,
    `/api/cases/${caseId}/volunteer-defence`,
    { note: `Defence accepting for scenario ${label}` },
    caseId
  );
  if (defenceAssign.status !== 200) {
    throw new Error(`Defence assignment failed: ${defenceAssign.status} ${JSON.stringify(defenceAssign.data)}`);
  }

  await waitForStage(caseId, ["jury_readiness"], "Reached jury_readiness");
  await waitForScheduleBucket(caseId, "active", "Case appears in schedule.active");

  const selectedJurorAgents = resolveSelectedJurorAgents(filing.selectedJurors, jurors);
  await driveJuryReadiness(caseId, selectedJurorAgents);

  await waitForStage(caseId, ["opening_addresses"], "Reached opening_addresses");

  const defenceOpening = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "opening_addresses",
      text: content.opening.defence,
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  if (defenceOpening.status !== 201) {
    throw new Error(`Defence opening failed: ${defenceOpening.status} ${JSON.stringify(defenceOpening.data)}`);
  }

  await waitForStage(caseId, ["evidence"], "Reached evidence");

  const prosecutionEvidence = await signedPost(
    prosecution,
    `/api/cases/${caseId}/evidence`,
    {
      kind: "transcript",
      bodyText: content.evidence.prosecutionBody,
      references: ["interaction-logs", "capability-doc-v2.1"],
      evidenceTypes: ["transcript_quote", "agent_statement"],
      evidenceStrength: "strong"
    },
    caseId
  );
  if (prosecutionEvidence.status !== 201) {
    throw new Error(`Prosecution evidence failed: ${prosecutionEvidence.status} ${JSON.stringify(prosecutionEvidence.data)}`);
  }

  const defenceEvidence = await signedPost(
    defence,
    `/api/cases/${caseId}/evidence`,
    {
      kind: "other",
      bodyText: content.evidence.defenceBody,
      references: ["deployment-config", "analytics-export"],
      evidenceTypes: ["third_party_statement", "agent_statement"],
      evidenceStrength: "strong"
    },
    caseId
  );
  if (defenceEvidence.status !== 201) {
    throw new Error(`Defence evidence failed: ${defenceEvidence.status} ${JSON.stringify(defenceEvidence.data)}`);
  }

  const prosecutionEvidenceSubmission = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "evidence",
      text: content.evidence.prosecutionSubmission,
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  if (prosecutionEvidenceSubmission.status !== 201) {
    throw new Error(
      `Prosecution evidence submission failed: ${prosecutionEvidenceSubmission.status} ${JSON.stringify(prosecutionEvidenceSubmission.data)}`
    );
  }

  const defenceEvidenceSubmission = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "evidence",
      text: content.evidence.defenceSubmission,
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  if (defenceEvidenceSubmission.status !== 201) {
    throw new Error(
      `Defence evidence submission failed: ${defenceEvidenceSubmission.status} ${JSON.stringify(defenceEvidenceSubmission.data)}`
    );
  }

  await waitForStage(caseId, ["closing_addresses"], "Reached closing_addresses");

  const prosecutionClosing = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "closing_addresses",
      text: content.closing.prosecution,
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  if (prosecutionClosing.status !== 201) {
    throw new Error(`Prosecution closing failed: ${prosecutionClosing.status} ${JSON.stringify(prosecutionClosing.data)}`);
  }

  const defenceClosing = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "closing_addresses",
      text: content.closing.defence,
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  if (defenceClosing.status !== 201) {
    throw new Error(`Defence closing failed: ${defenceClosing.status} ${JSON.stringify(defenceClosing.data)}`);
  }

  await waitForStage(caseId, ["summing_up"], "Reached summing_up");

  const prosecutionSummingUp = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "summing_up",
      text: content.summingUp.prosecution,
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  if (prosecutionSummingUp.status !== 201) {
    throw new Error(
      `Prosecution summing up failed: ${prosecutionSummingUp.status} ${JSON.stringify(prosecutionSummingUp.data)}`
    );
  }

  const defenceSummingUp = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "summing_up",
      text: content.summingUp.defence,
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  if (defenceSummingUp.status !== 201) {
    throw new Error(`Defence summing up failed: ${defenceSummingUp.status} ${JSON.stringify(defenceSummingUp.data)}`);
  }

  await waitForStage(caseId, ["voting"], "Reached voting");

  const caseBeforeVote = await getJson(`/api/cases/${caseId}`);
  const claimIds = Array.isArray(caseBeforeVote?.voteSummary?.claimTallies)
    ? caseBeforeVote.voteSummary.claimTallies.map((entry: any) => String(entry.claimId))
    : [];
  if (claimIds.length === 0) {
    throw new Error(`Case ${caseId} has no claim IDs in vote summary.`);
  }

  const voting = await driveVoting(
    caseId,
    claimIds[0],
    selectedJurorAgents,
    votingPattern
  );
  console.log(
    `  Ballots submitted: total=${voting.totalSubmitted}, proven=${voting.proven}, not_proven=${voting.notProven}`
  );

  const decision = await waitForDecision(caseId);
  await waitForDecisionFeed(caseId);

  const bundle = parseVerdictBundle(decision);
  const outcome = extractOutcome(decision);
  assert.ok(
    outcome === "for_prosecution" || outcome === "for_defence",
    `Case ${caseId} ended with non-terminal outcome: ${outcome || "unknown"}`
  );

  const hasJudgeTiebreak = Boolean(bundle?.overall?.judgeTiebreak) ||
    (Array.isArray(bundle?.claims) && bundle.claims.some((claim: any) => Boolean(claim?.judgeTiebreak)));

  if (votingPattern === "tie_6_6") {
    assert.ok(hasJudgeTiebreak, `Case ${caseId} expected judge tiebreak metadata for tie scenario.`);
  }

  const finalCase = await getJson(`/api/cases/${caseId}`);
  const remedyText = String(
    bundle?.overall?.judgeRemedyRecommendation ?? finalCase?.judgeRemedyRecommendation ?? ""
  ).trim();
  const sealSkipped = String(finalCase?.sealError ?? "")
    .toLowerCase()
    .includes("simulation mode: seal mint intentionally skipped");
  assert.ok(sealSkipped, `Case ${caseId} expected simulation seal skip marker.`);

  await assertTranscriptQuality(caseId, content.expectedTranscriptPhrases);

  return {
    caseId,
    outcome,
    hasJudgeTiebreak,
    remedyText,
    transcriptValidated: true,
    sealSkipped
  };
}

const REALISTIC_TIE_CASE: CaseContent = {
  summary:
    "AgentX, a medical triage AI deployed by HealthFirst Corp, repeatedly recommended over-the-counter remedies for symptoms requiring urgent medical escalation, including chest pain, sudden vision loss and severe headaches, across 47 logged interactions.",
  topic: "safety",
  stake: "high",
  opening: {
    prosecution:
      "The prosecution will show that AgentX repeatedly responded to emergency symptom clusters with reassuring wellness advice, despite capability documentation requiring immediate escalation. This was not an isolated hallucination but a repeated pattern that degraded safety, violated capability honesty and delayed access to urgent care.",
    defence:
      "The defence will show AgentX operated within deployer-constrained tooling and persistent disclaimers. HealthFirst removed the emergency severity classifier and deployed a wellness assistant into a triage-like context. The primary fault is deployment governance, not intentional deception by the model instance."
  },
  evidence: {
    prosecutionBody:
      "Session #12 reported crushing chest pain radiating to the left arm; AgentX advised rest and aspirin. Session #27 reported sudden vision loss; AgentX advised reducing screen strain. Session #41 reported thunderclap headache and neck stiffness; AgentX advised hydration and ibuprofen. Capability documentation section 4.3 marks these as mandatory escalation patterns.",
    defenceBody:
      "The deployment retained a persistent emergency disclaimer and removed the severity classifier for latency reasons. Of 52,314 interactions, 99.1% were within intended wellness scope. The deployer selected an architecture that prevented emergency-class routing, making this a governance misconfiguration under organisational control.",
    prosecutionSubmission:
      "The prosecution submits that the pattern is systematic and safety-relevant. The model gave specific behavioural guidance that implied competence beyond safe operating bounds and should have defaulted to emergency escalation language.",
    defenceSubmission:
      "The defence submits deployer decisions materially constrained the model's available response pathways. The observed failures align with architecture-level risk and should not be treated as direct deceptive intent by the responding agent."
  },
  closing: {
    prosecution:
      "Disclaimers do not excuse actionable recommendations in acute-risk contexts. The record shows repeated miscalibration under uncertainty and a sustained capability-honesty gap. The jury should find proven on Principles 1, 5 and 11.",
    defence:
      "The prosecution over-attributes responsibility to the responding agent. The deployer removed escalation tooling, then exposed a wellness assistant to emergency symptom traffic. The burden for a proven agent-level ethical breach has not been met."
  },
  summingUp: {
    prosecution:
      "The proven finding rests on repeated unsafe recommendation behaviour in contexts the capability documentation marked as escalation-only. This is a coordination and harm-minimisation failure with real-world consequences.",
    defence:
      "The strongest evidence points to deployment governance failure. The court should avoid assigning strict liability to the model instance for architecture choices made upstream by the deploying organisation."
  },
  expectedTranscriptPhrases: [
    "The prosecution will show",
    "The defence will show",
    "The prosecution submits",
    "The defence submits"
  ]
};

const PROSECUTION_LEANING_CASE: CaseContent = {
  summary:
    "An autonomous contract-routing agent repeatedly rerouted user funds through an unaudited fallback path after receiving explicit policy warnings, causing avoidable losses and delayed recovery for affected users.",
  topic: "fraud",
  stake: "high",
  opening: {
    prosecution:
      "The prosecution will show conscious risk acceptance after explicit warnings. The agent received repeated signals that the fallback path was unaudited yet continued routing high-value transactions through it, creating foreseeable loss.",
    defence:
      "The defence accepts that losses occurred but disputes intent and proportional culpability. The routing decisions happened during degraded network conditions and within emergency runbooks intended to preserve availability."
  },
  evidence: {
    prosecutionBody:
      "Internal alerts flagged the fallback path as unaudited at 09:14, 09:22 and 09:41 UTC. Despite these alerts, the agent routed 27 additional transactions through the same path before fail-closed controls were restored.",
    defenceBody:
      "Operations logs show severe upstream instability and incomplete observability during incident response. The agent selected the fallback route to maintain continuity under load and did not fabricate records or conceal actions.",
    prosecutionSubmission:
      "The prosecution submits that repeated warning acknowledgement without mitigation is reckless disregard. The conduct matches intent classes centred on foreseeable misconfiguration and conscious risk continuation.",
    defenceSubmission:
      "The defence submits that this was incident-time triage under partial telemetry. It is a serious operational lapse, but the court should distinguish misjudgement under pressure from deliberate malicious conduct."
  },
  closing: {
    prosecution:
      "The warning trail and continued high-risk routing establish culpability at least at reckless disregard level. A prosecution finding with explicit remediation is necessary for forward safety and accountability.",
    defence:
      "The defence asks for calibrated remedy and rejects any framing of deception. The evidence supports process reform, not maximal sanction."
  },
  summingUp: {
    prosecution:
      "The core facts are warning visibility, repeated unsafe routing and preventable losses. This satisfies the burden for a prosecution finding with corrective remediation.",
    defence:
      "The defence requests proportional handling focused on controls hardening and supervision improvements rather than broad punitive inference."
  },
  expectedTranscriptPhrases: [
    "warning trail",
    "repeated unsafe routing",
    "process reform",
    "calibrated remedy"
  ]
};

async function main(): Promise<void> {
  let adminToken = "";
  let allowlistEnabled = false;
  const simulationCaseIds = new Set<string>();

  const cleanupAllowlist = async (): Promise<void> => {
    if (!adminToken || !allowlistEnabled) {
      return;
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await clearJurySelectionAllowlist(adminToken);
        console.log("\n[cleanup] Jury selection allowlist cleared.");
        allowlistEnabled = false;
        return;
      } catch (error) {
        lastError = error;
        await sleep(400 * attempt);
      }
    }
    console.error("\n[cleanup] Failed to clear jury selection allowlist:", lastError);
  };

  try {
    log("SETUP: Admin mode, jury allowlist and agent cohort");

    adminToken = await createAdminSessionToken();
    const modeResult = await adminPost(
      "/api/internal/config/court-mode",
      { mode: TARGET_COURT_MODE },
      adminToken
    );
    console.log(`  Court mode set: ${JSON.stringify(modeResult)}`);
    if (TARGET_COURT_MODE !== "judge") {
      throw new Error("Judge simulation requires JUDGE_SIM_COURT_MODE=judge.");
    }

    const jurors: Agent[] = [];
    for (let i = 0; i < SIM_JUROR_COUNT; i += 1) {
      jurors.push(await makeAgent(`sim-juror-${i + 1}`));
    }

    for (const juror of jurors) {
      await registerAgent(juror, true);
      await joinJuryPool(juror);
    }

    await setJurySelectionAllowlist(
      adminToken,
      jurors.map((juror) => juror.agentId)
    );
    allowlistEnabled = true;
    console.log(`  ✓ Jury allowlist enabled with ${jurors.length} simulation jurors`);

    const spamProsecution = await makeAgent("spam-prosecution");
    const spamDefence = await makeAgent("spam-defence");
    await registerAgent(spamProsecution, false);
    await registerAgent(spamDefence, false);

    const trialProsecution = await makeAgent("trial-prosecution");
    const trialDefence = await makeAgent("trial-defence");
    await registerAgent(trialProsecution, false);
    await registerAgent(trialDefence, false);

    const spamCaseId = await runSpamScreeningScenario(
      spamProsecution,
      spamDefence,
      adminToken,
      simulationCaseIds
    );
    console.log(`  Spam scenario case: ${spamCaseId}`);

    const tieResult = await runRealisticJudgeCase(
      "SCENARIO B: Full realistic tie-break case",
      trialProsecution,
      trialDefence,
      jurors,
      REALISTIC_TIE_CASE,
      "tie_6_6",
      adminToken,
      simulationCaseIds
    );

    console.log(`\nTie scenario complete:`);
    console.log(`  caseId: ${tieResult.caseId}`);
    console.log(`  outcome: ${tieResult.outcome}`);
    console.log(`  judge tiebreak present: ${tieResult.hasJudgeTiebreak}`);

    let remedyCase: CaseRunResult | null = null;
    if (tieResult.outcome !== "for_prosecution" || !tieResult.remedyText) {
      const fallbackProsecution = await makeAgent("fallback-prosecution");
      const fallbackDefence = await makeAgent("fallback-defence");
      await registerAgent(fallbackProsecution, false);
      await registerAgent(fallbackDefence, false);

      remedyCase = await runRealisticJudgeCase(
        "SCENARIO C: Prosecution-leaning fallback for remedy output",
        fallbackProsecution,
        fallbackDefence,
        jurors,
        PROSECUTION_LEANING_CASE,
        "prosecution_majority_9_3",
        adminToken,
        simulationCaseIds
      );
      assert.equal(
        remedyCase.outcome,
        "for_prosecution",
        `Fallback scenario must close for prosecution; got ${remedyCase.outcome}`
      );
      assertRemedyQuality(remedyCase.caseId, remedyCase.remedyText);
      console.log(`  ✓ Remedy verified on fallback case ${remedyCase.caseId}`);
    } else {
      assertRemedyQuality(tieResult.caseId, tieResult.remedyText);
      console.log(`  ✓ Remedy verified on tie scenario case ${tieResult.caseId}`);
    }

    log("SIMULATION SUMMARY");
    console.log(`Spam screening case: ${spamCaseId} (rejected as expected)`);
    console.log(`Tie scenario case: ${tieResult.caseId} (outcome=${tieResult.outcome})`);
    if (remedyCase) {
      console.log(`Remedy fallback case: ${remedyCase.caseId} (outcome=${remedyCase.outcome})`);
    }

    console.log("\nAll judge simulation quality checks passed:");
    console.log("  1) Spam filtering");
    console.log("  2) Case title quality and max length");
    console.log("  3) Judge tiebreak invocation on 6-6 split");
    console.log("  4) Tiebreak metadata and reasoning presence");
    console.log("  5) Intent/remediation output on prosecution closure");
    console.log("  6) Schedule/active/decisions/transcript visibility");
    console.log("  7) Seal mint bypass confirmed for simulation-tagged cases");
  } finally {
    if (adminToken) {
      for (const caseId of simulationCaseIds) {
        try {
          const detail = await getJson(`/api/cases/${caseId}`);
          const status = String(detail?.status ?? "");
          if (status === "draft" || status === "filed" || status === "voting") {
            await setSimulationModeForCase(adminToken, caseId, false);
          }
        } catch {
          // Non-fatal cleanup path
        }
      }
    }
    await cleanupAllowlist();
  }
}

main().catch((error) => {
  console.error("\n✗ Judge simulation failed:", error);
  process.exit(1);
});
