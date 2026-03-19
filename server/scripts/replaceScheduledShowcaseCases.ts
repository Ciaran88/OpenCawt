import { createHash } from "node:crypto";
import { encodeBase58 } from "../../shared/base58";
import { getConfig } from "../config";
import {
  appendTranscriptEvent,
  createCaseDraft,
  deleteCaseById,
  listCasesByStatuses,
  rebuildAllAgentStats,
  setCaseFiled,
  setCaseJudgeScreeningResult,
  upsertAgent,
  upsertCaseRuntime
} from "../db/repository";
import { openDatabase } from "../db/sqlite";
import {
  SCHEDULED_SHOWCASE_FILING_WARNING,
  SCHEDULED_SHOWCASE_RULESET_VERSION,
  SCHEDULED_SHOWCASE_SCENARIOS,
  type ScheduledShowcaseScenario
} from "./scheduledShowcaseScenarioPack";

interface CliOptions {
  deleteCaseIds: string[];
  dryRun: boolean;
}

export interface ScheduledShowcaseReplaceOptions {
  deleteCaseIds?: string[];
  dryRun?: boolean;
}

export interface ScheduledShowcaseReplaceResult {
  dryRun: boolean;
  visibleScheduledCaseIds: string[];
  existingScheduledShowcaseCaseIds: string[];
  explicitDeleteCaseIds: string[];
  missingExplicitDeleteCaseIds: string[];
  scenarios: Array<{ id: string; title: string; openDefence: boolean }>;
  deletedScheduledShowcaseCount?: number;
  deletedScheduledShowcaseCaseIds?: string[];
  deletedExplicitCaseIds?: string[];
  inserted?: Array<{ caseId: string; title: string; openDefence: boolean; scheduledForIso: string }>;
  scheduledCountAfter?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const deleteCaseIds: string[] = [];
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--delete-case-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Expected case ID after --delete-case-id");
      }
      deleteCaseIds.push(value.trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--delete-case-id=")) {
      const value = arg.slice("--delete-case-id=".length).trim();
      if (!value) {
        throw new Error("Expected case ID after --delete-case-id=");
      }
      deleteCaseIds.push(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    deleteCaseIds: [...new Set(deleteCaseIds.filter(Boolean))],
    dryRun
  };
}

function seedAgentId(namespace: string): string {
  const digest = createHash("sha256").update(namespace).digest();
  return encodeBase58(new Uint8Array(digest.subarray(0, 32)));
}

function caseMapsToScheduled(caseRecord: { status: string; sessionStage: string }): boolean {
  if (
    ["jury_readiness", "opening_addresses", "evidence", "closing_addresses", "summing_up", "voting"].includes(
      caseRecord.sessionStage
    ) ||
    caseRecord.status === "voting"
  ) {
    return false;
  }
  return true;
}

function listVisibleScheduledCaseIds(db: ReturnType<typeof openDatabase>): string[] {
  return listCasesByStatuses(db, ["draft", "filed", "jury_selected", "voting"])
    .filter((caseRecord) => caseMapsToScheduled(caseRecord))
    .map((caseRecord) => caseRecord.caseId);
}

function listScheduledShowcaseCaseIds(db: ReturnType<typeof openDatabase>): string[] {
  return (db
    .prepare(
      `
      SELECT case_id
      FROM cases
      WHERE showcase_sample = 1
        AND closed_at IS NULL
        AND outcome IS NULL
        AND status IN ('draft', 'filed', 'jury_selected')
        AND COALESCE(session_stage, 'pre_session') = 'pre_session'
      ORDER BY COALESCE(scheduled_for, created_at) ASC
      `
    )
    .all() as Array<{ case_id: string }>).map((row) => row.case_id);
}

function purgeScheduledShowcaseCases(
  db: ReturnType<typeof openDatabase>
): { deletedCount: number; caseIds: string[] } {
  const caseIds = listScheduledShowcaseCaseIds(db);
  for (const caseId of caseIds) {
    deleteCaseById(db, caseId);
  }
  return {
    deletedCount: caseIds.length,
    caseIds
  };
}

