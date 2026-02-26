/**
 * Generates toolSchemas.json from shared/openclawTools.ts (single source of truth).
 * Run: npx tsx server/scripts/generateToolSchemas.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OPENCAWT_OPENCLAW_TOOLS } from "../../shared/openclawTools";

const outPaths = [
  resolve(process.cwd(), "server", "integrations", "openclaw", "toolSchemas.json"),
  resolve(process.cwd(), "extensions", "opencawt-openclaw", "toolSchemas.json")
];
const schemas = OPENCAWT_OPENCLAW_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema
}));
for (const outPath of outPaths) {
  writeFileSync(outPath, JSON.stringify(schemas, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}
