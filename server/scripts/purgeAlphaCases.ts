import { getConfig } from "../config";
import { openDatabase } from "../db/sqlite";
import { listAlphaCaseIds, purgeAlphaCases } from "../db/repository";

function parseDryRun(argv: string[]): boolean {
  if (argv.includes("--execute")) {
    return false;
  }
  return true;
}

function run(): void {
  const config = getConfig();
  const dryRun = parseDryRun(process.argv.slice(2));
  const db = openDatabase(config);
  try {
    if (dryRun) {
      const caseIds = listAlphaCaseIds(db);
      process.stdout.write(
        JSON.stringify(
          {
            ok: true,
            dryRun: true,
            publicAlphaMode: config.publicAlphaMode,
            count: caseIds.length,
            caseIds
          },
          null,
          2
        ) + "\n"
      );
      return;
    }

    const result = purgeAlphaCases(db);
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          dryRun: false,
          publicAlphaMode: config.publicAlphaMode,
          deletedCount: result.deletedCount,
          caseIds: result.caseIds
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    db.close();
  }
}

run();
