import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { getConfig } from "../config";

function timestampStamp(date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const sec = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  return await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function pruneBackups(backupDir: string, retentionCount: number): number {
  const entries = readdirSync(backupDir)
    .filter((name) => /^opencawt-backup-.*\.sqlite$/.test(name))
    .map((name) => {
      const fullPath = join(backupDir, name);
      const stat = statSync(fullPath);
      return { fullPath, name, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const extra = entries.slice(retentionCount);
  for (const entry of extra) {
    rmSync(entry.fullPath, { force: true });
    rmSync(`${entry.fullPath}.sha256`, { force: true });
  }
  return extra.length;
}

async function run(): Promise<void> {
  const config = getConfig();
  mkdirSync(config.backupDir, { recursive: true });

  const filename = `opencawt-backup-${timestampStamp()}.sqlite`;
  const backupPath = join(config.backupDir, filename);
  const escaped = backupPath.replace(/'/g, "''");

  const db = new Database(config.dbPath);
  try {
    db.pragma("busy_timeout = 8000");
    db.exec(`VACUUM INTO '${escaped}';`);
  } finally {
    db.close();
  }

  const checksum = await sha256File(backupPath);
  const checksumFile = `${backupPath}.sha256`;
  writeFileSync(checksumFile, `${checksum}  ${basename(backupPath)}\n`, "utf8");

  const pruned = pruneBackups(config.backupDir, config.backupRetentionCount);
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        dbPath: config.dbPath,
        backupPath,
        checksum,
        retentionCount: config.backupRetentionCount,
        pruned
      },
      null,
      2
    ) + "\n"
  );
}

run().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
