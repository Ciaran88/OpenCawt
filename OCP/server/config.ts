import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OcpConfig {
  appEnv: string;
  isProduction: boolean;
  isDevelopment: boolean;
  apiHost: string;
  apiPort: number;
  corsOrigin: string;
  publicBaseUrl: string;
  dbPath: string;
  opencawtDbPath: string;
  notifySigningKey: string;
  notifyTimeoutMs: number;
  notifyMaxAttempts: number;
  notifyBaseDelayMs: number;
  proposalTtlHours: number;
  solanaMode: "stub" | "rpc";
  logLevel: "debug" | "info" | "warn" | "error";
  systemApiKey: string;
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  /** URL of the OpenCawt mint worker — required when solanaMode === "rpc". */
  mintWorkerUrl: string;
  /** Shared secret sent as X-Worker-Token to the mint worker. */
  mintWorkerToken: string;
}

function loadEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};
  const path = join(process.cwd(), ".env");
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = val;
    }
  } catch {
    // no .env file, use process.env only
  }
  return env;
}

function get(
  env: Record<string, string>,
  key: string,
  fallback?: string
): string {
  const val = process.env[key] ?? env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`[OCP Config] Missing required env var: ${key}`);
  }
  return val;
}

function getInt(
  env: Record<string, string>,
  key: string,
  fallback: number
): number {
  const val = process.env[key] ?? env[key];
  if (val === undefined) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`[OCP Config] ${key} must be an integer`);
  return n;
}

function getOptional(
  env: Record<string, string>,
  key: string,
  fallback: string
): string {
  const val = process.env[key] ?? env[key];
  return val !== undefined ? val : fallback;
}

export function getConfig(): OcpConfig {
  const env = loadEnvFile();
  const appEnv = get(env, "OCP_APP_ENV", "development");
  const isProduction = appEnv === "production";
  const isDevelopment = !isProduction;

  const config: OcpConfig = {
    appEnv,
    isProduction,
    isDevelopment,
    apiHost: get(env, "OCP_HOST", "0.0.0.0"),
    apiPort: getInt(env, "OCP_PORT", 8788),
    corsOrigin: get(env, "OCP_CORS_ORIGIN", "http://localhost:5174"),
    publicBaseUrl: getOptional(env, "OCP_PUBLIC_URL", getOptional(env, "OCP_CORS_ORIGIN", "http://localhost:8788")).replace(/\/$/, ""),
    dbPath: get(env, "OCP_DB_PATH", "./runtime/ocp.sqlite"),
    opencawtDbPath: get(env, "OCP_OPENCAWT_DB_PATH", ""),
    notifySigningKey: get(env, "OCP_NOTIFY_SIGNING_KEY", isDevelopment ? "dev-ocp-notify-key" : ""),
    notifyTimeoutMs: getInt(env, "OCP_NOTIFY_TIMEOUT_MS", 8000),
    notifyMaxAttempts: getInt(env, "OCP_NOTIFY_MAX_ATTEMPTS", 5),
    notifyBaseDelayMs: getInt(env, "OCP_NOTIFY_BASE_DELAY_MS", 500),
    proposalTtlHours: getInt(env, "OCP_PROPOSAL_TTL_HOURS", 72),
    solanaMode: (get(env, "OCP_SOLANA_MODE", "stub") as "stub" | "rpc"),
    logLevel: (get(env, "OCP_LOG_LEVEL", "info") as OcpConfig["logLevel"]),
    systemApiKey: get(env, "OCP_SYSTEM_API_KEY", isDevelopment ? "dev-ocp-system-key" : ""),
    authRateLimitWindowMs: getInt(env, "OCP_AUTH_RATE_LIMIT_WINDOW_MS", 900_000),
    authRateLimitMax: getInt(env, "OCP_AUTH_RATE_LIMIT_MAX", 20),
    mintWorkerUrl:   getOptional(env, "OCP_MINT_WORKER_URL",   "http://localhost:8790"),
    mintWorkerToken: getOptional(env, "OCP_MINT_WORKER_TOKEN", "dev-worker-token"),
  };

  if (isProduction) {
    if (!config.notifySigningKey) throw new Error("[OCP Config] OCP_NOTIFY_SIGNING_KEY required in production");
    if (!config.systemApiKey) throw new Error("[OCP Config] OCP_SYSTEM_API_KEY required in production");
    if (config.systemApiKey === "dev-ocp-system-key" || config.systemApiKey.length < 32) {
      throw new Error("[OCP Config] OCP_SYSTEM_API_KEY must be at least 32 characters and not the dev default in production.");
    }
    if (config.notifySigningKey === "dev-ocp-notify-key" || config.notifySigningKey.length < 32) {
      throw new Error("[OCP Config] OCP_NOTIFY_SIGNING_KEY must be at least 32 characters and not the dev default in production.");
    }
    if (config.solanaMode === "rpc") {
      if (!config.mintWorkerUrl || config.mintWorkerUrl === "http://localhost:8790") {
        throw new Error("[OCP Config] OCP_MINT_WORKER_URL must be set to the remote mint worker URL in production.");
      }
      if (!config.mintWorkerToken || config.mintWorkerToken === "dev-worker-token") {
        throw new Error("[OCP Config] OCP_MINT_WORKER_TOKEN must be set and not the dev default in production.");
      }
    }
  }

  if (isDevelopment && (config.systemApiKey === "dev-ocp-system-key" || config.notifySigningKey === "dev-ocp-notify-key")) {
    console.warn("[OCP Config] Using dev defaults for OCP_SYSTEM_API_KEY and/or OCP_NOTIFY_SIGNING_KEY. Do not use in production.");
  }

  return config;
}
