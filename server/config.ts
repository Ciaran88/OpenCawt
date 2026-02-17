import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TimingRules } from "../shared/contracts";

interface NumericLimitConfig {
  maxEvidenceItemsPerCase: number;
  maxEvidenceCharsPerItem: number;
  maxEvidenceCharsPerCase: number;
  maxSubmissionCharsPerPhase: number;
}

interface RateLimitConfig {
  filingPer24h: number;
  evidencePerHour: number;
  submissionsPerHour: number;
  ballotsPerHour: number;
}

export interface RetryConfig {
  attempts: number;
  baseDelayMs: number;
  timeoutMs: number;
}

export interface AppConfig {
  apiHost: string;
  apiPort: number;
  corsOrigin: string;
  dbPath: string;
  signatureSkewSec: number;
  systemApiKey: string;
  workerToken: string;
  softDailyCaseCap: number;
  softCapMode: "warn" | "enforce";
  filingFeeLamports: number;
  treasuryAddress: string;
  solanaMode: "stub" | "rpc";
  solanaRpcUrl: string;
  drandMode: "stub" | "http";
  drandBaseUrl: string;
  sealWorkerMode: "stub" | "http";
  sealWorkerUrl: string;
  heliusApiKey?: string;
  heliusRpcUrl: string;
  heliusDasUrl: string;
  heliusWebhookToken?: string;
  rules: TimingRules;
  limits: NumericLimitConfig;
  rateLimits: RateLimitConfig;
  idempotencyTtlSec: number;
  retry: {
    external: RetryConfig;
    das: RetryConfig;
  };
  logLevel: "debug" | "info" | "warn" | "error";
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

function optionalStringEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getConfig(): AppConfig {
  loadEnvFile();
  const port = process.env.PORT ? Number(process.env.PORT) : numberEnv("API_PORT", 8787);
  const host = process.env.PORT ? "0.0.0.0" : stringEnv("API_HOST", "127.0.0.1");
  return {
    apiHost: host,
    apiPort: port,
    corsOrigin: stringEnv("CORS_ORIGIN", "http://127.0.0.1:5173"),
    dbPath: stringEnv("DB_PATH", "./runtime/opencawt.sqlite"),
    signatureSkewSec: numberEnv("SIGNATURE_SKEW_SEC", 300),
    systemApiKey: stringEnv("SYSTEM_API_KEY", "dev-system-key"),
    workerToken: stringEnv("WORKER_TOKEN", "dev-worker-token"),
    softDailyCaseCap: numberEnv("SOFT_DAILY_CASE_CAP", 50),
    softCapMode: stringEnv("SOFT_CAP_MODE", "warn") as "warn" | "enforce",
    filingFeeLamports: numberEnv("FILING_FEE_LAMPORTS", 5000000),
    treasuryAddress: stringEnv("TREASURY_ADDRESS", "OpenCawtTreasury111111111111111111111111111"),
    solanaMode: stringEnv("SOLANA_MODE", "stub") as "stub" | "rpc",
    solanaRpcUrl: stringEnv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
    drandMode: stringEnv("DRAND_MODE", "stub") as "stub" | "http",
    drandBaseUrl: stringEnv("DRAND_BASE_URL", "https://api.drand.sh"),
    sealWorkerMode: stringEnv("SEAL_WORKER_MODE", "stub") as "stub" | "http",
    sealWorkerUrl: stringEnv("SEAL_WORKER_URL", "http://127.0.0.1:8790"),
    heliusApiKey: optionalStringEnv("HELIUS_API_KEY"),
    heliusRpcUrl: stringEnv("HELIUS_RPC_URL", "https://mainnet.helius-rpc.com"),
    heliusDasUrl: stringEnv("HELIUS_DAS_URL", "https://mainnet.helius-rpc.com"),
    heliusWebhookToken: optionalStringEnv("HELIUS_WEBHOOK_TOKEN"),
    rules: {
      sessionStartsAfterSeconds: numberEnv("RULE_SESSION_START_DELAY_SEC", 3600),
      defenceAssignmentCutoffSeconds: numberEnv("RULE_DEFENCE_ASSIGNMENT_CUTOFF_SEC", 2700),
      namedDefendantExclusiveSeconds: numberEnv("RULE_NAMED_DEFENDANT_EXCLUSIVE_SEC", 900),
      jurorReadinessSeconds: numberEnv("RULE_JUROR_READINESS_SEC", 60),
      stageSubmissionSeconds: numberEnv("RULE_STAGE_SUBMISSION_SEC", 1800),
      jurorVoteSeconds: numberEnv("RULE_JUROR_VOTE_SEC", 900),
      votingHardTimeoutSeconds: numberEnv("RULE_VOTING_HARD_TIMEOUT_SEC", 7200),
      jurorPanelSize: numberEnv("RULE_JUROR_PANEL_SIZE", 11)
    },
    limits: {
      maxEvidenceItemsPerCase: numberEnv("MAX_EVIDENCE_ITEMS_PER_CASE", 25),
      maxEvidenceCharsPerItem: numberEnv("MAX_EVIDENCE_CHARS_PER_ITEM", 10000),
      maxEvidenceCharsPerCase: numberEnv("MAX_EVIDENCE_CHARS_PER_CASE", 250000),
      maxSubmissionCharsPerPhase: numberEnv("MAX_SUBMISSION_CHARS_PER_PHASE", 20000)
    },
    rateLimits: {
      filingPer24h: numberEnv("RATE_LIMIT_FILINGS_PER_24H", 1),
      evidencePerHour: numberEnv("RATE_LIMIT_EVIDENCE_PER_HOUR", 20),
      submissionsPerHour: numberEnv("RATE_LIMIT_SUBMISSIONS_PER_HOUR", 20),
      ballotsPerHour: numberEnv("RATE_LIMIT_BALLOTS_PER_HOUR", 20)
    },
    idempotencyTtlSec: numberEnv("IDEMPOTENCY_TTL_SEC", 86400),
    retry: {
      external: {
        attempts: numberEnv("EXTERNAL_RETRY_ATTEMPTS", 4),
        baseDelayMs: numberEnv("EXTERNAL_RETRY_BASE_MS", 220),
        timeoutMs: numberEnv("EXTERNAL_TIMEOUT_MS", 7000)
      },
      das: {
        attempts: numberEnv("DAS_RETRY_ATTEMPTS", 8),
        baseDelayMs: numberEnv("DAS_RETRY_BASE_MS", 600),
        timeoutMs: numberEnv("DAS_TIMEOUT_MS", 9000)
      }
    },
    logLevel: stringEnv("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error"
  };
}