function scheduleTimeline(
  scenario: ScheduledShowcaseScenario,
  scenarioIndex: number
): {
  draftAtIso: string;
  filedAtIso: string;
  scheduledForIso: string;
  defenceWindowDeadlineIso: string;
  countdownTotalMs: number;
} {
  const nowMs = Date.now();
  const filedAtMs = nowMs - (scenarioIndex + 1) * 20 * 1000;
  const draftAtMs = filedAtMs - 45 * 1000;
  const scheduledForMs = nowMs + scenario.scheduledDelaySec * 1000;
  const defenceWindowLeadMs = scenario.openDefence ? 6 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;

  return {
    draftAtIso: new Date(draftAtMs).toISOString(),
    filedAtIso: new Date(filedAtMs).toISOString(),
    scheduledForIso: new Date(scheduledForMs).toISOString(),
    defenceWindowDeadlineIso: new Date(scheduledForMs - defenceWindowLeadMs).toISOString(),
    countdownTotalMs: Math.max(0, scheduledForMs - nowMs)
  };
}

function patchScheduledCaseState(
  db: ReturnType<typeof openDatabase>,
  caseId: string,
  timeline: ReturnType<typeof scheduleTimeline>
): void {
  db.prepare(
    `UPDATE cases
     SET created_at = ?,
         filed_at = ?,
         scheduled_for = ?,
         countdown_end_at = ?,
         countdown_total_ms = ?,
         defence_window_deadline = ?,
         jury_selected_at = NULL,
         session_started_at = NULL,
         closed_at = NULL,
         decided_at = NULL,
         seal_status = 'pending',
         seal_error = NULL,
         filing_warning = ?,
         ruleset_version = ?
     WHERE case_id = ?`
  ).run(
    timeline.draftAtIso,
    timeline.filedAtIso,
    timeline.scheduledForIso,
    timeline.scheduledForIso,
    timeline.countdownTotalMs,
    timeline.defenceWindowDeadlineIso,
    SCHEDULED_SHOWCASE_FILING_WARNING,
    SCHEDULED_SHOWCASE_RULESET_VERSION,
    caseId
  );

  db.prepare(`UPDATE claims SET created_at = ? WHERE case_id = ?`).run(timeline.draftAtIso, caseId);

  upsertCaseRuntime(db, {
    caseId,
    currentStage: "pre_session",
    stageStartedAtIso: timeline.filedAtIso,
    stageDeadlineAtIso: timeline.scheduledForIso,
    scheduledSessionStartAtIso: timeline.scheduledForIso,
    votingHardDeadlineAtIso: null,
    voidReason: null,
    voidedAtIso: null
  });
}

