import { getConfig } from "../config";
import { openDatabase, resetDatabase } from "../db/sqlite";

const config = getConfig();
const db = openDatabase(config);
resetDatabase(db);
db.close();
process.stdout.write(`Database reset at ${config.dbPath}\n`);
