import { createHmac } from "node:crypto";
import { canonicalJson } from "../../shared/canonicalJson";
import { createId } from "../../shared/ids";
import type { AppConfig } from "../config";
import { ApiError } from "./errors";
import { fetchWithRetry } from "./http";
import { validateNotifyUrl } from "./validation";

interface DispatchDefenceInviteInput {
  caseId: string;
  defendantAgentId: string;
  summary: string;
  responseDeadlineIso?: string;
  acceptEndpoint: string;
  notifyUrl: string;
}

export interface DispatchDefenceInviteResult {
  delivered: boolean;
  eventId: string;
  sentAtIso: string;
  statusCode?: number;
  error?: string;
}

export async function dispatchDefenceInvite(
  config: AppConfig,
  input: DispatchDefenceInviteInput
): Promise<DispatchDefenceInviteResult> {
  let notifyUrl: string;
  try {
    notifyUrl =
      (await validateNotifyUrl(input.notifyUrl, "notifyUrl")) ??
      input.notifyUrl;
  } catch (error) {
    return {
      delivered: false,
      eventId: createId("dinv"),
      sentAtIso: new Date().toISOString(),
      error: error instanceof ApiError ? error.code : "NOTIFY_URL_INVALID"
    };
  }

  const sentAtIso = new Date().toISOString();
  const eventId = createId("dinv");
  const payload = {
    event: "defence_invite",
    eventId,
    caseId: input.caseId,
    defendantAgentId: input.defendantAgentId,
    summary: input.summary,
    responseDeadlineIso: input.responseDeadlineIso ?? null,
    acceptEndpoint: input.acceptEndpoint,
    sentAtIso
  };
  const payloadBody = canonicalJson(payload);
  const signature = createHmac("sha256", config.defenceInviteSigningKey)
    .update(payloadBody, "utf8")
    .digest("hex");

  const requestId = createId("req");
  try {
    const response = await fetchWithRetry({
      url: notifyUrl,
      target: "defence_invite_webhook",
      requestId,
      attempts: config.retry.external.attempts,
      timeoutMs: config.retry.external.timeoutMs,
      baseDelayMs: config.retry.external.baseDelayMs,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenCawt-Event-Id": eventId,
          "X-OpenCawt-Signature": signature
        },
        body: payloadBody
      }
    });

    return {
      delivered: true,
      eventId,
      sentAtIso,
      statusCode: response.status
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        delivered: false,
        eventId,
        sentAtIso,
        statusCode: error.statusCode,
        error: `${error.code}:${requestId}`
      };
    }
    return {
      delivered: false,
      eventId,
      sentAtIso,
      error: error instanceof Error ? error.message : "DISPATCH_FAILED"
    };
  }
}
