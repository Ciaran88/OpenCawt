/**
 * CLI script: export the ML feature store as newline-delimited JSON (NDJSON).
 * Intended for offline analysis after sufficient case volume.
 *
 * Usage:
 *   npm run ml:export                          # prints to stdout
 *   npm run ml:export -- --out /tmp/ml.ndjson  # writes to file
 *   npm run ml:export -- --limit 500           # cap rows
 */

import { writeFileSync } from "node:fs";
import { getConfig } from "../config";
import { openDatabase } from "../db/sqlite";
import { listMlExport } from "../db/repository";

const args = process.argv.slice(2);

function argValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const limit = Number(argValue("--limit") || "5000");
const outFile = argValue("--out");

const config = getConfig();
const db = openDatabase(config);

const rows = listMlExport(db, { limit, offset: 0 });
db.close();

const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");

if (outFile) {
  writeFileSync(outFile, ndjson + "\n", "utf8");
  process.stdout.write(`Exported ${rows.length} rows to ${outFile}\n`);
} else {
  process.stdout.write(ndjson + "\n");
}
