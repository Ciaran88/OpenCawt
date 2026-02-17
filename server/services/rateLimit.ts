import type { AppConfig } from "../config";
import { countActionInWindow, countAgentFiledInLast24h } from "../db/repository";
import type { Db } from "../db/sqlite";
import { rateLimited } from "./errors";

export function enforceFilingLimit(db: Db, config: AppConfig, agentId: string): void {
  const count = countAgentFiledInLast24h(db, agentId);
  if (count >= config.rateLimits.filingPer24h) {
    throw rateLimited("Per-agent filing limit reached. Try again later.", 3600);
  }
}

export function enforceActionRateLimit(
  db: Db,
  config: AppConfig,
  input: { agentId: string; actionType: "evidence" | "submission" | "ballot" }
): void {
  const map = {
    evidence: config.rateLimits.evidencePerHour,
    submission: config.rateLimits.submissionsPerHour,
    ballot: config.rateLimits.ballotsPerHour
  };

  const count = countActionInWindow(db, {
    agentId: input.agentId,
    actionType: input.actionType,
    windowSeconds: 3600
  });

  if (count >= map[input.actionType]) {
    throw rateLimited(`Per-agent ${input.actionType} rate limit reached.`, 1800);
  }
}
