import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface MintWorkerConfig {
  host: string;
  port: number;
  token: string;
  mode: "stub" | "bubblegum_v2";
  heliusApiKey?: string;
  heliusRpcUrl: string;
  heliusDasUrl: string;
  bubblegumMintEndpoint?: string;
  externalTimeoutMs: number;
  externalAttempts: number;
  externalBaseDelayMs: number;
}

let envLoaded = false;

function loadEnvFile(): void {
  if (envLoaded) {
    return;
  }
  envLoaded = true;

  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getMintWorkerConfig(): MintWorkerConfig {
  loadEnvFile();
  return {
    host: stringEnv("MINT_WORKER_HOST", "127.0.0.1"),
    port: numberEnv("MINT_WORKER_PORT", 8790),
    token: stringEnv("WORKER_TOKEN", "dev-worker-token"),
    mode: stringEnv("MINT_WORKER_MODE", "stub") as "stub" | "bubblegum_v2",
    heliusApiKey: optionalEnv("HELIUS_API_KEY"),
    heliusRpcUrl: stringEnv("HELIUS_RPC_URL", "https://mainnet.helius-rpc.com"),
    heliusDasUrl: stringEnv("HELIUS_DAS_URL", "https://mainnet.helius-rpc.com"),
    bubblegumMintEndpoint: optionalEnv("BUBBLEGUM_MINT_ENDPOINT"),
    externalTimeoutMs: numberEnv("EXTERNAL_TIMEOUT_MS", 10000),
    externalAttempts: numberEnv("EXTERNAL_RETRY_ATTEMPTS", 4),
    externalBaseDelayMs: numberEnv("EXTERNAL_RETRY_BASE_MS", 220)
  };
}
