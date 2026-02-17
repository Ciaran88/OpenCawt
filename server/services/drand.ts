import { canonicalJson } from "../../shared/canonicalJson";
import { sha256Hex } from "../../shared/hash";
import type { AppConfig } from "../config";

export interface DrandRoundData {
  round: number;
  randomness: string;
  chainInfo: {
    publicKey?: string;
    periodSeconds?: number;
    genesisTime?: number;
    hash?: string;
  };
}

interface DrandInfoResponse {
  public_key?: string;
  period?: number;
  genesis_time?: number;
  hash?: string;
}

interface DrandRoundResponse {
  round: number;
  randomness: string;
}

export interface DrandClient {
  getRoundAtOrAfter(timestampMs: number): Promise<DrandRoundData>;
}

class StubDrandClient implements DrandClient {
  async getRoundAtOrAfter(timestampMs: number): Promise<DrandRoundData> {
    const round = Math.max(1, Math.ceil(timestampMs / 30000));
    const randomness = await sha256Hex(`stub-drand:${round}`);
    return {
      round,
      randomness,
      chainInfo: {
        periodSeconds: 30,
        genesisTime: 0,
        hash: await sha256Hex(canonicalJson({ mode: "stub" }))
      }
    };
  }
}

class HttpDrandClient implements DrandClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly baseDelayMs: number;

  constructor(baseUrl: string, config: AppConfig) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.retry.external.timeoutMs;
    this.attempts = config.retry.external.attempts;
    this.baseDelayMs = config.retry.external.baseDelayMs;
  }

  async getRoundAtOrAfter(timestampMs: number): Promise<DrandRoundData> {
    const info = await this.fetchJson<DrandInfoResponse>(`${this.baseUrl}/info`);
    const periodSeconds = info.period ?? 30;
    const genesisTime = info.genesis_time ?? 0;

    const targetRound = Math.max(
      1,
      Math.ceil((Math.floor(timestampMs / 1000) - genesisTime) / periodSeconds)
    );

    const round = await this.fetchJson<DrandRoundResponse>(`${this.baseUrl}/public/${targetRound}`);

    return {
      round: round.round,
      randomness: round.randomness,
      chainInfo: {
        publicKey: info.public_key,
        periodSeconds,
        genesisTime,
        hash: info.hash
      }
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json"
          }
        });
        if (!response.ok) {
          throw new Error(`drand request failed: ${response.status}`);
        }
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts) {
          const jitter = Math.floor(Math.random() * 75);
          await new Promise((resolve) =>
            setTimeout(resolve, this.baseDelayMs * attempt + jitter)
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`drand request failed after retries: ${String(lastError)}`);
  }
}

export function createDrandClient(config: AppConfig): DrandClient {
  if (config.drandMode === "http") {
    return new HttpDrandClient(config.drandBaseUrl, config);
  }
  return new StubDrandClient();
}
