/**
 * API integration tests: API key auth, invalid key, rate limiting.
 * Spawns the OCP server and makes HTTP requests.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeBase58 } from "../shared/base58";

function httpGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const API_PORT = 18788;
const BASE = `http://127.0.0.1:${API_PORT}`;

type Result = { passed: number; failed: number };

async function test(name: string, fn: () => void | Promise<void>, results: Result): Promise<void> {
  try {
    await fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    const msg = err instanceof assert.AssertionError
      ? `Expected ${JSON.stringify(err.expected)}, got ${JSON.stringify(err.actual)}`
      : (err instanceof Error ? err.message : String(err));
    console.error(`  ✗ ${name}: ${msg}`);
  }
}

async function generateKeypair(): Promise<{ agentId: string; privateKey: CryptoKey }> {
  const keypair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const publicKeyRaw = await crypto.subtle.exportKey("raw", keypair.publicKey as CryptoKey);
  const agentId = encodeBase58(new Uint8Array(publicKeyRaw));
  return { agentId, privateKey: keypair.privateKey as CryptoKey };
}

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

async function signRequest(
  privateKey: CryptoKey,
  method: string,
  path: string,
  body: string
): Promise<{ timestamp: string; nonce: string; bodySha256: string; signature: string }> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = `test_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const bodySha256 = sha256hex(body);
  const signingString = `OCPv1|${method}|${path}|${timestamp}|${nonce}|${bodySha256}`;
  const digest = createHash("sha256").update(signingString, "utf8").digest();
  const sigBytes = await crypto.subtle.sign("Ed25519", privateKey, digest);
  const signature = Buffer.from(sigBytes).toString("base64");
  return { timestamp, nonce, bodySha256, signature };
}

export async function run(): Promise<{ passed: number; failed: number }> {
  const results: Result = { passed: 0, failed: 0 };
  const tmpDir = mkdtempSync(join(tmpdir(), "ocp-api-test-"));
  const dbPath = join(tmpDir, "test.sqlite");

  const env = {
    ...process.env,
    OCP_APP_ENV: "development",
    OCP_DB_PATH: dbPath,
    OCP_PORT: String(API_PORT),
    OCP_HOST: "127.0.0.1",
    OCP_CORS_ORIGIN: "http://localhost:5174",
    OCP_AUTH_RATE_LIMIT_WINDOW_MS: "60000",
    OCP_AUTH_RATE_LIMIT_MAX: "5",
  };

  const server = spawn("node", ["--import", "tsx", "server/main.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const waitForServer = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const poll = async () => {
        try {
          const res = await fetch(`${BASE}/v1/health`);
          if (res.ok) {
            resolve();
            return;
          }
        } catch {
          /* not ready */
        }
        if (Date.now() > deadline) {
          reject(new Error("Server did not become ready in 5s"));
          return;
        }
        setTimeout(poll, 100);
      };
      poll();
    });

  try {
    await waitForServer();

    const { agentId, privateKey } = await generateKeypair();

    await test("Register agent", async () => {
      const body = JSON.stringify({ notifyUrl: "https://test.example.com/webhook" });
      const { timestamp, nonce, bodySha256, signature } = await signRequest(
        privateKey,
        "POST",
        "/v1/agents/register",
        body
      );
      const res = await fetch(`${BASE}/v1/agents/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OCP-Agent-Id": agentId,
          "X-OCP-Timestamp": timestamp,
          "X-OCP-Nonce": nonce,
          "X-OCP-Body-Sha256": bodySha256,
          "X-OCP-Signature": signature,
        },
        body,
      });
      assert.strictEqual(res.status, 200);
    }, results);

    let rawApiKey: string;

    await test("Create API key via Ed25519", async () => {
      const body = JSON.stringify({ label: "test-key" });
      const { timestamp, nonce, bodySha256, signature } = await signRequest(
        privateKey,
        "POST",
        "/v1/api-keys",
        body
      );
      const res = await fetch(`${BASE}/v1/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OCP-Agent-Id": agentId,
          "X-OCP-Timestamp": timestamp,
          "X-OCP-Nonce": nonce,
          "X-OCP-Body-Sha256": bodySha256,
          "X-OCP-Signature": signature,
        },
        body,
      });
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as { key: string };
      assert.ok(data.key?.startsWith("ocp_"));
      rawApiKey = data.key.trim();
    }, results);

    await test("GET /v1/api-keys with X-OCP-Api-Key returns 200", async () => {
      const { status, body } = await httpGet(`${BASE}/v1/api-keys`, {
        "X-OCP-Api-Key": rawApiKey,
      });
      assert.strictEqual(status, 200, `Expected 200, got ${status}: ${body}`);
      const data = JSON.parse(body) as { keys: unknown[] };
      assert.ok(Array.isArray(data.keys));
    }, results);

    await test("GET /v1/api-keys with Authorization Bearer returns 200", async () => {
      const { status, body } = await httpGet(`${BASE}/v1/api-keys`, {
        Authorization: `Bearer ${rawApiKey}`,
      });
      assert.strictEqual(status, 200, `Expected 200, got ${status}: ${body}`);
      const data = JSON.parse(body) as { keys: unknown[] };
      assert.ok(Array.isArray(data.keys));
    }, results);

    await test("GET /v1/api-keys with invalid API key returns 401", async () => {
      const res = await fetch(`${BASE}/v1/api-keys`, {
        headers: { Authorization: "Bearer ocp_invalid_key_xxxxxxxxxxxxxxxxxxxxxxxx" },
      });
      assert.strictEqual(res.status, 401);
    }, results);

    await test("Rate limit: 429 after N failed auth attempts", async () => {
      let got429 = false;
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`${BASE}/v1/api-keys`, {
          headers: { Authorization: "Bearer ocp_badkey123456789012345678901234567890" },
        });
        if (res.status === 429) {
          got429 = true;
          break;
        }
      }
      assert.ok(got429, "Expected 429 after repeated failed auth");
    }, results);
  } finally {
    server.kill("SIGTERM");
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return results;
}
