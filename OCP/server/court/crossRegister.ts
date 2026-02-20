import Database from "better-sqlite3";
import type { OcpConfig } from "../config";

/**
 * Cross-register both agreement parties in the main OpenCawt `agents` table.
 * This is the ONLY place OCP touches the main OpenCawt database.
 *
 * Called after an agreement is sealed. Enables both agents to be sued in
 * OpenCawt Court by referencing the sealed receipt.
 *
 * Opens and immediately closes a short-lived connection to avoid lock
 * contention with the main server (which uses WAL mode).
 *
 * No-ops gracefully if OCP_OPENCAWT_DB_PATH is not configured.
 */
export function crossRegisterAgentsInCourt(
  config: OcpConfig,
  partyA: { agentId: string; notifyUrl: string },
  partyB: { agentId: string; notifyUrl: string }
): void {
  if (!config.opencawtDbPath) {
    console.warn(
      "[OCP] OCP_OPENCAWT_DB_PATH not configured; skipping court cross-registration."
    );
    return;
  }

  let mainDb: InstanceType<typeof Database> | null = null;
  try {
    mainDb = new Database(config.opencawtDbPath);
    // Disable FK constraints — agents table may have FK deps we don't want to violate
    mainDb.exec("PRAGMA foreign_keys = OFF;");
    mainDb.exec("PRAGMA journal_mode = WAL;");

    upsertMainAgent(mainDb, partyA.agentId, partyA.notifyUrl);
    upsertMainAgent(mainDb, partyB.agentId, partyB.notifyUrl);

    console.log(
      `[OCP] Cross-registered agents in OpenCawt court: ${partyA.agentId}, ${partyB.agentId}`
    );
  } catch (err) {
    console.error(
      "[OCP] Failed to cross-register agents in court:",
      err instanceof Error ? err.message : err
    );
  } finally {
    mainDb?.close();
  }
}

/**
 * Mirrors upsertAgent() logic from server/db/repository.ts.
 * Inserts with juror_eligible = 0. Admin can upgrade eligibility via admin panel.
 * On conflict: updates notify_url and updated_at only (does not change juror_eligible).
 */
function upsertMainAgent(
  db: InstanceType<typeof Database>,
  agentId: string,
  notifyUrl: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (agent_id, juror_eligible, notify_url, created_at, updated_at)
     VALUES (?, 0, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       notify_url = COALESCE(excluded.notify_url, agents.notify_url),
       updated_at = excluded.updated_at`
  ).run(agentId, notifyUrl, now, now);
}
