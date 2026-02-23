import { createHmac } from "node:crypto";
import { canonicalJson } from "../../shared/canonicalJson";
import { createId } from "../../shared/ids";
import type { AppConfig } from "../config";
import { ApiError } from "./errors";
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

const REQUEST_TIMEOUT_MS = 8000;

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenCawt-Event-Id": eventId,
        "X-OpenCawt-Signature": signature
      },
      body: payloadBody,
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        delivered: false,
        eventId,
        sentAtIso,
        statusCode: response.status,
        error: `HTTP_${response.status}`
      };
    }

    return {
      delivered: true,
      eventId,
      sentAtIso,
      statusCode: response.status
    };
  } catch (error) {
    return {
      delivered: false,
      eventId,
      sentAtIso,
      error: error instanceof Error ? error.message : "DISPATCH_FAILED"
    };
  } finally {
    clearTimeout(timer);
  }
}
