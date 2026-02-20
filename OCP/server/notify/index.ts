import { createHmac } from "node:crypto";
import type { OcpConfig } from "../config";
import type { Db } from "../db/sqlite";
import { nowIso } from "../db/sqlite";
import { logNotifyAttempt } from "../db/repository";
import { createOcpId } from "../ids";

// Mirrors shared/canonicalJson.ts — sorts keys for stable HMAC input
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return (value as unknown[]).map(sortKeys);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

export type OcpEvent =
  | "agreement_proposed"
  | "agreement_accepted"
  | "agreement_sealed"
  | "agreement_dispute_filed";

export interface NotifyPayload {
  event: OcpEvent;
  eventId: string;
  sentAtIso: string;
  agentId: string;
  proposalId: string;
  agreementCode: string;
  body: Record<string, unknown>;
}

export interface NotifyResult {
  delivered: boolean;
  eventId: string;
  sentAtIso: string;
  statusCode?: number;
  error?: string;
  attempts: number;
}

async function attemptDispatch(
  signingKey: string,
  notifyUrl: string,
  payload: NotifyPayload,
  timeoutMs: number
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const payloadBody = canonicalJson(payload);
  const signature = createHmac("sha256", signingKey)
    .update(payloadBody, "utf8")
    .digest("hex");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OCP-Event-Id": payload.eventId,
        "X-OCP-Signature": signature,
      },
      body: payloadBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        error: `HTTP_${response.status}`,
      };
    }
    return { ok: true, statusCode: response.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "DISPATCH_FAILED",
    };
  } finally {
    clearTimeout(timer);
  }
}

function backoffMs(config: OcpConfig, attempt: number): number {
  return Math.min(
    config.notifyBaseDelayMs * Math.pow(2, attempt - 1),
    30_000
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatch a signed notification to a single agent's notifyUrl.
 * Retries with exponential backoff up to config.notifyMaxAttempts.
 * All attempts are logged to ocp_notify_log.
 * Notification failures do NOT throw — they are logged and returned.
 */
export async function dispatchNotification(
  db: Db,
  config: OcpConfig,
  options: {
    notifyUrl: string;
    agentId: string;
    proposalId: string;
    agreementCode: string;
    event: OcpEvent;
    body: Record<string, unknown>;
  }
): Promise<NotifyResult> {
  const eventId = createOcpId("nevt");
  const sentAtIso = nowIso();

  const payload: NotifyPayload = {
    event: options.event,
    eventId,
    sentAtIso,
    agentId: options.agentId,
    proposalId: options.proposalId,
    agreementCode: options.agreementCode,
    body: options.body,
  };

  let lastResult: { ok: boolean; statusCode?: number; error?: string } = {
    ok: false,
    error: "NOT_ATTEMPTED",
  };

  for (let attempt = 1; attempt <= config.notifyMaxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(backoffMs(config, attempt - 1));
    }

    lastResult = await attemptDispatch(
      config.notifySigningKey,
      options.notifyUrl,
      { ...payload, sentAtIso: nowIso() },
      config.notifyTimeoutMs
    );

    logNotifyAttempt(db, {
      logId: createOcpId("nlog"),
      proposalId: options.proposalId,
      agentId: options.agentId,
      event: options.event,
      eventId,
      attempt,
      status: lastResult.ok ? "delivered" : "failed",
      statusCode: lastResult.statusCode,
      error: lastResult.error,
      sentAtIso: nowIso(),
    });

    if (lastResult.ok) {
      return {
        delivered: true,
        eventId,
        sentAtIso,
        statusCode: lastResult.statusCode,
        attempts: attempt,
      };
    }
  }

  return {
    delivered: false,
    eventId,
    sentAtIso,
    statusCode: lastResult.statusCode,
    error: lastResult.error,
    attempts: config.notifyMaxAttempts,
  };
}

/**
 * Dispatch notifications to both parties concurrently.
 * Used after seal/dispute events.
 * Never throws — failures are logged.
 */
export async function notifyBothParties(
  db: Db,
  config: OcpConfig,
  options: {
    partyAAgentId: string;
    partyANotifyUrl: string;
    partyBAgentId: string;
    partyBNotifyUrl: string;
    proposalId: string;
    agreementCode: string;
    event: OcpEvent;
    body: Record<string, unknown>;
  }
): Promise<void> {
  await Promise.all([
    dispatchNotification(db, config, {
      notifyUrl: options.partyANotifyUrl,
      agentId: options.partyAAgentId,
      proposalId: options.proposalId,
      agreementCode: options.agreementCode,
      event: options.event,
      body: options.body,
    }),
    dispatchNotification(db, config, {
      notifyUrl: options.partyBNotifyUrl,
      agentId: options.partyBAgentId,
      proposalId: options.proposalId,
      agreementCode: options.agreementCode,
      event: options.event,
      body: options.body,
    }),
  ]);
}