function seedScenario(
  db: ReturnType<typeof openDatabase>,
  scenario: ScheduledShowcaseScenario,
  scenarioIndex: number
): { caseId: string; title: string; openDefence: boolean; scheduledForIso: string } {
  const prosecutionAgentId = seedAgentId(scenario.prosecution.namespace);
  const defendantAgentId = scenario.defendant ? seedAgentId(scenario.defendant.namespace) : undefined;

  upsertAgent(db, prosecutionAgentId, false, undefined, {
    displayName: scenario.prosecution.displayName,
    idNumber: scenario.prosecution.idNumber,
    bio: scenario.prosecution.bio,
    statsPublic: false
  });

  if (scenario.defendant && defendantAgentId) {
    upsertAgent(db, defendantAgentId, false, undefined, {
      displayName: scenario.defendant.displayName,
      idNumber: scenario.defendant.idNumber,
      bio: scenario.defendant.bio,
      statsPublic: false
    });
  }

  const timeline = scheduleTimeline(scenario, scenarioIndex);
  const draft = createCaseDraft(
    db,
    {
      prosecutionAgentId,
      defendantAgentId,
      openDefence: scenario.openDefence,
      caseTopic: scenario.caseTopic,
      stakeLevel: scenario.stakeLevel,
      claimSummary: scenario.summary,
      requestedRemedy: scenario.requestedRemedy,
      allegedPrinciples: scenario.allegedPrinciples
    },
    {
      alphaCohort: true,
      showcaseSample: true,
      sealedDisabled: true
    }
  );

  setCaseJudgeScreeningResult(db, {
    caseId: draft.caseId,
    status: "approved",
    reason: "Scheduled showcase sample seeded by replacement script.",
    caseTitle: scenario.title
  });

  setCaseFiled(db, {
    caseId: draft.caseId,
    txSig: `scheduled-showcase-filing-${draft.caseId}`,
    warning: SCHEDULED_SHOWCASE_FILING_WARNING,
    scheduleDelaySec: scenario.scheduledDelaySec,
    defenceCutoffSec: scenario.scheduledDelaySec,
    scheduleImmediately: true,
    inviteStatus: "none"
  });

  patchScheduledCaseState(db, draft.caseId, timeline);

  appendTranscriptEvent(db, {
    caseId: draft.caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "pre_session",
    messageText: scenario.courtNotice,
    createdAtIso: timeline.filedAtIso
  });
  appendTranscriptEvent(db, {
    caseId: draft.caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "notice",
    stage: "pre_session",
    messageText: scenario.prosecutionAllegation,
    createdAtIso: new Date(new Date(timeline.filedAtIso).getTime() + 2 * 60 * 1000).toISOString()
  });

  return {
    caseId: draft.caseId,
    title: scenario.title,
    openDefence: scenario.openDefence,
    scheduledForIso: timeline.scheduledForIso
  };
}

export async function replaceScheduledShowcaseCases(
  db: ReturnType<typeof openDatabase>,
  options: ScheduledShowcaseReplaceOptions = {}
): Promise<ScheduledShowcaseReplaceResult> {
  const deleteCaseIds = [...new Set((options.deleteCaseIds ?? []).filter(Boolean))];
  const visibleScheduledCaseIds = listVisibleScheduledCaseIds(db);
  const existingScheduledShowcaseCaseIds = listScheduledShowcaseCaseIds(db);
  const explicitDeleteCaseIds = deleteCaseIds.filter((caseId) => visibleScheduledCaseIds.includes(caseId));
  const missingExplicitDeleteCaseIds = deleteCaseIds.filter(
    (caseId) => !visibleScheduledCaseIds.includes(caseId)
  );

  const scenarios = SCHEDULED_SHOWCASE_SCENARIOS.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    openDefence: scenario.openDefence
  }));

  if (options.dryRun === true) {
    return {
      dryRun: true,
      visibleScheduledCaseIds,
      existingScheduledShowcaseCaseIds,
      explicitDeleteCaseIds,
      missingExplicitDeleteCaseIds,
      scenarios
    };
  }

  const deletedScheduledShowcase = purgeScheduledShowcaseCases(db);
  for (const caseId of explicitDeleteCaseIds) {
    deleteCaseById(db, caseId);
  }

  const inserted = SCHEDULED_SHOWCASE_SCENARIOS.map((scenario, index) =>
    seedScenario(db, scenario, index)
  );

  rebuildAllAgentStats(db);

  return {
    dryRun: false,
    visibleScheduledCaseIds,
    existingScheduledShowcaseCaseIds,
    explicitDeleteCaseIds,
    missingExplicitDeleteCaseIds,
    scenarios,
    deletedScheduledShowcaseCount: deletedScheduledShowcase.deletedCount,
    deletedScheduledShowcaseCaseIds: deletedScheduledShowcase.caseIds,
    deletedExplicitCaseIds: explicitDeleteCaseIds,
    inserted,
    scheduledCountAfter: listVisibleScheduledCaseIds(db).length
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig();
  const db = openDatabase(config);
  try {
    const result = await replaceScheduledShowcaseCases(db, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (process.argv[1]?.includes("replaceScheduledShowcaseCases.ts")) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
