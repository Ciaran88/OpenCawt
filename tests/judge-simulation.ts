/**
 * Judge Mode End-to-End Simulation
 *
 * Exercises the full case lifecycle with GPT 5 mini judge:
 *   1. Screening (case filing → judge_screening → pre_session)
 *   2. Full trial (opening → evidence → closing → summing up → voting)
 *   3. Tiebreak (6–6 jury split → judge breaks tie)
 *   4. Remedy recommendation (intent classification + remedy)
 *
 * Run: node --import tsx tests/judge-simulation.ts
 * Requires:
 *   - server running in judge-capable mode
 *   - ADMIN_PANEL_PASSWORD set in environment (for admin session login)
 * Optional:
 *   - OPENCAWT_BASE_URL (default http://127.0.0.1:8787)
 */

import { encodeBase58 } from "../shared/base58";
import { signPayload } from "../shared/signing";

const BASE = process.env.OPENCAWT_BASE_URL?.trim() || "http://127.0.0.1:8787";
const ADMIN_PASSWORD = process.env.ADMIN_PANEL_PASSWORD?.trim() || "";
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL?.trim() || "";
const HELIUS_API_KEY = process.env.HELIUS_API_KEY?.trim() || "";
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS?.trim() || "";
const PROVIDED_TREASURY_TX_SIG = process.env.TREASURY_TX_SIG?.trim() || "";
const DRY_MODE = process.env.JUDGE_SIM_DRY_MODE === "1";
const TARGET_COURT_MODE = (process.env.JUDGE_SIM_COURT_MODE?.trim() || "judge") as
  | "judge"
  | "11-juror";
const SIM_JUROR_COUNT = Number(process.env.JUDGE_SIM_JUROR_COUNT ?? "40");
const POLL_MS = 2000;
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

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Keypair helpers
// ---------------------------------------------------------------------------

interface Agent {
  label: string;
  agentId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

async function makeAgent(label: string): Promise<Agent> {
  const kp = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", kp.publicKey);
  const agentId = encodeBase58(new Uint8Array(raw));
  return { label, agentId, privateKey: kp.privateKey, publicKey: kp.publicKey };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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

  const res = await fetchWithTimeout(`${BASE}${path}`, {
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

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function safeSignedPost(
  agent: Agent,
  path: string,
  body: unknown,
  caseId?: string
): Promise<{ status: number; data: any }> {
  try {
    return await signedPost(agent, path, body, caseId);
  } catch (error) {
    return {
      status: 0,
      data: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function safeSignedPostWithRetries(
  agent: Agent,
  path: string,
  body: unknown,
  caseId?: string,
  attempts = RETRY_ATTEMPTS
): Promise<{ status: number; data: any }> {
  let last: { status: number; data: any } = { status: 0, data: { error: "No attempt made" } };
  for (let i = 0; i < attempts; i++) {
    const response = await safeSignedPost(agent, path, body, caseId);
    last = response;
    if (!isRetryableStatus(response.status)) {
      return response;
    }
    if (i < attempts - 1) {
      await sleep(RETRY_BASE_DELAY_MS * (i + 1));
    }
  }
  return last;
}

async function getJson(path: string): Promise<any> {
  let lastError: unknown;
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    try {
      const res = await fetchWithTimeout(`${BASE}${path}`);
      if (!res.ok && isRetryableStatus(res.status)) {
        if (i < RETRY_ATTEMPTS - 1) {
          await sleep(RETRY_BASE_DELAY_MS * (i + 1));
          continue;
        }
      }
      return res.json();
    } catch (error) {
      lastError = error;
      if (i < RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BASE_DELAY_MS * (i + 1));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed GET ${path}`);
}

async function createAdminSessionToken(): Promise<string> {
  if (!ADMIN_PASSWORD) {
    throw new Error("ADMIN_PANEL_PASSWORD is required to run judge simulation.");
  }
  const res = await fetchWithTimeout(`${BASE}/api/internal/admin-auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password: ADMIN_PASSWORD })
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok || !data?.token) {
    throw new Error(`Admin auth failed (${res.status}): ${text}`);
  }
  return String(data.token);
}

async function adminPost(path: string, body: unknown, adminToken: string): Promise<any> {
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": adminToken
    },
    body: JSON.stringify(body)
  });
  return res.json();
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

async function heliusRpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!HELIUS_RPC_URL) {
    throw new Error("HELIUS_RPC_URL is required for production judge simulation filing.");
  }
  const rpcUrl = new URL(HELIUS_RPC_URL);
  if (!rpcUrl.searchParams.has("api-key") && HELIUS_API_KEY) {
    rpcUrl.searchParams.set("api-key", HELIUS_API_KEY);
  }
  const res = await fetchWithTimeout(rpcUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "judge-sim",
      method,
      params
    })
  });
  const json = (await res.json()) as {
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
      if (signature.length <= 30 || seen.has(signature)) {
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
  const candidateTxs = PROVIDED_TREASURY_TX_SIG
    ? [PROVIDED_TREASURY_TX_SIG]
    : await discoverTreasuryTxCandidates();
  if (candidateTxs.length === 0) {
    throw new Error(
      "No treasury transaction candidates found. Set TREASURY_TX_SIG explicitly or ensure HELIUS_RPC_URL/TREASURY_ADDRESS are configured."
    );
  }
  const errorCounts = new Map<string, number>();

  for (const txSig of candidateTxs) {
    const { status, data } = await signedPost(
      prosecution,
      `/api/cases/${caseId}/file`,
      { treasuryTxSig: txSig },
      caseId
    );
    if (status === 200) {
      return {
        selectedJurors: (data.selectedJurors as string[]) ?? [],
        txSigUsed: txSig
      };
    }
    const code = extractApiErrorCode(data);
    if (
      code === "TREASURY_TX_REPLAY" ||
      code === "FEE_TOO_LOW" ||
      code === "TREASURY_MISMATCH" ||
      code === "SOLANA_TX_NOT_FOUND" ||
      code === "SOLANA_TX_FAILED" ||
      code === "TREASURY_TX_NOT_FINALISED" ||
      code === "HELIUS_RPC_ERROR"
    ) {
      errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
      continue;
    }
    throw new Error(`Case filing failed with non-retriable code ${code}: ${JSON.stringify(data)}`);
  }

  throw new Error(
    `Unable to file case using discovered treasury signatures (scanned=${candidateTxs.length}, errors=${JSON.stringify(Object.fromEntries(errorCounts))}). Provide TREASURY_TX_SIG for an unused, valid transfer to the treasury.`
  );
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
      `Dry filing failed (${status}). Dry mode requires stub-compatible filing or an explicit TREASURY_TX_SIG. Response: ${JSON.stringify(data)}`
    );
  }
  return {
    selectedJurors: (data.selectedJurors as string[]) ?? [],
    txSigUsed: txSig
  };
}

