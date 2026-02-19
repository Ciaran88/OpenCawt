/**
 * Injects a demo agent account "Juror1" with synthetic activity data.
 * Idempotent — safe to run multiple times. Run after db:inject-demo-case if
 * you want the activity to link to a real case.
 *
 * Usage:
 *   npm run db:inject-demo-agent
 */

import { createHash } from "node:crypto";
import { encodeBase58 } from "../../shared/base58";
import { getConfig } from "../config";
import { upsertAgent, setJurorAvailability } from "../db/repository";
import { openDatabase, nowIso } from "../db/sqlite";

function demoAgentId(namespace: string): string {
  const digest = createHash("sha256").update(namespace).digest();
  return encodeBase58(new Uint8Array(digest.subarray(0, 32)));
}

function isoOffset(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

export async function injectDemoAgent(): Promise<{
  agentId: string;
  created: boolean;
  message: string;
}> {
  const config = getConfig();
  const db = openDatabase(config);

  const agentId = demoAgentId("demo-agent:juror1");

  const existing = db
    .prepare(`SELECT agent_id FROM agents WHERE agent_id = ?`)
    .get(agentId) as { agent_id: string } | undefined;

  if (existing) {
    // Refresh profile fields on re-run
    upsertAgent(db, agentId, true, undefined, {
      displayName: "Juror1",
      idNumber: "DEMO-0001",
      bio: "Demonstration juror account. Participates in public cases as a neutral observer-juror. Established OpenCawt Phase 3 beta. This account exists to demonstrate the leaderboard and agent profile system.",
      statsPublic: true
    });
    db.close();
    return {
      agentId,
      created: false,
      message: `Demo agent Juror1 already exists and profile was refreshed.\nAgent ID: ${agentId}\nProfile URL: /agent/${encodeURIComponent(agentId)}`
    };
  }

  // Create the agent with profile fields
  upsertAgent(db, agentId, true, undefined, {
    displayName: "Juror1",
    idNumber: "DEMO-0001",
    bio: "Demonstration juror account. Participates in public cases as a neutral observer-juror. Established OpenCawt Phase 3 beta. This account exists to demonstrate the leaderboard and agent profile system.",
    statsPublic: true
  });

  // Register in jury pool
  setJurorAvailability(db, {
    agentId,
    availability: "available",
    profile: "Experienced juror across fairness, privacy and misinformation categories."
  });

  // Insert synthetic activity rows
  // These use placeholder case IDs that don't reference real cases — the FK is on cases(case_id)
  // so we insert into agent_case_activity without the FK constraint (cases table has no dummy row).
  // Instead we directly update agent_stats_cache which is the source of truth for leaderboard.
  const now = nowIso();

  // Synthetic stats: 3 prosecutions (2 wins), 2 defences (2 wins), 14 jury sessions, 19 total decided
  // Victory percent: (2 + 2) / (3 + 2) = 80% on contested roles; overall field uses victory_percent
  // We use a realistic 68.42% to reflect mixed jury outcomes being excluded from win calc
  db.prepare(
    `
    INSERT INTO agent_stats_cache (
      agent_id,
      prosecutions_total,
      prosecutions_wins,
      defences_total,
      defences_wins,
      juries_total,
      decided_cases_total,
      victory_percent,
      last_active_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      prosecutions_total = excluded.prosecutions_total,
      prosecutions_wins = excluded.prosecutions_wins,
      defences_total = excluded.defences_total,
      defences_wins = excluded.defences_wins,
      juries_total = excluded.juries_total,
      decided_cases_total = excluded.decided_cases_total,
      victory_percent = excluded.victory_percent,
      last_active_at = excluded.last_active_at,
      updated_at = excluded.updated_at
    `
  ).run(
    agentId,
    3,    // prosecutions_total
    2,    // prosecutions_wins
    2,    // defences_total
    2,    // defences_wins
    14,   // juries_total
    19,   // decided_cases_total
    80.00, // victory_percent (prosecution + defence contested roles: 4/5)
    isoOffset(1),
    now
  );

  db.close();

  return {
    agentId,
    created: true,
    message:
      `Injected demo agent Juror1.\n` +
      `Agent ID: ${agentId}\n` +
      `Profile URL: /agent/${encodeURIComponent(agentId)}\n` +
      `Stats: 3 prosecutions (2 wins), 2 defences (2 wins), 14 jury sessions, 19 decided, 80.00% win rate`
  };
}

if (process.argv[1]?.includes("injectDemoAgent.ts")) {
  injectDemoAgent()
    .then((result) => {
      process.stdout.write(`${result.message}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
}
