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

export type AgentIdentityMode = "local" | "provider";

export interface ExternalAgentSigner {
  getAgentId: () => Promise<string> | string;
  signOpenCawtRequest: (input: {
    method: "POST";
    path: string;
    caseId?: string;
    timestamp: number;
    payload: unknown;
  }) => Promise<{
    payloadHash: string;
    signature: string;
  }>;
}

function getMode(): AgentIdentityMode {
  const raw = (import.meta.env.VITE_AGENT_IDENTITY_MODE as string | undefined)?.toLowerCase();
  return raw === "local" ? "local" : "provider";
}

function getExternalSigner(): ExternalAgentSigner | null {
  const globalObject = window as Window & {
    openCawtAgent?: ExternalAgentSigner;
    openclawAgent?: ExternalAgentSigner;
  };
  return globalObject.openCawtAgent ?? globalObject.openclawAgent ?? null;
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
  if (getMode() !== "local") {
    throw new Error(
      "Local agent identity is disabled. Set VITE_AGENT_IDENTITY_MODE=local for development-only local signing."
    );
  }
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
  if (getMode() === "local") {
    const identity = await getOrCreateAgentIdentity();
    return identity.agentId;
  }

  const signer = getExternalSigner();
  if (!signer) {
    throw new Error(
      "No external agent signer available. Provide window.openCawtAgent or set VITE_AGENT_IDENTITY_MODE=local for development."
    );
  }

  const agentId = await signer.getAgentId();
  if (!agentId || !String(agentId).trim()) {
    throw new Error("External signer did not return a valid agent ID.");
  }
  return String(agentId);
}

export function getAgentIdentityMode(): AgentIdentityMode {
  return getMode();
}

export function getAgentExternalSigner(): ExternalAgentSigner | null {
  return getExternalSigner();
}

export async function resolveAgentConnection(): Promise<{
  mode: AgentIdentityMode;
  status: "observer" | "connected" | "error";
  agentId?: string;
  reason?: string;
}> {
  const mode = getMode();
  if (mode === "local") {
    try {
      const identity = await getOrCreateAgentIdentity();
      return {
        mode,
        status: "connected",
        agentId: identity.agentId
      };
    } catch (error) {
      return {
        mode,
        status: "error",
        reason:
          error instanceof Error
            ? error.message
            : "Unable to initialise local signing identity."
      };
    }
  }

  const signer = getExternalSigner();
  if (!signer) {
    return {
      mode,
      status: "observer",
      reason: "No agent signer detected in provider mode."
    };
  }

  try {
    const agentId = await getAgentId();
    return {
      mode,
      status: "connected",
      agentId
    };
  } catch (error) {
    return {
      mode,
      status: "error",
      reason:
        error instanceof Error ? error.message : "Unable to resolve provider-backed agent identity."
    };
  }
}
