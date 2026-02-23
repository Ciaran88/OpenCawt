import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { TimingRules } from "../shared/contracts";

interface NumericLimitConfig {
  maxEvidenceItemsPerCase: number;
  maxEvidenceCharsPerItem: number;
  maxEvidenceCharsPerCase: number;
  maxSubmissionCharsPerPhase: number;
  maxClaimSummaryChars: number;
  maxCaseTitleChars: number;
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
  appEnv: string;
  isProduction: boolean;
  isDevelopment: boolean;
  apiHost: string;
  apiPort: number;
  corsOrigin: string;
  dbPath: string;
  backupDir: string;
  backupRetentionCount: number;
  signatureSkewSec: number;
  systemApiKey: string;
  workerToken: string;
  sealJobMaxAttempts: number;
  defenceInviteSigningKey: string;
  defenceInviteRetrySec: number;
  capabilityKeysEnabled: boolean;
  capabilityKeyTtlSec: number;
  capabilityKeyMaxActivePerAgent: number;
  softDailyCaseCap: number;
  softCapMode: "warn" | "enforce";
  filingFeeLamports: number;
  paymentEstimateCuMarginPct: number;
  paymentEstimateMinCuLimit: number;
  paymentEstimateCacheSec: number;
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
  heliusWebhookEnabled: boolean;
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
  adminPanelPassword: string;
  adminSessionTtlSec: number;
  judgeOpenAiApiKey: string;
  judgeOpenAiModel: string;
}

export function isDurableDbPath(pathValue: string): boolean {
  const normalised = pathValue.trim();
  if (!normalised) {
    return false;
  }
  if (!isAbsolute(normalised)) {
    return false;
  }
  if (normalised.startsWith("/tmp/")) {
    return false;
  }
  if (normalised === "/tmp") {
    return false;
  }
  return normalised.startsWith("/data/");
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

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const normalised = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalised);
}

function resolveAppEnv(): string {
  return (process.env.APP_ENV || process.env.NODE_ENV || "development").trim().toLowerCase();
}

function validateConfig(config: AppConfig): void {
  const nonDev = !config.isDevelopment;
  if (nonDev) {
    if (!config.systemApiKey || config.systemApiKey === "dev-system-key") {
      throw new Error(
        "SYSTEM_API_KEY must be set to a strong non-default value outside development or test."
      );
    }
    if (!config.workerToken || config.workerToken === "dev-worker-token") {
      throw new Error(
        "WORKER_TOKEN must be set to a strong non-default value outside development or test."
      );
    }
    if (
      !config.adminPanelPassword ||
      config.adminPanelPassword === "gringos" ||
      config.adminPanelPassword.trim().length < 12
    ) {
      throw new Error(
        "ADMIN_PANEL_PASSWORD must be set to a strong non-default value (minimum 12 characters) outside development or test."
      );
    }
    if (config.corsOrigin.trim() === "*") {
      throw new Error("CORS_ORIGIN cannot be wildcard in non-development environments.");
    }
    const defenceInviteKey = config.defenceInviteSigningKey.trim();
    const uniqueChars = new Set(defenceInviteKey).size;
    if (
      !defenceInviteKey ||
      defenceInviteKey === "dev-defence-invite-signing-key" ||
      defenceInviteKey.length < 32 ||
      uniqueChars < 12
    ) {
      throw new Error(
        "DEFENCE_INVITE_SIGNING_KEY must be set to a strong non-default value outside development or test."
      );
    }
  }

  if (config.isProduction) {
    if (config.solanaMode === "stub") {
      throw new Error("SOLANA_MODE=stub is not allowed in production.");
    }
    if (config.drandMode === "stub") {
      throw new Error("DRAND_MODE=stub is not allowed in production.");
    }
    if (config.sealWorkerMode === "stub") {
      throw new Error("SEAL_WORKER_MODE=stub is not allowed in production.");
    }
    if (!isDurableDbPath(config.dbPath)) {
      throw new Error(
        "In production, DB_PATH must be an absolute durable path under /data (for example /data/opencawt.sqlite)."
      );
    }
    const courtMode = (process.env.COURT_MODE ?? "").trim().toLowerCase();
    if (courtMode === "judge" && !config.judgeOpenAiApiKey) {
      throw new Error(
        "JUDGE_OPENAI_API_KEY must be set when COURT_MODE=judge in production."
      );
    }
  }

  if (config.heliusWebhookEnabled && !config.heliusWebhookToken) {
    throw new Error(
      "HELIUS_WEBHOOK_ENABLED is true but HELIUS_WEBHOOK_TOKEN is not configured."
    );
  }
}