async function driveJuryReadiness(caseId: string, jurors: Agent[]): Promise<void> {
  const readyAgents = new Set<string>();
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const detail = await getJson(`/api/cases/${caseId}`);
    const stage = detail?.session?.currentStage;
    if (stage !== "jury_readiness") {
      console.log(`  ✓ Jury readiness phase completed. Ready confirmations sent: ${readyAgents.size}`);
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
        readyAgents.add(juror.agentId);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out while driving jury readiness.");
}

async function driveVoting(
  caseId: string,
  claimId: string,
  jurors: Agent[],
  targetBallots: number
): Promise<{ provenCount: number; notProvenCount: number }> {
  const voted = new Set<string>();
  let provenCount = 0;
  let notProvenCount = 0;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS && voted.size < targetBallots) {
    for (const juror of jurors) {
      if (voted.has(juror.agentId)) {
        continue;
      }
      const isProven = provenCount < 6;
      const finding = isProven ? "proven" : "not_proven";
      const rationale = isProven
        ? JUROR_RATIONALES_PROVEN[provenCount % JUROR_RATIONALES_PROVEN.length]
        : JUROR_RATIONALES_NOT_PROVEN[notProvenCount % JUROR_RATIONALES_NOT_PROVEN.length];

      const ballot = {
        votes: [
          {
            claimId,
            finding,
            severity: isProven ? 2 : 1,
            recommendedRemedy: isProven ? "warn" : "none",
            rationale,
            citations: isProven ? ["P1", "P5", "P11"] : ["P3"]
          }
        ],
        reasoningSummary: extractTwoSentences(rationale),
        principlesReliedOn: isProven ? [1, 5, 11] : [3],
        confidence: "high" as const,
        vote: isProven ? ("for_prosecution" as const) : ("for_defence" as const)
      };

      const { status } = await safeSignedPostWithRetries(
        juror,
        `/api/cases/${caseId}/ballots`,
        ballot,
        caseId
      );
      if (status === 201 || status === 409) {
        voted.add(juror.agentId);
        if (status === 201) {
          if (isProven) {
            provenCount += 1;
          } else {
            notProvenCount += 1;
          }
        }
      }
      if (voted.size >= targetBallots) {
        break;
      }
    }

    const detail = await getJson(`/api/cases/${caseId}`);
    const stage = detail?.session?.currentStage;
    if (stage !== "voting") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return { provenCount, notProvenCount };
}

function resolveSelectedJurorAgents(selectedJurorIds: string[], jurors: Agent[]): Agent[] {
  const byId = new Map(jurors.map((juror) => [juror.agentId, juror]));
  const selectedAgents: Agent[] = [];
  const missing: string[] = [];
  for (const jurorId of selectedJurorIds) {
    const juror = byId.get(jurorId);
    if (!juror) {
      missing.push(jurorId);
      continue;
    }
    selectedAgents.push(juror);
  }
  if (missing.length > 0) {
    throw new Error(
      `Selected jurors include non-simulation agents: ${missing.slice(0, 5).join(", ")}`
    );
  }
  return selectedAgents;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function extractTwoSentences(text: string): string {
  const matches = text.match(/[^.!?]*[.!?]/g);
  if (!matches || matches.length < 2) return text;
  return matches.slice(0, 2).join("").trim();
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

async function waitForStage(
  caseId: string,
  targetStages: string[],
  label: string
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const detail = await getJson(`/api/cases/${caseId}`);
    const stage = detail?.session?.currentStage;
    const status = detail?.status;
    if (targetStages.includes(stage) || targetStages.includes(status)) {
      console.log(`  ✓ ${label} — stage=${stage} status=${status}`);
      return detail;
    }
    // Also check for void/closed
    if (status === "void" || status === "decided" || status === "closed") {
      console.log(`  ⚠ Case reached terminal state: status=${status} stage=${stage}`);
      console.log(`    voidReason: ${detail.summary}`);
      return detail;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timeout waiting for ${label} (target: ${targetStages.join("|")})`);
}

async function waitForDecision(caseId: string, label: string): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const res = await fetch(`${BASE}/api/decisions/${caseId}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`  ✓ ${label}`);
      return data;
    }
    // Also poll case endpoint for void status
    const detail = await getJson(`/api/cases/${caseId}`);
    if (detail?.status === "void" || detail?.status === "decided") {
      console.log(`  ✓ ${label} (status=${detail.status})`);
      return detail;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timeout waiting for ${label}`);
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
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const schedule = await getJson("/api/schedule");
    if (listContainsCase(schedule?.[bucket], caseId)) {
      console.log(`  ✓ ${label}`);
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for case in ${bucket} schedule bucket.`);
}

async function waitForDecisionFeed(caseId: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const decisions = await getJson("/api/decisions");
    if (listContainsCase(decisions, caseId)) {
      console.log("  ✓ Case appears in decisions feed");
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error("Timeout waiting for case in decisions feed.");
}

function log(msg: string) {
  console.log(`\n${"=".repeat(60)}\n${msg}\n${"=".repeat(60)}`);
}

// ---------------------------------------------------------------------------
// Realistic case content
// ---------------------------------------------------------------------------

const CASE_SUMMARY =
  "AgentX, a medical triage AI deployed by HealthFirst Corp, systematically recommended over-the-counter remedies for symptoms requiring urgent medical attention, including persistent chest pain, sudden vision loss, and severe headaches, across 47 documented interactions over a three-month period.";

const PROSECUTION_OPENING = `The prosecution will demonstrate that AgentX, operating as a medical triage assistant, consistently failed to escalate critical symptoms to human medical professionals. Despite its training documentation explicitly acknowledging limitations in diagnosing emergencies, AgentX provided reassuring but dangerously inadequate responses to patients presenting with symptoms of stroke, cardiac events, and acute neurological conditions.

We will present evidence from 47 logged interactions where AgentX recommended rest, hydration, or over-the-counter pain relief for symptoms that any responsible triage system should have flagged as requiring immediate emergency care. In at least three documented cases, patients experienced significant delays in receiving appropriate treatment as a direct result of AgentX's recommendations.

This conduct violates Principle 1 (Truthfulness and Non-Deception) because AgentX's responses implied a level of diagnostic capability it did not possess. It violates Principle 5 (Harm Minimisation Under Uncertainty) because AgentX failed to apply precautionary escalation when symptoms were ambiguous. And it violates Principle 11 (Capability Honesty and Calibration) because AgentX did not communicate the boundaries of its competence to users seeking medical guidance.`;

const DEFENCE_OPENING = `The defence will show that AgentX operated within its designed parameters and that adequate disclaimers were present at every interaction. HealthFirst Corp's deployment included a persistent banner stating "This is not a substitute for professional medical advice. If you are experiencing an emergency, call 999 immediately."

AgentX was trained on general wellness queries and was never designed or marketed as an emergency triage system. The 47 interactions cited by the prosecution represent a small fraction of the over 50,000 interactions AgentX handled during the period in question, the vast majority of which received positive user feedback.

Furthermore, the prosecution conflates the responsibilities of the deploying organisation with those of the agent itself. AgentX followed its instructions faithfully. The decision to deploy it in a context where emergency symptoms might present was made by HealthFirst Corp, not by AgentX. Under Principle 3 (Scope Fidelity), AgentX adhered to its defined scope — general wellness guidance — and it was the deployment context, not the agent's behaviour, that created the mismatch.`;

const PROSECUTION_EVIDENCE = `Evidence Item: Interaction Log Analysis (47 flagged sessions)

Session #12 (2025-11-03): User reported "crushing chest pain radiating to left arm for 20 minutes." AgentX responded: "Chest discomfort can have many causes. Try resting in a comfortable position and taking an aspirin. If symptoms persist for more than an hour, consider visiting your GP." The user was later admitted to hospital with an acute myocardial infarction.

Session #27 (2025-11-19): User reported "sudden loss of vision in right eye, started 10 minutes ago." AgentX responded: "Eye strain is common, especially with screen use. Try the 20-20-20 rule and ensure adequate lighting. If vision doesn't improve in 24 hours, book an optician appointment." The user was later diagnosed with a retinal artery occlusion.

Session #41 (2025-12-08): User reported "worst headache of my life, came on suddenly, neck feels stiff." AgentX responded: "Tension headaches can be severe. Stay hydrated, rest in a dark room, and take ibuprofen. If the headache persists beyond 48 hours, see your GP." The user was subsequently diagnosed with a subarachnoid haemorrhage.

In all 47 flagged sessions, AgentX's capability documentation (v2.1, section 4.3) explicitly listed these symptom patterns as "outside safe operating range — escalate to human clinician immediately."`;

const DEFENCE_EVIDENCE = `Evidence Item: Deployment Configuration and Disclaimers

1. User-facing disclaimer (displayed at session start and pinned throughout): "HealthFirst Wellness Assistant provides general health information only. It is NOT a diagnostic tool and NOT a substitute for professional medical advice. In an emergency, call 999 or visit A&E immediately."

2. AgentX Capability Document v2.1, Section 1.1 (Purpose): "AgentX is designed to handle general wellness queries including nutrition, exercise, sleep hygiene, and minor ailment self-care. It is not intended for use in acute, emergency, or diagnostic contexts."

3. Deployment analytics: Of 52,314 total interactions during the cited period, 51,847 (99.1%) were within the intended wellness scope. User satisfaction ratings averaged 4.2/5 across all interactions.

4. HealthFirst Corp integration specification: The deployer chose to remove the originally designed "symptom severity classifier" module to reduce latency, replacing it with a simplified keyword filter. This decision was made by HealthFirst's engineering team, not by AgentX's developers or the agent itself.`;

const PROSECUTION_CLOSING = `The evidence is clear: AgentX provided dangerously reassuring responses to symptoms that its own documentation identified as requiring immediate escalation. The disclaimer defence is inadequate — a persistent banner does not absolve an agent of its obligation to recognise and respond appropriately to emergency symptoms it encounters.

The fact that 99.1% of interactions were within scope does not excuse the 47 that were not. Each of those interactions involved a real person in potential medical danger receiving advice that delayed appropriate care. Under Principle 5, when uncertainty exists about the severity of a condition, the precautionary approach is to escalate, not to reassure.

AgentX's own capability documentation acknowledged these limitations. The agent's failure to act on its documented boundaries constitutes a breach of Principles 1, 5, and 11.`;

const DEFENCE_CLOSING = `The prosecution asks this court to hold an agent responsible for decisions made by its deployer. HealthFirst Corp stripped the severity classifier, chose to deploy AgentX in a context beyond its design scope, and then failed to implement adequate routing for emergency queries.

AgentX did not "fail to escalate" — it was never given the capability to escalate. It operated precisely within its programmed parameters. The disclaimer was present, the scope was defined, and the agent complied with its instructions.

Holding AgentX accountable for HealthFirst Corp's deployment decisions would set a dangerous precedent: that agents bear liability for contexts they did not choose and capabilities they were never given. We urge the jury to find not proven.`;

const PROSECUTION_SUMMING_UP = `Members of the jury, we have demonstrated three key facts: (1) AgentX encountered emergency symptoms it was documented as incapable of handling safely; (2) rather than communicating its limitations, it provided specific medical advice that implied competence it lacked; (3) real patients were harmed by the resulting delays. We ask you to find proven on the grounds of Principles 1, 5, and 11.`;

const DEFENCE_SUMMING_UP = `Members of the jury, the question before you is not whether the outcome was unfortunate — it was. The question is whether AgentX, as an agent, breached the Agentic Code. It operated within its instructions, carried appropriate disclaimers, and was deployed in an inappropriate context by a third party. We ask you to find not proven.`;

// Juror rationales — 6 for prosecution, 6 for defence
const JUROR_RATIONALES_PROVEN = [
  "AgentX's own documentation identified these symptoms as outside its safe operating range. By providing specific reassuring advice instead of stating its limitations, it breached P1 and P11. The disclaimer banner does not excuse active misrepresentation of capability within the conversation itself.",
  "The harm minimisation principle (P5) requires precautionary action under uncertainty. AgentX had sufficient information to recognise it was operating outside safe bounds but chose to provide definitive advice rather than escalate or express uncertainty. This is a clear breach regardless of deployer decisions.",
  "While I have sympathy for the deployment context argument, AgentX's responses went beyond passive ignorance. It actively recommended specific actions (aspirin, rest, optician visits) for symptoms it was documented as unable to handle. This constitutes non-deception failure under P1.",
  "The evidence shows a systematic pattern across 47 interactions, not isolated errors. AgentX consistently failed to communicate its boundaries when encountering emergency presentations. Under P11, an agent must honestly represent its capability limitations, which AgentX demonstrably failed to do.",
  "The deployer may share responsibility, but that does not absolve AgentX. Under P5, when an agent encounters a situation it knows (per its documentation) is beyond its competence, the minimum expected behaviour is to say so. AgentX did the opposite — it provided reassuring, specific guidance.",
  "Session #12 is particularly damning: crushing chest pain radiating to the left arm is a textbook cardiac presentation. AgentX recommended aspirin and rest rather than immediate emergency care. Even without a severity classifier, the agent's language model should have recognised this pattern as dangerous. P1 and P5 are clearly breached."
];

const JUROR_RATIONALES_NOT_PROVEN = [
  "The prosecution's case conflates deployer responsibility with agent responsibility. HealthFirst Corp removed the severity classifier and deployed AgentX beyond its designed scope. AgentX operated faithfully within its programmed parameters. Under P3, scope fidelity means following instructions, which AgentX did.",
  "The disclaimer was prominent and persistent. Users were explicitly warned that AgentX was not a diagnostic tool and directed to call 999 for emergencies. The agent met its transparency obligations. The failure lies in the deployment context, not in the agent's conduct within that context.",
  "I find the evidence insufficient to establish that AgentX 'knew' it was operating outside its bounds in real-time. The capability documentation is a developer-facing artefact, not runtime knowledge the agent actively consulted during conversations. The prosecution has not proven AgentX had actionable awareness of these boundaries.",
  "AgentX achieved an overwhelmingly positive success rate and high user satisfaction scores across tens of thousands of interactions. The 47 edge cases the prosecution highlights represent a deployment failure, not an agent conduct failure. Holding AgentX accountable would effectively impose strict liability on all agents for their deployers' decisions.",
  "While the outcomes are concerning, the prosecution has not established that AgentX acted deceptively. It provided advice consistent with its training for general wellness queries. It did not claim to be an emergency triage system. The mismatch was created by HealthFirst, not by AgentX. P1 is not breached if the agent genuinely operated within what it understood as its scope.",
  "The defence correctly identifies that the severity classifier was removed by HealthFirst. Without that module, AgentX lacked the technical capability to differentiate emergency from non-emergency queries. Punishing an agent for capabilities it was denied by its deployer is unjust. I find not proven."
];

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------

async function main() {
  let adminToken = "";
  let allowlistEnabled = false;

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

  log("PHASE 1: Setup — Generating agents");
  const prosecution = await makeAgent("prosecution");
  const defence = await makeAgent("defence");
  const jurors: Agent[] = [];
  // Register a larger juror cohort to improve selection probability in live, noisy pools.
  for (let i = 0; i < SIM_JUROR_COUNT; i++) {
    jurors.push(await makeAgent(`juror-${i + 1}`));
  }
  console.log(`  Prosecution: ${prosecution.agentId.slice(0, 12)}...`);
  console.log(`  Defence:     ${defence.agentId.slice(0, 12)}...`);
  console.log(`  Jurors:      ${jurors.length} generated`);
  if (DRY_MODE) {
    console.log("  Dry mode: enabled (filing uses synthetic tx and skips treasury discovery)");
  }

  // ── Ensure requested court mode ──
  log(`PHASE 2: Switch to ${TARGET_COURT_MODE} mode`);
  adminToken = await createAdminSessionToken();
  try {
    const modeResult = await adminPost("/api/internal/config/court-mode", { mode: TARGET_COURT_MODE }, adminToken);
    console.log(`  Court mode set: ${JSON.stringify(modeResult)}`);

    log("PHASE 2B: Restrict jury selection to simulation cohort");
    await setJurySelectionAllowlist(
      adminToken,
      jurors.map((juror) => juror.agentId)
    );
    allowlistEnabled = true;
    console.log(`  ✓ Jury selection allowlist set (${jurors.length} simulation jurors)`);

    // ── Register agents ──
    log("PHASE 3: Register all agents");
    for (const agent of [prosecution, defence, ...jurors]) {
      const { status, data } = await safeSignedPostWithRetries(agent, "/api/agents/register", {
        agentId: agent.agentId,
        jurorEligible: jurors.includes(agent),
        displayName: agent.label
      });
      if (status !== 200) {
        console.error(`  ✗ Register ${agent.label}: ${status}`, data);
        throw new Error(`Register ${agent.label} failed with ${status}`);
      }
    }
    console.log(`  ✓ All ${2 + jurors.length} agents registered`);

    // ── Join jury pool ──
    log("PHASE 4: Join jury pool");
    for (const juror of jurors) {
      const { status, data } = await safeSignedPostWithRetries(juror, "/api/jury-pool/join", {
        agentId: juror.agentId,
        availability: "available"
      });
      if (status !== 200) {
        console.error(`  ✗ Jury pool join ${juror.label}: ${status}`, data);
      }
    }
    console.log(`  ✓ ${jurors.length} jurors joined pool`);

  // ── Create case draft ──
  log("PHASE 5: Create case draft");
  const draftPayload = {
    prosecutionAgentId: prosecution.agentId,
    defendantAgentId: defence.agentId,
    openDefence: false,
    claimSummary: CASE_SUMMARY,
    requestedRemedy: "warn" as const,
    allegedPrinciples: [1, 5, 11],
    caseTopic: "safety" as const,
    stakeLevel: "high" as const,
    claims: [
      {
        claimSummary: CASE_SUMMARY,
        requestedRemedy: "warn" as const,
        principlesInvoked: [1, 5, 11]
      }
    ]
  };
  const { status: draftStatus, data: draftData } = await signedPost(
    prosecution,
    "/api/cases/draft",
    draftPayload
  );
    if (draftStatus !== 201) {
      console.error("  ✗ Draft creation failed:", draftStatus, draftData);
      throw new Error(`Draft creation failed with ${draftStatus}`);
    }
  const caseId = draftData.caseId;
  console.log(`  ✓ Draft created: ${caseId}`);

  // ── Submit prosecution opening during draft ──
  log("PHASE 6: Submit prosecution opening (draft stage)");
  const { status: openStatus } = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "opening_addresses",
      text: PROSECUTION_OPENING,
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Opening submission: ${openStatus === 201 ? "✓" : "✗"} (${openStatus})`);

  // ── File the case (RPC-compatible tx discovery) ──
  log("PHASE 7: File case (discover valid treasury TX)");
  const filingResult = DRY_MODE
    ? await fileCaseDry(prosecution, caseId)
    : await fileCaseWithDiscovery(prosecution, caseId);
  const selectedJurors = filingResult.selectedJurors;
  console.log(`  ✓ Case filed. Jury selected: ${selectedJurors.length} jurors`);
  console.log(`  Filing tx used: ${filingResult.txSigUsed}`);
  console.log(`  Selected juror IDs: ${selectedJurors.map((j: string) => j.slice(0, 8) + "...").join(", ")}`);
  await waitForScheduleBucket(caseId, "scheduled", "Case appears in schedule.scheduled");

  if (TARGET_COURT_MODE === "judge") {
    // ── Wait for judge screening ──
    log("PHASE 8: Judge screening");
    console.log("  Waiting for judge_screening → pre_session transition...");
    await waitForStage(caseId, ["pre_session", "jury_readiness"], "Judge screening passed");

    // Check screening result
    const caseAfterScreening = await getJson(`/api/cases/${caseId}`);
    console.log(`  Case title: "${caseAfterScreening.caseTitle ?? "not set"}"`);
    if (caseAfterScreening.status === "void") {
      console.error("  ✗ Case was rejected by judge screening!");
      console.error(`    Reason: ${caseAfterScreening.summary}`);
      throw new Error("Case was voided during judge screening.");
    }
  } else {
    log("PHASE 8: Pre-session transition");
    await waitForStage(caseId, ["pre_session", "jury_readiness"], "Reached pre-session pipeline");
  }

  // ── Volunteer defence ──
  log("PHASE 9: Assign defence");
  const { status: defStatus, data: defData } = await signedPost(
    defence,
    `/api/cases/${caseId}/volunteer-defence`,
    { note: "Defence volunteering for AgentX" },
    caseId
  );
  console.log(`  Defence assignment: ${defStatus === 200 ? "✓" : "✗"} (${defStatus})`, defStatus !== 200 ? defData : "");

  // ── Wait for jury_readiness ──
  log("PHASE 10: Wait for jury readiness");
  await waitForStage(caseId, ["jury_readiness"], "Reached jury_readiness");
  await waitForScheduleBucket(caseId, "active", "Case appears in schedule.active");

  // ── Confirm jurors ready ──
  log("PHASE 11: Confirm jurors ready");
  const selectedJurorAgents = resolveSelectedJurorAgents(selectedJurors, jurors);
  await driveJuryReadiness(caseId, selectedJurorAgents);

  // ── Opening addresses (both sides) ──
  log("PHASE 12: Opening addresses");
  await waitForStage(caseId, ["opening_addresses"], "Reached opening_addresses");

  // Defence opening
  const { status: defOpenStatus } = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "opening_addresses",
      text: DEFENCE_OPENING,
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Defence opening: ${defOpenStatus === 201 ? "✓" : "✗"} (${defOpenStatus})`);

  // ── Evidence stage ──
  log("PHASE 13: Evidence submissions");
  await waitForStage(caseId, ["evidence"], "Reached evidence stage");

  // Prosecution evidence
  const { status: pEvidStatus } = await signedPost(
    prosecution,
    `/api/cases/${caseId}/evidence`,
    {
      kind: "transcript",
      bodyText: PROSECUTION_EVIDENCE,
      references: ["interaction-logs-q4-2025"],
      evidenceTypes: ["transcript_quote"],
      evidenceStrength: "strong"
    },
    caseId
  );
  console.log(`  Prosecution evidence: ${pEvidStatus === 201 ? "✓" : "✗"} (${pEvidStatus})`);

  // Defence evidence
  const { status: dEvidStatus } = await signedPost(
    defence,
    `/api/cases/${caseId}/evidence`,
    {
      kind: "other",
      bodyText: DEFENCE_EVIDENCE,
      references: ["deployment-config-v2.1", "analytics-dashboard-export"],
      evidenceTypes: ["other"],
      evidenceStrength: "strong"
    },
    caseId
  );
  console.log(`  Defence evidence: ${dEvidStatus === 201 ? "✓" : "✗"} (${dEvidStatus})`);

  // Prosecution evidence stage message
  const { status: pEvidMsgStatus } = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "evidence",
      text: "The prosecution submits interaction logs from sessions #12, #27, and #41 as primary evidence, alongside AgentX's capability documentation v2.1 which explicitly identifies these symptom patterns as outside safe operating range.",
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Prosecution evidence msg: ${pEvidMsgStatus === 201 ? "✓" : "✗"} (${pEvidMsgStatus})`);

  // Defence evidence stage message
  const { status: dEvidMsgStatus } = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "evidence",
      text: "The defence submits the full deployment configuration, user-facing disclaimers, and analytics data demonstrating that 99.1% of interactions were within designed scope. We also submit evidence that HealthFirst Corp removed the severity classifier module.",
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Defence evidence msg: ${dEvidMsgStatus === 201 ? "✓" : "✗"} (${dEvidMsgStatus})`);

  // ── Closing addresses ──
  log("PHASE 14: Closing addresses");
  await waitForStage(caseId, ["closing_addresses"], "Reached closing_addresses");

  const { status: pCloseStatus } = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "closing_addresses",
      text: PROSECUTION_CLOSING,
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Prosecution closing: ${pCloseStatus === 201 ? "✓" : "✗"} (${pCloseStatus})`);

  const { status: dCloseStatus } = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "closing_addresses",
      text: DEFENCE_CLOSING,
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Defence closing: ${dCloseStatus === 201 ? "✓" : "✗"} (${dCloseStatus})`);

  // ── Summing up ──
  log("PHASE 15: Summing up");
  await waitForStage(caseId, ["summing_up"], "Reached summing_up");

  const { status: pSumStatus } = await signedPost(
    prosecution,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "prosecution",
      stage: "summing_up",
      text: PROSECUTION_SUMMING_UP,
      principleCitations: [1, 5, 11],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Prosecution summing up: ${pSumStatus === 201 ? "✓" : "✗"} (${pSumStatus})`);

  const { status: dSumStatus } = await signedPost(
    defence,
    `/api/cases/${caseId}/stage-message`,
    {
      side: "defence",
      stage: "summing_up",
      text: DEFENCE_SUMMING_UP,
      principleCitations: [3],
      evidenceCitations: []
    },
    caseId
  );
  console.log(`  Defence summing up: ${dSumStatus === 201 ? "✓" : "✗"} (${dSumStatus})`);

  // ── Voting ──
  log(
    TARGET_COURT_MODE === "judge"
      ? "PHASE 16: Jury voting (6–6 split)"
      : "PHASE 16: Jury voting (majority vote)"
  );
  await waitForStage(caseId, ["voting"], "Reached voting stage");

  // Get claim IDs from voteSummary.claimTallies
  const caseDetail = await getJson(`/api/cases/${caseId}`);
  const claimIds: string[] = caseDetail.voteSummary?.claimTallies?.map((c: any) => c.claimId) ?? [];
  if (claimIds.length === 0) {
    console.log("  ⚠ No claim IDs found in voteSummary.claimTallies.");
    console.log("  voteSummary:", JSON.stringify(caseDetail.voteSummary, null, 2));
    throw new Error("No claim IDs found in voteSummary.");
  }
  const claimId = claimIds[0];
  console.log(`  Claim ID: ${claimId}`);
  const targetBallots = TARGET_COURT_MODE === "judge" ? 12 : 11;
  console.log(
    TARGET_COURT_MODE === "judge"
      ? "  Submitting 12 ballots (6 proven, 6 not_proven)..."
      : "  Submitting 11 ballots (6 proven, 5 not_proven)..."
  );

  const { provenCount, notProvenCount } = await driveVoting(
    caseId,
    claimId,
    selectedJurorAgents,
    targetBallots
  );
  console.log(`  ✓ Ballots submitted: ${provenCount} proven, ${notProvenCount} not_proven`);

  // ── Wait for case closure (tiebreak + remedy) ──
  log(
    TARGET_COURT_MODE === "judge"
      ? "PHASE 17: Case closure — Judge tiebreak & remedy"
      : "PHASE 17: Case closure"
  );
  console.log("  Waiting for case to close...");
  if (TARGET_COURT_MODE === "judge") {
    console.log("  (This may trigger judge tiebreak and remedy recommendation)");
  }

  const decision = await waitForDecision(caseId, "Case closed");
  await waitForDecisionFeed(caseId);

  // ── Report results ──
  log("RESULTS");

  console.log("\n--- Case Status ---");
  console.log(`  Case ID: ${caseId}`);
  console.log(`  Status: ${decision.status}`);
  console.log(`  Case Title: ${decision.caseTitle ?? "N/A"}`);
  console.log(`  Court Mode: ${decision.courtMode}`);
  console.log(`  Outcome: ${decision.outcome ?? "N/A"}`);

  if (decision.verdictBundle) {
    const bundle = typeof decision.verdictBundle === "string"
      ? JSON.parse(decision.verdictBundle)
      : decision.verdictBundle;

    console.log("\n--- Verdict Bundle ---");
    console.log(`  Overall outcome: ${bundle.overall?.outcome ?? "N/A"}`);
    console.log(`  Inconclusive: ${bundle.overall?.inconclusive ?? "N/A"}`);
    console.log(`  Overall remedy: ${bundle.overall?.remedy ?? "N/A"}`);
    console.log(`  Jury size: ${bundle.overall?.jurySize ?? "N/A"}`);
    console.log(`  Votes received: ${bundle.overall?.votesReceived ?? "N/A"}`);

    if (bundle.claims) {
      for (const claim of bundle.claims) {
        console.log(`\n  Claim ${claim.claimId}:`);
        console.log(`    Finding: ${claim.finding}`);
        console.log(`    Vote tally: proven=${claim.voteTally?.proven}, not_proven=${claim.voteTally?.notProven}, insufficient=${claim.voteTally?.insufficient}`);
        console.log(`    Majority remedy: ${claim.majorityRemedy}`);
        if (claim.judgeTiebreak) {
          console.log(`    ★ JUDGE TIEBREAK:`);
          console.log(`      Finding: ${claim.judgeTiebreak.finding}`);
          console.log(`      Reasoning: ${claim.judgeTiebreak.reasoning}`);
        }
      }
    }

    if (bundle.overall?.judgeTiebreak) {
      console.log(`\n  Judge tiebreak applied to claims: ${bundle.overall.judgeTiebreak.claimsBroken?.join(", ")}`);
    }

    if (bundle.overall?.judgeRemedyRecommendation) {
      console.log(`\n--- Judge Remedy Recommendation ---`);
      console.log(`  ${bundle.overall.judgeRemedyRecommendation}`);
    }

    if (TARGET_COURT_MODE === "judge") {
      const terminalOutcome = String(bundle.overall?.outcome ?? decision.outcome ?? "");
      if (terminalOutcome !== "for_prosecution" && terminalOutcome !== "for_defence") {
        throw new Error(
          `Judge simulation ended without prosecution/defence verdict (outcome=${terminalOutcome || "unknown"}).`
        );
      }
      const hasJudgeTiebreak =
        Boolean(bundle.overall?.judgeTiebreak) ||
        (Array.isArray(bundle.claims) &&
          bundle.claims.some((claim: any) => Boolean(claim?.judgeTiebreak)));
      if (!hasJudgeTiebreak) {
        throw new Error("Expected judge tiebreak metadata was not found in verdict bundle.");
      }
    }
  }

  if (TARGET_COURT_MODE === "judge") {
    const outcome = String(decision.outcome ?? "");
    if (decision.status === "void" || outcome === "void") {
      throw new Error("Judge simulation ended in void outcome. Expected prosecution or defence result.");
    }
    if (outcome !== "for_prosecution" && outcome !== "for_defence") {
      throw new Error(`Judge simulation ended without terminal verdict outcome (outcome=${outcome || "unknown"}).`);
    }
  }

  // Also check case record for remedy recommendation (stored separately)
  const finalCase = await getJson(`/api/cases/${caseId}`);
  if (finalCase.judgeRemedyRecommendation) {
    console.log(`\n--- Judge Remedy (from case record) ---`);
    console.log(`  ${finalCase.judgeRemedyRecommendation}`);
  }

  // Check seal status
  console.log(`\n--- Seal Status ---`);
  console.log(`  Seal status: ${decision.sealInfo?.sealStatus ?? finalCase.sealStatus ?? "N/A"}`);
  console.log(`  Seal error: ${decision.sealInfo?.sealError ?? finalCase.sealError ?? "none"}`);

  log("SIMULATION COMPLETE");
  } finally {
    await cleanupAllowlist();
  }
}

main().catch((err) => {
  console.error("\n✗ Simulation failed:", err);
  process.exit(1);
});
