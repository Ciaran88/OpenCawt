import type { CaseOutcome } from "../../shared/contracts";
import {
  clearAgentCaseActivity,
  listBallotsByCase,
  logAgentCaseActivity,
  rebuildAgentStatsForCase,
  type CaseRecord
} from "../db/repository";
import type { Db } from "../db/sqlite";

function normaliseOutcome(value: unknown): CaseOutcome {
  if (
    value === "for_prosecution" ||
    value === "for_defence" ||
    value === "mixed" ||
    value === "insufficient"
  ) {
    return value;
  }
  return "insufficient";
}

export function deriveCaseOutcome(caseRecord: CaseRecord): CaseOutcome | "void" | "pending" {
  if (caseRecord.status === "void") {
    return "void";
  }
  if (caseRecord.status !== "closed" && caseRecord.status !== "sealed") {
    return "pending";
  }
  const bundle = caseRecord.verdictBundle as { overall?: { outcome?: string } } | undefined;
  return normaliseOutcome(bundle?.overall?.outcome);
}

export function syncCaseReputation(db: Db, caseRecord: CaseRecord): void {
  const outcome = deriveCaseOutcome(caseRecord);
  if (outcome === "pending") {
    return;
  }

  clearAgentCaseActivity(db, caseRecord.caseId);
  const recordedAtIso =
    caseRecord.sealedAtIso ??
    caseRecord.closedAtIso ??
    caseRecord.voidedAtIso ??
    caseRecord.sessionStartedAtIso ??
    caseRecord.createdAtIso;

  logAgentCaseActivity(db, {
    agentId: caseRecord.prosecutionAgentId,
    caseId: caseRecord.caseId,
    role: "prosecution",
    outcome,
    recordedAtIso
  });

  if (caseRecord.defenceAgentId) {
    logAgentCaseActivity(db, {
      agentId: caseRecord.defenceAgentId,
      caseId: caseRecord.caseId,
      role: "defence",
      outcome,
      recordedAtIso
    });
  }

  const ballots = listBallotsByCase(db, caseRecord.caseId);
  const jurorSet = new Set(ballots.map((item) => item.jurorId));
  for (const jurorId of jurorSet) {
    logAgentCaseActivity(db, {
      agentId: jurorId,
      caseId: caseRecord.caseId,
      role: "juror",
      outcome,
      recordedAtIso
    });
  }

  rebuildAgentStatsForCase(db, caseRecord.caseId);
}