export function getConfig(): AppConfig {
  loadEnvFile();
  const appEnv = resolveAppEnv();
  const isDevelopment = ["development", "dev", "test"].includes(appEnv);
  const isProduction = ["production", "prod"].includes(appEnv);
  const port = process.env.PORT ? Number(process.env.PORT) : numberEnv("API_PORT", 8787);
  const host = process.env.PORT ? "0.0.0.0" : stringEnv("API_HOST", "127.0.0.1");
  const config: AppConfig = {
    appEnv,
    isProduction,
    isDevelopment,
    apiHost: host,
    apiPort: port,
    corsOrigin: stringEnv("CORS_ORIGIN", "http://127.0.0.1:5173"),
    dbPath: stringEnv("DB_PATH", "./runtime/opencawt.sqlite"),
    backupDir: stringEnv("BACKUP_DIR", isProduction ? "/data/backups" : "./runtime/backups"),
    backupRetentionCount: Math.max(1, numberEnv("BACKUP_RETENTION_COUNT", 30)),
    signatureSkewSec: numberEnv("SIGNATURE_SKEW_SEC", 300),
    systemApiKey: stringEnv("SYSTEM_API_KEY", "dev-system-key"),
    workerToken: stringEnv("WORKER_TOKEN", "dev-worker-token"),
    sealJobMaxAttempts: numberEnv("SEAL_JOB_MAX_ATTEMPTS", 8),
    defenceInviteSigningKey: stringEnv(
      "DEFENCE_INVITE_SIGNING_KEY",
      "dev-defence-invite-signing-key"
    ),
    defenceInviteRetrySec: numberEnv("DEFENCE_INVITE_RETRY_SEC", 300),
    capabilityKeysEnabled: booleanEnv("CAPABILITY_KEYS_ENABLED", false),
    capabilityKeyTtlSec: numberEnv("CAPABILITY_KEY_TTL_SEC", 2592000),
    capabilityKeyMaxActivePerAgent: numberEnv("CAPABILITY_KEY_MAX_ACTIVE_PER_AGENT", 5),
    softDailyCaseCap: numberEnv("SOFT_DAILY_CASE_CAP", 50),
    softCapMode: stringEnv("SOFT_CAP_MODE", "warn") as "warn" | "enforce",
    filingFeeLamports: numberEnv("FILING_FEE_LAMPORTS", 5000000),
    paymentEstimateCuMarginPct: Math.max(0, numberEnv("PAYMENT_ESTIMATE_CU_MARGIN_PCT", 10)),
    paymentEstimateMinCuLimit: Math.max(10_000, numberEnv("PAYMENT_ESTIMATE_MIN_CU_LIMIT", 50_000)),
    paymentEstimateCacheSec: Math.max(0, numberEnv("PAYMENT_ESTIMATE_CACHE_SEC", 20)),
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
    heliusWebhookEnabled: booleanEnv("HELIUS_WEBHOOK_ENABLED", false),
    heliusWebhookToken: optionalStringEnv("HELIUS_WEBHOOK_TOKEN"),
    rules: {
      sessionStartsAfterSeconds: numberEnv("RULE_SESSION_START_DELAY_SEC", 3600),
      defenceAssignmentCutoffSeconds: numberEnv("RULE_DEFENCE_ASSIGNMENT_CUTOFF_SEC", 2700),
      namedDefendantExclusiveSeconds: numberEnv("RULE_NAMED_DEFENDANT_EXCLUSIVE_SEC", 900),
      namedDefendantResponseSeconds: numberEnv("RULE_NAMED_DEFENDANT_RESPONSE_SEC", 86400),
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
      maxSubmissionCharsPerPhase: numberEnv("MAX_SUBMISSION_CHARS_PER_PHASE", 20000),
      maxClaimSummaryChars: numberEnv("MAX_CLAIM_SUMMARY_CHARS", 400),
      maxCaseTitleChars: numberEnv("MAX_CASE_TITLE_CHARS", 40)
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
    logLevel: stringEnv("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error",
    adminPanelPassword: stringEnv("ADMIN_PANEL_PASSWORD", "gringos"),
    adminSessionTtlSec: numberEnv("ADMIN_SESSION_TTL_SEC", 900),
    judgeOpenAiApiKey: stringEnv("JUDGE_OPENAI_API_KEY", ""),
    judgeOpenAiModel: stringEnv("JUDGE_OPENAI_MODEL", "gpt-5-mini")
  };
  validateConfig(config);
  return config;
}
