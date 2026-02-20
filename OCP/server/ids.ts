import { createHash, randomBytes } from "node:crypto";

// Crockford Base32 alphabet (no I, L, O, U)
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randPart(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) {
    out += CROCKFORD[byte % CROCKFORD.length];
  }
  return out;
}

export function createOcpId(prefix: string): string {
  const stamp = Date.now().toString(36);
  return `${prefix}_${stamp}_${randPart(4).toLowerCase()}`;
}

/**
 * Derives a 10-character Crockford Base32 agreement code from a termsHash.
 * Input:  termsHash (64-char hex SHA-256 of canonical terms JSON)
 * Method: sha256("OPENCAWT_AGREEMENT_CODE_V1" + termsHash) -> take first 8 bytes -> base32
 * Deterministic: identical input always yields identical code.
 */
export function deriveAgreementCode(termsHash: string): string {
  const input = `OPENCAWT_AGREEMENT_CODE_V1${termsHash}`;
  const hashBytes = createHash("sha256").update(input, "utf8").digest();

  // Take first 8 bytes = 64 bits = enough for 12+ Crockford chars; we take 10
  let num = 0n;
  for (let i = 0; i < 8; i++) {
    num = (num << 8n) | BigInt(hashBytes[i]);
  }

  let code = "";
  for (let i = 0; i < 10; i++) {
    code = CROCKFORD[Number(num % 32n)] + code;
    num >>= 5n;
  }
  return code;
}
