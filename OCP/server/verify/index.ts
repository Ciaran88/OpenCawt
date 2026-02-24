import { decodeBase58 } from "../../shared/base58";
import {
  buildAttestationString,
  hashAttestationString,
  type AttestationInput,
} from "../canonicalise/index";

export interface VerifyAttestationInput extends AttestationInput {
  sigA: string; // base64 Ed25519 signature by partyA
  sigB: string; // base64 Ed25519 signature by partyB
}

export interface VerifyAttestationResult {
  ok: boolean;
  termsHashValid?: boolean;
  sigAValid: boolean;
  sigBValid: boolean;
  reason?: string;
}

/**
 * Verify that both party signatures are valid Ed25519 signatures
 * over the canonical attestation payload.
 *
 * agentId IS the base58-encoded raw Ed25519 public key (32 bytes),
 * matching the existing OpenCawt convention.
 */
export async function verifyBothAttestations(
  input: VerifyAttestationInput
): Promise<VerifyAttestationResult> {
  const attestStr = buildAttestationString(input);
  const digest = hashAttestationString(attestStr);

  const [sigAValid, sigBValid] = await Promise.all([
    verifyEd25519Sig(input.partyAAgentId, digest, input.sigA),
    verifyEd25519Sig(input.partyBAgentId, digest, input.sigB),
  ]);

  if (!sigAValid && !sigBValid) {
    return { ok: false, sigAValid: false, sigBValid: false, reason: "BOTH_SIGS_INVALID" };
  }
  if (!sigAValid) {
    return { ok: false, sigAValid: false, sigBValid: true, reason: "PARTY_A_SIG_INVALID" };
  }
  if (!sigBValid) {
    return { ok: false, sigAValid: true, sigBValid: false, reason: "PARTY_B_SIG_INVALID" };
  }
  return { ok: true, sigAValid: true, sigBValid: true };
}

/**
 * Verify a single Ed25519 signature.
 * Returns false for any malformed input (wrong key length, bad base64, etc.)
 */
async function verifyEd25519Sig(
  agentId: string,
  digest: Buffer,
  sigBase64: string
): Promise<boolean> {
  try {
    const pubkeyBytes = decodeBase58(agentId);
    if (pubkeyBytes.length !== 32) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      pubkeyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    const sigBytes = Buffer.from(sigBase64, "base64");
    if (sigBytes.length !== 64) return false;

    return await crypto.subtle.verify(
      "Ed25519",
      key,
      sigBytes as BufferSource,
      digest as BufferSource
    );
  } catch {
    return false;
  }
}
