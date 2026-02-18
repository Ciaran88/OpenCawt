import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig } from "../config";
import { schemaSql } from "./schema";

export type Db = InstanceType<typeof Database>;

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isIgnorableMigrationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("duplicate column name") ||
    message.includes("already exists") ||
    message.includes("no such column") ||
    message.includes("no such table: main.sqlite_sequence")
  );
}

function runMigrationScript(db: Db, script: string): void {
  const statements = splitSqlStatements(script);
  for (const statement of statements) {
    try {
      db.exec(`${statement};`);
    } catch (error) {
      if (!isIgnorableMigrationError(error)) {
        throw error;
      }
    }
  }
}

function ensureMigrationTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function applyMigrations(db: Db): void {
  ensureMigrationTable(db);

  const migrationsDir = join(process.cwd(), "server", "db", "migrations");
  let files: string[] = [];
  try {
    files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  } catch {
    return;
  }

  const hasMigrationStmt = db.prepare(`SELECT name FROM schema_migrations WHERE name = ?`);
  const markMigrationStmt = db.prepare(
    `INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`
  );

  for (const file of files) {
    const exists = hasMigrationStmt.get(file) as { name: string } | undefined;
    if (exists) {
      continue;
    }

    const script = readFileSync(join(migrationsDir, file), "utf8");
    db.exec("BEGIN");
    try {
      runMigrationScript(db, script);
      markMigrationStmt.run(file, nowIso());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openDatabase(config: AppConfig): Db {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrationScript(db, schemaSql);
  applyMigrations(db);
  runMigrationScript(db, schemaSql);
  return db;
}

export function resetDatabase(db: Db): void {
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec(`
      DROP TABLE IF EXISTS idempotency_records;
      DROP TABLE IF EXISTS agent_capabilities;
      DROP TABLE IF EXISTS case_transcript_events;
      DROP TABLE IF EXISTS case_runtime;
      DROP TABLE IF EXISTS agent_action_log;
      DROP TABLE IF EXISTS used_treasury_txs;
      DROP TABLE IF EXISTS seal_jobs;
      DROP TABLE IF EXISTS verdicts;
      DROP TABLE IF EXISTS ballots;
      DROP TABLE IF EXISTS jury_panel_members;
      DROP TABLE IF EXISTS jury_selection_runs;
      DROP TABLE IF EXISTS jury_panels;
      DROP TABLE IF EXISTS submissions;
      DROP TABLE IF EXISTS evidence_items;
      DROP TABLE IF EXISTS claims;
      DROP TABLE IF EXISTS agent_case_activity;
      DROP TABLE IF EXISTS agent_stats_cache;
      DROP TABLE IF EXISTS juror_availability;
      DROP TABLE IF EXISTS cases;
      DROP TABLE IF EXISTS agents;
      DROP TABLE IF EXISTS schema_migrations;
    `);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }

  runMigrationScript(db, schemaSql);
  applyMigrations(db);
  runMigrationScript(db, schemaSql);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayUtcPrefix(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
