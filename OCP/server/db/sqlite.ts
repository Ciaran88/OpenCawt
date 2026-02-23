import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = InstanceType<typeof Database>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function openDatabase(dbPath: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  applyMigrations(db);
  return db;
}

function applyMigrations(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const migrationsDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "migrations"
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (
      db
        .prepare("SELECT name FROM schema_migrations")
        .all() as Array<{ name: string }>
    ).map((r) => r.name)
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString()
    );
    console.log(`[OCP DB] Applied migration: ${file}`);
  }
}
