/**
 * Lightweight Helius RPC client for OCP.
 *
 * Mirrors the main app's `server/services/heliusClient.ts` but uses OcpConfig
 * directly, avoiding the AppConfig dependency.
 */
import type { OcpConfig } from "../config";

interface RpcEnvelope<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface OcpHeliusClient {
  callRpc<T>(method: string, params: unknown[]): Promise<T>;
  getTransaction(txSig: string): Promise<Record<string, unknown> | null>;
}

function withApiKey(url: string, apiKey?: string): string {
  if (!apiKey) return url;
  if (url.includes("api-key=")) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}api-key=${encodeURIComponent(apiKey)}`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const RPC_ATTEMPTS = 3;
const RPC_BASE_DELAY_MS = 500;
const RPC_TIMEOUT_MS = 7_000;

async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  opts: { parse: (raw: unknown) => T }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = (await response.json()) as unknown;
      return opts.parse(json);
    } catch (error) {
      lastError = error;
      if (attempt < RPC_ATTEMPTS) {
        const jitter = Math.floor(Math.random() * 90);
        await wait(RPC_BASE_DELAY_MS * attempt + jitter);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`OCP Helius RPC failed after ${RPC_ATTEMPTS} attempts: ${String(lastError)}`);
}

class RpcOcpHeliusClient implements OcpHeliusClient {
  private readonly rpcUrl: string;

  constructor(config: OcpConfig) {
    this.rpcUrl = withApiKey(config.heliusRpcUrl, config.heliusApiKey || undefined);
  }

  async callRpc<T>(method: string, params: unknown[]): Promise<T> {
    const body = { jsonrpc: "2.0", id: Date.now(), method, params };
    const envelope = await fetchWithRetry<RpcEnvelope<T>>(
      this.rpcUrl,
      { method: "POST", body: JSON.stringify(body) },
      { parse: (raw) => raw as RpcEnvelope<T> }
    );
    if (envelope.error) {
      throw new Error(`HELIUS_RPC_ERROR: ${envelope.error.message} (code ${envelope.error.code})`);
    }
    if (typeof envelope.result === "undefined") {
      throw new Error("HELIUS_RPC_EMPTY: Helius RPC returned no result.");
    }
    return envelope.result;
  }

  async getTransaction(txSig: string): Promise<Record<string, unknown> | null> {
    return this.callRpc<Record<string, unknown> | null>("getTransaction", [
      txSig,
      { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]);
  }
}

class StubOcpHeliusClient implements OcpHeliusClient {
  async callRpc<T>(_method: string, _params: unknown[]): Promise<T> {
    return null as T;
  }

  async getTransaction(_txSig: string): Promise<Record<string, unknown> | null> {
    return {
      meta: {
        err: null,
        preBalances: [1_000_000_000, 0],
        postBalances: [994_000_000, 6_000_000],
      },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: "stub_sender", signer: true },
            { pubkey: "OpenCawtTreasury111111111111111111111111111" },
          ],
        },
      },
    };
  }
}

export function createOcpHeliusClient(config: OcpConfig): OcpHeliusClient {
  if (config.solanaMode === "rpc") {
    return new RpcOcpHeliusClient(config);
  }
  return new StubOcpHeliusClient();
}
