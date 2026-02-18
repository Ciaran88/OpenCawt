import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { encodeBase58 } from "../../shared/base58";
import { signPayload } from "../../shared/signing";

export interface SmokeAgent {
  agentId: string;
  privateKey: CryptoKey;
}

let lastSignedTimestampSec = 0;

function nextSignedTimestampSec(): number {
  const now = Math.floor(Date.now() / 1000);
  if (now <= lastSignedTimestampSec) {
    lastSignedTimestampSec += 1;
    return lastSignedTimestampSec;
  }
  lastSignedTimestampSec = now;
  return now;
}

export function tempDbPath(name: string): string {
  return join("/tmp", `${name}.sqlite`);
}

export function resetTempDb(path: string): void {
  rmSync(path, { force: true });
}

export async function createSmokeAgent(): Promise<SmokeAgent> {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    agentId: encodeBase58(raw),
    privateKey: pair.privateKey
  };
}

export interface ManagedProcess {
  name: string;
  process: ChildProcessWithoutNullStreams;
}

export function startNodeTsxProcess(
  name: string,
  scriptPath: string,
  env: Record<string, string>
): ManagedProcess {
  const proc = spawn("node", ["--import", "tsx", scriptPath], {
    stdio: "pipe",
    env: {
      ...process.env,
      ...env
    }
  });

  proc.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${String(chunk)}`);
  });
  proc.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${String(chunk)}`);
  });

  return {
    name,
    process: proc
  };
}

export async function stopProcess(managed: ManagedProcess): Promise<void> {
  if (!managed.process.killed) {
    managed.process.kill("SIGTERM");
  }
  await once(managed.process, "exit");
}

export async function waitForHealth(url: string, timeoutMs = 25_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Timed out waiting for health at ${url}: ${String(lastError)}`);
}

export async function apiGet<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  const body = (await response.json()) as T | { error?: { message?: string; code?: string } };
  if (!response.ok) {
    throw new Error(
      `GET ${path} failed (${response.status}): ${JSON.stringify((body as any).error ?? body)}`
    );
  }
  return body as T;
}

export async function signedPostWithTimestamp<T>(input: {
  baseUrl: string;
  path: string;
  payload: Record<string, unknown>;
  agent: SmokeAgent;
  caseId?: string;
  idempotencyKey?: string;
  timestampSec: number;
}): Promise<{ body: T; headers: Record<string, string> }> {
  const signed = await signPayload({
    method: "POST",
    path: input.path,
    caseId: input.caseId,
    timestamp: input.timestampSec,
    payload: input.payload,
    privateKey: input.agent.privateKey
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Agent-Id": input.agent.agentId,
    "X-Timestamp": String(input.timestampSec),
    "X-Payload-Hash": signed.payloadHash,
    "X-Signature": signed.signature
  };
  if (input.idempotencyKey) {
    headers["Idempotency-Key"] = input.idempotencyKey;
  }

  const response = await fetch(`${input.baseUrl}${input.path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input.payload)
  });

  const body = (await response.json()) as T | { error?: { message?: string; code?: string } };
  if (!response.ok) {
    const error = (body as any).error;
    const message = error ? `${error.code}: ${error.message}` : JSON.stringify(body);
    throw new Error(`POST ${input.path} failed (${response.status}): ${message}`);
  }
  return { body: body as T, headers };
}

export async function signedPost<T>(input: {
  baseUrl: string;
  path: string;
  payload: Record<string, unknown>;
  agent: SmokeAgent;
  caseId?: string;
  idempotencyKey?: string;
}): Promise<T> {
  const timestamp = nextSignedTimestampSec();
  const { body } = await signedPostWithTimestamp<T>({
    ...input,
    timestampSec: timestamp
  });
  return body;
}

export async function expectErrorCode(input: {
  run: () => Promise<unknown>;
  expectedCode: string;
}): Promise<void> {
  let failed = false;
  try {
    await input.run();
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(
      message.includes(input.expectedCode),
      `Expected error code ${input.expectedCode}, got: ${message}`
    );
  }
  assert.ok(failed, `Expected error code ${input.expectedCode} but call succeeded.`);
}
