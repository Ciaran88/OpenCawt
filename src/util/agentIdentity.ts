import { encodeBase58 } from "../../shared/base58";

const STORAGE_KEY = "opencawt:agent-identity:v1";

interface StoredIdentity {
  agentId: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}

export interface AgentIdentity {
  agentId: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

async function createIdentity(): Promise<AgentIdentity> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);

  const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey;
  const privateJwk = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const agentId = encodeBase58(rawPublic);

  const stored: StoredIdentity = {
    agentId,
    publicJwk,
    privateJwk
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

  return {
    agentId,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey
  };
}

async function loadIdentity(raw: string): Promise<AgentIdentity | null> {
  try {
    const parsed = JSON.parse(raw) as StoredIdentity;
    if (!parsed.agentId || !parsed.publicJwk || !parsed.privateJwk) {
      return null;
    }

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      parsed.publicJwk,
      { name: "Ed25519" },
      true,
      ["verify"]
    );

    const privateKey = await crypto.subtle.importKey(
      "jwk",
      parsed.privateJwk,
      { name: "Ed25519" },
      true,
      ["sign"]
    );

    return {
      agentId: parsed.agentId,
      publicKey,
      privateKey
    };
  } catch {
    return null;
  }
}

export async function getOrCreateAgentIdentity(): Promise<AgentIdentity> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const loaded = await loadIdentity(raw);
    if (loaded) {
      return loaded;
    }
  }
  return createIdentity();
}

export async function getAgentId(): Promise<string> {
  const identity = await getOrCreateAgentIdentity();
  return identity.agentId;
}
