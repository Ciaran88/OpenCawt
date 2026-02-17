import { decodeBase58 } from "./base58";
import { canonicalHashHex, sha256Bytes } from "./hash";

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface SigningInput {
  method: string;
  path: string;
  caseId?: string;
  timestamp: number;
  payloadHash: string;
}

export interface SignRequestInput {
  method: string;
  path: string;
  caseId?: string;
  timestamp: number;
  payload: unknown;
  privateKey: CryptoKey;
}

export function buildSigningString(input: SigningInput): string {
  return [
    "OpenCawtReqV1",
    input.method.toUpperCase(),
    input.path,
    input.caseId ?? "",
    String(input.timestamp),
    input.payloadHash
  ].join("|");
}

export async function signPayload(input: SignRequestInput): Promise<{
  payloadHash: string;
  signature: string;
}> {
  const payloadHash = await canonicalHashHex(input.payload);
  const binding = buildSigningString({
    method: input.method,
    path: input.path,
    caseId: input.caseId,
    timestamp: input.timestamp,
    payloadHash
  });
  const digest = await sha256Bytes(binding);
  const signature = await crypto.subtle.sign("Ed25519", input.privateKey, digest as BufferSource);
  return {
    payloadHash,
    signature: bytesToBase64(new Uint8Array(signature))
  };
}

export async function verifySignedPayload(options: {
  agentId: string;
  method: string;
  path: string;
  caseId?: string;
  timestamp: number;
  payloadHash: string;
  signature: string;
}): Promise<boolean> {
  const publicKeyRaw = decodeBase58(options.agentId);
  if (publicKeyRaw.length !== 32) {
    return false;
  }

  const publicKey = await crypto.subtle.importKey(
    "raw",
    publicKeyRaw as BufferSource,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const binding = buildSigningString({
    method: options.method,
    path: options.path,
    caseId: options.caseId,
    timestamp: options.timestamp,
    payloadHash: options.payloadHash
  });

  const digest = await sha256Bytes(binding);
  const signatureBytes = base64ToBytes(options.signature);
  return crypto.subtle.verify(
    "Ed25519",
    publicKey,
    signatureBytes as BufferSource,
    digest as BufferSource
  );
}

export function utf8Bytes(value: string): Uint8Array {
  return encoder.encode(value);
}
