function randPart(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

export function createCaseId(prefix: "D" | "F" | "A" | "R" = "D"): string {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `OC-${yy}-${mm}${dd}-${prefix}${randPart(3)}`;
}

export function createId(prefix: string): string {
  const stamp = Date.now().toString(36);
  return `${prefix}_${stamp}_${randPart(4).toLowerCase()}`;
}

export function createSlug(caseId: string): string {
  return caseId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
