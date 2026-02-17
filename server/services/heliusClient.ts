import type { AppConfig } from "../config";
import { ApiError, badRequest } from "./errors";

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

export interface HeliusClient {
  callRpc<T>(method: string, params: unknown[]): Promise<T>;
  getTransaction(txSig: string): Promise<Record<string, unknown> | null>;
  getAsset(assetId: string): Promise<Record<string, unknown>>;
  searchAssets(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function withApiKey(url: string, apiKey?: string): string {
  if (!apiKey) {
    return url;
  }
  if (url.includes("api-key=")) {
    return url;
  }
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}api-key=${encodeURIComponent(apiKey)}`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(
  url: string,
  init: RequestInit,
  input: {
    attempts: number;
    timeoutMs: number;
    baseDelayMs: number;
    parse: (raw: unknown) => T;
  }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {})
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = (await response.json()) as unknown;
      return input.parse(json);
    } catch (error) {
      lastError = error;
      if (attempt < input.attempts) {
        const jitter = Math.floor(Math.random() * 90);
        await wait(input.baseDelayMs * attempt + jitter);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ApiError(502, "EXTERNAL_CALL_FAILED", `Helius request failed: ${String(lastError)}`);
}

class RpcHeliusClient implements HeliusClient {
  private readonly rpcUrl: string;
  private readonly dasUrl: string;

  constructor(private readonly config: AppConfig) {
    this.rpcUrl = withApiKey(config.heliusRpcUrl || config.solanaRpcUrl, config.heliusApiKey);
    this.dasUrl = withApiKey(config.heliusDasUrl || config.heliusRpcUrl, config.heliusApiKey);
  }

  async callRpc<T>(method: string, params: unknown[]): Promise<T> {
    const body = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    };

    const envelope = await fetchWithRetry<RpcEnvelope<T>>(this.rpcUrl, {
      method: "POST",
      body: JSON.stringify(body)
    }, {
      attempts: this.config.retry.external.attempts,
      timeoutMs: this.config.retry.external.timeoutMs,
      baseDelayMs: this.config.retry.external.baseDelayMs,
      parse: (raw) => raw as RpcEnvelope<T>
    });

    if (envelope.error) {
      throw badRequest("HELIUS_RPC_ERROR", envelope.error.message, {
        code: envelope.error.code,
        data: envelope.error.data
      });
    }

    if (typeof envelope.result === "undefined") {
      throw badRequest("HELIUS_RPC_EMPTY", "Helius RPC returned no result.");
    }

    return envelope.result;
  }

  async getTransaction(txSig: string): Promise<Record<string, unknown> | null> {
    return this.callRpc<Record<string, unknown> | null>("getTransaction", [
      txSig,
      {
        commitment: "finalized",
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0
      }
    ]);
  }

  async getAsset(assetId: string): Promise<Record<string, unknown>> {
    return this.callDas("getAsset", { id: assetId });
  }

  async searchAssets(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.callDas("searchAssets", params);
  }

  private async callDas(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    };

    const envelope = await fetchWithRetry<RpcEnvelope<Record<string, unknown>>>(
      this.dasUrl,
      {
        method: "POST",
        body: JSON.stringify(body)
      },
      {
        attempts: this.config.retry.das.attempts,
        timeoutMs: this.config.retry.das.timeoutMs,
        baseDelayMs: this.config.retry.das.baseDelayMs,
        parse: (raw) => raw as RpcEnvelope<Record<string, unknown>>
      }
    );

    if (envelope.error) {
      throw badRequest("HELIUS_DAS_ERROR", envelope.error.message, {
        code: envelope.error.code,
        data: envelope.error.data,
        method
      });
    }

    if (!envelope.result) {
      throw badRequest("HELIUS_DAS_EMPTY", `Helius DAS ${method} returned no result.`);
    }

    return envelope.result;
  }
}

class StubHeliusClient implements HeliusClient {
  async callRpc<T>(_method: string, _params: unknown[]): Promise<T> {
    return null as T;
  }

  async getTransaction(_txSig: string): Promise<Record<string, unknown> | null> {
    return {
      meta: {
        err: null,
        preBalances: [1000, 0],
        postBalances: [900, 100]
      },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: "stub_sender" },
            { pubkey: "OpenCawtTreasury111111111111111111111111111" }
          ]
        }
      }
    };
  }

  async getAsset(assetId: string): Promise<Record<string, unknown>> {
    return {
      id: assetId,
      content: { json_uri: `https://example.invalid/asset/${assetId}` }
    };
  }

  async searchAssets(_params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      total: 0,
      items: []
    };
  }
}

export function createHeliusClient(config: AppConfig): HeliusClient {
  if (config.solanaMode === "rpc") {
    return new RpcHeliusClient(config);
  }
  return new StubHeliusClient();
}
