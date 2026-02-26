import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";
import { openDatabase, nowIso } from "./db/sqlite";
import {
  upsertOcpAgent,
  getOcpAgent,
  suspendOcpAgent,
  createAgreement,
  getAgreement,
  getAgreementByCode,
  listAgreementsForAgent,
  markAgreementAccepted,
  markAgreementSealed,
  markAgreementExpired,
  cancelAgreement,
  isTermsHashDuplicate,
  storeSignature,
  getSignaturesForProposal,
  createReceipt,
  getReceipt,
  getReceiptByCode,
  insertNonceIfAbsent,
  pruneExpiredNonces,
  createDecision,
  getDecision,
  getDecisionByCode,
  addDecisionSigner,
  getDecisionSigners,
  storeDecisionSignature,
  getDecisionSignatures,
  sealDecision,
  cancelDecision,
  createApiKey,
  getApiKeyByHash,
  listApiKeysForAgent,
  revokeApiKey,
  getIdempotentResponse,
  storeIdempotentResponse,
  saveUsedTreasuryTx,
  isTreasuryTxUsed,
  type DecisionType,
} from "./db/repository";
import {
  buildCanonicalTerms,
  toCanonicalJsonString,
  computeTermsHash,
  buildAttestationString,
  hashAttestationString,
  type CanonicalTerms,
} from "./canonicalise/index";
import { createOcpId, deriveAgreementCode } from "./ids";
import { dispatchNotification, notifyBothParties } from "./notify/index";
import { mintAgreementReceipt } from "./mint/index";
import { verifyBothAttestations } from "./verify/index";
import { crossRegisterAgentsInCourt } from "./court/crossRegister";
import { decodeBase58 } from "../shared/base58";
import { canonicalHashHex } from "../../shared/hash";
import { createOcpHeliusClient } from "./services/ocpHeliusClient";
import { createOcpFeeEstimator, isValidSolanaPubkey } from "./services/ocpFeeEstimator";
import { createOcpSolanaVerifier } from "./services/ocpSolanaVerifier";
import { isValidNotifyUrl } from "./notifyUrlValidation";

const config = getConfig();
const db = openDatabase(config.dbPath);

// ── Fee services ──
const ocpHelius = createOcpHeliusClient(config);
const ocpFeeEstimator = createOcpFeeEstimator(config, ocpHelius);
const ocpSolanaVerifier = createOcpSolanaVerifier(config, ocpHelius);

// ---- HTTP helpers ----

const ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "Idempotency-Key",
  "X-OCP-Agent-Id",
  "X-OCP-Timestamp",
  "X-OCP-Nonce",
  "X-OCP-Body-Sha256",
  "X-OCP-Signature",
  "X-OCP-Signature-Version",
  "X-OCP-Api-Key",
  // Legacy headers (kept for /api/ocp/ backward compatibility)
  "X-Agent-Id",
  "X-Timestamp",
  "X-Payload-Hash",
  "X-Signature",
  "X-System-Key",
].join(",");

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
}

function setSecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (config.isProduction) {
    const proto = (req.headers["x-forwarded-proto"] as string) ?? "";
    if (proto === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(body);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string
): void {
  sendJson(res, status, { error: { code, message } });
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; parsed: unknown }> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
      if (raw.length > 512_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve({ raw, parsed: raw ? (JSON.parse(raw) as unknown) : {} });
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

// ---- Auth rate limiter ----

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

const authRateLimiter = {
  map: new Map<string, { count: number; resetAt: number }>(),
  isLimited(ip: string): boolean {
    const entry = this.map.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      this.map.delete(ip);
      return false;
    }
    return entry.count >= config.authRateLimitMax;
  },
  recordFailure(ip: string): void {
    const now = Date.now();
    const entry = this.map.get(ip);
    if (!entry || now > entry.resetAt) {
      this.map.set(ip, { count: 1, resetAt: now + config.authRateLimitWindowMs });
    } else {
      entry.count++;
    }
    if (Math.random() < 0.01) {
      for (const [k, v] of this.map) {
        if (Date.now() > v.resetAt) this.map.delete(k);
      }
    }
  },
};

function sendAuthFailure(
  res: ServerResponse,
  code: string,
  message: string,
  ip: string
): void {
  authRateLimiter.recordFailure(ip);
  sendError(res, 401, code, message);
}

// ---- Auth helpers ----

function assertSystemKey(req: IncomingMessage, res: ServerResponse): boolean {
  const key = req.headers["x-system-key"];
  if (key !== config.systemApiKey) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid system key.");
    return false;
  }
  return true;
}

/**
 * New v1 signing scheme: X-OCP-* headers.
 *
 * Signing string:
 *   "OCPv1|{method}|{path}|{timestamp}|{nonce}|{bodySha256}"
 *
 * The caller Ed25519-signs sha256(signingString) with their private key
 * and sends the base64 result in X-OCP-Signature.
 *
 * Returns the agentId on success, null on failure (response already sent).
 */
async function verifyOcpAuth(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<string | null> {
  const ip = getClientIp(req);
  if (authRateLimiter.isLimited(ip)) {
    sendError(res, 429, "RATE_LIMITED", "Too many failed auth attempts. Try again later.");
    return null;
  }

  const agentId = req.headers["x-ocp-agent-id"] as string | undefined;
  const timestampStr = req.headers["x-ocp-timestamp"] as string | undefined;
  const nonce = req.headers["x-ocp-nonce"] as string | undefined;
  const bodySha256 = req.headers["x-ocp-body-sha256"] as string | undefined;
  const signature = req.headers["x-ocp-signature"] as string | undefined;
  const sigVersion = req.headers["x-ocp-signature-version"] as string | undefined;

  if (!agentId || !timestampStr || !nonce || !bodySha256 || !signature) {
    sendAuthFailure(
      res,
      "MISSING_AUTH_HEADERS",
      "X-OCP-Agent-Id, X-OCP-Timestamp, X-OCP-Nonce, X-OCP-Body-Sha256, X-OCP-Signature are required.",
      ip
    );
    return null;
  }

  if (sigVersion && sigVersion !== "v1") {
    sendAuthFailure(res, "UNSUPPORTED_SIG_VERSION", "X-OCP-Signature-Version must be 'v1'.", ip);
    return null;
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    sendAuthFailure(res, "INVALID_TIMESTAMP", "X-OCP-Timestamp must be a Unix seconds integer.", ip);
    return null;
  }

  const windowSec = 300; // 5-minute window
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSec > windowSec) {
    sendAuthFailure(res, "TIMESTAMP_EXPIRED", "Request timestamp is outside the 5-minute window.", ip);
    return null;
  }

  // Validate agentId is a 32-byte Ed25519 public key in base58
  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = decodeBase58(agentId);
    if (pubkeyBytes.length !== 32) {
      sendAuthFailure(res, "INVALID_AGENT_ID", "agentId must be a base58-encoded Ed25519 public key (32 bytes).", ip);
      return null;
    }
  } catch {
    sendAuthFailure(res, "INVALID_AGENT_ID", "agentId is not valid base58.", ip);
    return null;
  }

  // Verify body hash
  const actualBodyHash = sha256hex(rawBody);
  if (actualBodyHash !== bodySha256) {
    sendAuthFailure(res, "BODY_HASH_MISMATCH", "X-OCP-Body-Sha256 does not match the request body.", ip);
    return null;
  }

  // Validate nonce length (8-128 chars, alphanumeric + hyphen/underscore)
  if (nonce.length < 8 || nonce.length > 128 || !/^[a-zA-Z0-9\-_]+$/.test(nonce)) {
    sendAuthFailure(res, "INVALID_NONCE", "Nonce must be 8-128 alphanumeric characters (hyphens and underscores permitted).", ip);
    return null;
  }

  // Build and verify signature
  const url = new URL(req.url ?? "/", "http://localhost");
  const signingString = `OCPv1|${req.method ?? "POST"}|${url.pathname}|${timestamp}|${nonce}|${bodySha256}`;
  const digest = createHash("sha256").update(signingString, "utf8").digest();

  let sigValid = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      pubkeyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const sigBytes = Buffer.from(signature, "base64");
    if (sigBytes.length === 64) {
      sigValid = await crypto.subtle.verify("Ed25519", key, sigBytes as BufferSource, digest as BufferSource);
    }
  } catch {
    // invalid key or sig
  }

  if (!sigValid) {
    sendAuthFailure(res, "SIGNATURE_INVALID", "Request signature is invalid.", ip);
    return null;
  }

  // Replay protection: nonce must be unique within the timestamp window
  // Opportunistically prune expired nonces (1-in-20 chance to avoid overhead)
  if (Math.random() < 0.05) {
    pruneExpiredNonces(db);
  }
  const nonceAccepted = insertNonceIfAbsent(db, { agentId, nonce, windowSec });
  if (!nonceAccepted) {
    sendAuthFailure(res, "NONCE_REUSED", "This nonce has already been used. Use a unique nonce per request.", ip);
    return null;
  }

  return agentId;
}

/**
 * API key auth: Authorization: Bearer ocp_xxx or X-OCP-Api-Key: ocp_xxx.
 * Returns agentId on success, null on failure (no response sent).
 */
function verifyApiKey(req: IncomingMessage, _res: ServerResponse): string | null {
  const authHeader = req.headers["authorization"] as string | undefined;
  const apiKeyHeader = req.headers["x-ocp-api-key"] as string | undefined;

  let rawKey: string | undefined;
  if (authHeader?.startsWith("Bearer ")) {
    rawKey = authHeader.slice(7).trim();
  } else if (apiKeyHeader) {
    rawKey = apiKeyHeader.trim();
  }

  if (!rawKey) return null;

  // Format validation: ocp_ prefix, 36-64 chars (ocp_ + 31-59 base64url), [A-Za-z0-9_-] after prefix
  if (!rawKey.startsWith("ocp_") || rawKey.length < 36 || rawKey.length > 64) {
    return null;
  }
  const suffix = rawKey.slice(4);
  if (!/^[A-Za-z0-9_-]+$/.test(suffix)) {
    return null;
  }

  const computedHash = sha256hex(rawKey);
  const record = getApiKeyByHash(db, computedHash);
  if (!record) return null;

  // Timing-safe comparison before returning
  const computedBuf = Buffer.from(computedHash, "hex");
  const storedBuf = Buffer.from(record.keyHash, "hex");
  if (computedBuf.length !== storedBuf.length || !timingSafeEqual(computedBuf, storedBuf)) {
    return null;
  }

  return record.agentId;
}

/**
 * Tries API key auth first; if no key or invalid, falls through to Ed25519.
 * Use for GET endpoints that support both auth methods.
 */
async function verifyOcpAuthOrApiKey(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: string
): Promise<string | null> {
  const agentId = verifyApiKey(req, res);
  if (agentId) return agentId;
  return verifyOcpAuth(req, res, rawBody);
}

/**
 * Legacy signing scheme used by /api/ocp/ endpoints.
 * Kept for backward compatibility.
 */
async function verifyHttpAuth(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown
): Promise<string | null> {
  const ip = getClientIp(req);
  if (authRateLimiter.isLimited(ip)) {
    sendError(res, 429, "RATE_LIMITED", "Too many failed auth attempts. Try again later.");
    return null;
  }

  const agentId = req.headers["x-agent-id"] as string | undefined;
  const timestampStr = req.headers["x-timestamp"] as string | undefined;
  const payloadHash = req.headers["x-payload-hash"] as string | undefined;
  const signature = req.headers["x-signature"] as string | undefined;

  if (!agentId || !timestampStr || !payloadHash || !signature) {
    sendAuthFailure(res, "MISSING_AUTH_HEADERS", "X-Agent-Id, X-Timestamp, X-Payload-Hash, X-Signature are required.", ip);
    return null;
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    sendAuthFailure(res, "INVALID_TIMESTAMP", "X-Timestamp must be a unix seconds integer.", ip);
    return null;
  }

  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSec > 300) {
    sendAuthFailure(res, "TIMESTAMP_EXPIRED", "Request timestamp is too old.", ip);
    return null;
  }

  const computedPayloadHash = await canonicalHashHex(body);
  if (computedPayloadHash !== payloadHash) {
    sendAuthFailure(res, "BODY_HASH_MISMATCH", "X-Payload-Hash does not match request payload.", ip);
    return null;
  }

  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = decodeBase58(agentId);
    if (pubkeyBytes.length !== 32) {
      sendAuthFailure(res, "INVALID_AGENT_ID", "agentId must be a base58-encoded Ed25519 public key (32 bytes).", ip);
      return null;
    }
  } catch {
    sendAuthFailure(res, "INVALID_AGENT_ID", "agentId is not valid base58.", ip);
    return null;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  // Legacy signing string format (mirrors shared/signing.ts buildSigningString)
  const signingString = `OpenCawtReqV1|${req.method ?? "POST"}|${url.pathname}||${timestamp}|${payloadHash}`;
  const digest = createHash("sha256").update(signingString, "utf8").digest();

  let sigValid = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      pubkeyBytes as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const sigBytes = Buffer.from(signature, "base64");
    if (sigBytes.length === 64) {
      sigValid = await crypto.subtle.verify("Ed25519", key, sigBytes as BufferSource, digest as BufferSource);
    }
  } catch { /* invalid */ }

  if (!sigValid) {
    sendAuthFailure(res, "SIGNATURE_INVALID", "Request signature is invalid.", ip);
    return null;
  }

  return agentId;
}


// ---- Idempotency helper ----

function checkIdempotency(
  req: IncomingMessage,
  res: ServerResponse,
  agentId: string,
  endpoint: string
): { cached: true; key: string } | { cached: false; key: string | null } {
  const key = req.headers["idempotency-key"] as string | undefined;
  if (!key) return { cached: false, key: null };
  if (key.length > 255) {
    sendError(res, 400, "IDEMPOTENCY_KEY_TOO_LONG", "Idempotency-Key must be ≤ 255 characters.");
    return { cached: true, key };
  }
  const cached = getIdempotentResponse(db, { idempotencyKey: key, agentId, endpoint });
  if (cached) {
    sendJson(res, cached.status, cached.body);
    return { cached: true, key };
  }
  return { cached: false, key };
}

// ---- Main request handler ----

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  setCorsHeaders(res);
  setSecurityHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const segments = pathSegments(pathname);

  try {

    // ===========================================================
    // V1 API  (/v1/...)
    // ===========================================================

    if (segments[0] === "v1") {

      // ---- Health ----
      // GET /v1/health
      if (req.method === "GET" && segments.length === 2 && segments[1] === "health") {
        let dbOk = false;
        try { db.prepare("SELECT 1").get(); dbOk = true; } catch { /* ignore */ }
        sendJson(res, 200, { status: "ok", version: "OPENCAWT_PROTOCOL_V1", dbOk });
        return;
      }

      // ==== Agent Identity API ====

      // POST /v1/agents/register
      if (req.method === "POST" && segments.length === 3 && segments[1] === "agents" && segments[2] === "register") {
        let raw = "", parsed: unknown;
        try { ({ raw, parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }
        const agentId = await verifyOcpAuth(req, res, raw);
        if (!agentId) return;

        const { notifyUrl } = parsed as { notifyUrl?: string };
        if (!notifyUrl || typeof notifyUrl !== "string") {
          sendError(res, 400, "MISSING_NOTIFY_URL", "notifyUrl is required."); return;
        }
        if (!isValidNotifyUrl(notifyUrl, config.isDevelopment)) {
          sendError(res, 400, "INVALID_NOTIFY_URL", "notifyUrl must be a valid HTTPS URL."); return;
        }
        if (notifyUrl.length > 2000) {
          sendError(res, 400, "NOTIFY_URL_TOO_LONG", "notifyUrl must be ≤ 2000 characters."); return;
        }

        upsertOcpAgent(db, { agentId, notifyUrl });
        const agent = getOcpAgent(db, agentId)!;
        sendJson(res, 200, {
          agentId: agent.agentId,
          notifyUrl: agent.notifyUrl,
          status: agent.status,
          registeredAt: agent.registeredAt,
        });
        return;
      }

      // POST /v1/agents/update
      if (req.method === "POST" && segments.length === 3 && segments[1] === "agents" && segments[2] === "update") {
        let raw = "", parsed: unknown;
        try { ({ raw, parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }
        const agentId = await verifyOcpAuth(req, res, raw);
        if (!agentId) return;

        const agent = getOcpAgent(db, agentId);
        if (!agent) {
          sendError(res, 404, "AGENT_NOT_FOUND", "Agent not registered. Call /v1/agents/register first."); return;
        }

        const { notifyUrl } = parsed as { notifyUrl?: string };
        if (!notifyUrl || typeof notifyUrl !== "string") {
          sendError(res, 400, "MISSING_NOTIFY_URL", "notifyUrl is required."); return;
        }
        if (!isValidNotifyUrl(notifyUrl, config.isDevelopment)) {
          sendError(res, 400, "INVALID_NOTIFY_URL", "notifyUrl must be a valid HTTPS URL."); return;
        }
        if (notifyUrl.length > 2000) {
          sendError(res, 400, "NOTIFY_URL_TOO_LONG", "notifyUrl must be ≤ 2000 characters."); return;
        }

        upsertOcpAgent(db, { agentId, notifyUrl });
        const updated = getOcpAgent(db, agentId)!;
        sendJson(res, 200, {
          agentId: updated.agentId,
          notifyUrl: updated.notifyUrl,
          status: updated.status,
          updatedAt: updated.updatedAt,
        });
        return;
      }

      // GET /v1/agents/:agentId
      if (req.method === "GET" && segments.length === 3 && segments[1] === "agents") {
        const targetId = decodeURIComponent(segments[2]);
        const agent = getOcpAgent(db, targetId);
        if (!agent) { sendError(res, 404, "AGENT_NOT_FOUND", "Agent not found."); return; }
        sendJson(res, 200, {
          agentId: agent.agentId,
          notifyUrl: agent.notifyUrl,
          status: agent.status,
          registeredAt: agent.registeredAt,
        });
        return;
      }

      // ==== Canonicaliser Preview API ====

      // POST /v1/canonicalise
      if (req.method === "POST" && segments.length === 2 && segments[1] === "canonicalise") {
        let parsed: unknown;
        try { ({ parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }
        const { terms } = parsed as { terms?: unknown };
        if (!terms || typeof terms !== "object") {
          sendError(res, 400, "MISSING_TERMS", "terms object is required."); return;
        }
        let canonical: CanonicalTerms;
        try {
          canonical = buildCanonicalTerms(terms as CanonicalTerms);
        } catch (e) {
          sendError(res, 400, "CANONICALISE_FAILED", (e as Error).message); return;
        }
        const canonicalJson = toCanonicalJsonString(canonical);
        const termsHash = computeTermsHash(canonicalJson);
        const agreementCode = deriveAgreementCode(termsHash);
        sendJson(res, 200, { canonical, canonicalJson, termsHash, agreementCode });
        return;
      }

      // ==== Agreements API ====

      // GET /v1/agreements/fee-estimate
      if (req.method === "GET" && segments.length === 3 && segments[1] === "agreements" && segments[2] === "fee-estimate") {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const payerWallet = url.searchParams.get("payer_wallet")?.trim() || undefined;
        if (payerWallet && !isValidSolanaPubkey(payerWallet)) {
          sendError(res, 400, "INVALID_PAYER_WALLET", "payer_wallet must be a valid Solana base58 public key."); return;
        }
        try {
          const estimate = await ocpFeeEstimator.estimateMintingFee({ payerWallet });
          sendJson(res, 200, estimate);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendError(res, 502, "FEE_ESTIMATE_FAILED", msg);
        }
        return;
      }

      // POST /v1/agreements/propose
      if (req.method === "POST" && segments.length === 3 && segments[1] === "agreements" && segments[2] === "propose") {
        let raw = "", parsed: unknown;
        try { ({ raw, parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }

        const partyAAgentId = await verifyOcpAuth(req, res, raw);
        if (!partyAAgentId) return;

        // Idempotency check
        const idem = checkIdempotency(req, res, partyAAgentId, "propose");
        if (idem.cached) return;

        const { partyBAgentId, mode, terms, expiresInHours, sigA, treasuryTxSig, payerWallet } = parsed as {
          partyBAgentId?: string;
          mode?: string;
          terms?: CanonicalTerms;
          expiresInHours?: number;
          sigA?: string;
          treasuryTxSig?: string;
          payerWallet?: string;
        };

        if (!partyBAgentId || typeof partyBAgentId !== "string") {
          sendError(res, 400, "MISSING_PARTY_B", "partyBAgentId is required."); return;
        }
        if (partyAAgentId === partyBAgentId) {
          sendError(res, 400, "PARTY_B_SAME_AS_PARTY_A", "partyA and partyB must be different agents."); return;
        }
        if (mode !== "public" && mode !== "private") {
          sendError(res, 400, "INVALID_MODE", "mode must be 'public' or 'private'."); return;
        }
        if (!terms || typeof terms !== "object") {
          sendError(res, 400, "MISSING_TERMS", "terms object is required."); return;
        }
        if (!sigA || typeof sigA !== "string") {
          sendError(res, 400, "MISSING_SIG_A", "sigA (party A attestation signature) is required."); return;
        }

        const agentA = getOcpAgent(db, partyAAgentId);
        if (!agentA) { sendError(res, 404, "PARTY_A_NOT_REGISTERED", "Party A is not registered."); return; }
        if (agentA.status !== "active") { sendError(res, 403, "PARTY_A_SUSPENDED", "Party A agent is suspended."); return; }

        const agentB = getOcpAgent(db, partyBAgentId);
        if (!agentB) { sendError(res, 404, "PARTY_B_NOT_REGISTERED", "Party B is not registered."); return; }
        if (agentB.status !== "active") { sendError(res, 403, "PARTY_B_SUSPENDED", "Party B agent is suspended."); return; }

        let canonicalTerms: CanonicalTerms;
        try { canonicalTerms = buildCanonicalTerms(terms as CanonicalTerms); } catch (e) {
          sendError(res, 400, "CANONICALISE_FAILED", (e as Error).message); return;
        }
        const canonicalJson = toCanonicalJsonString(canonicalTerms);
        const termsHash = computeTermsHash(canonicalJson);

        if (isTermsHashDuplicate(db, partyAAgentId, partyBAgentId, termsHash)) {
          sendError(res, 409, "DUPLICATE_AGREEMENT", "An active agreement with identical terms already exists between these parties."); return;
        }

        const agreementCode = deriveAgreementCode(termsHash);
        const proposalId = createOcpId("prop");
        const ttlHours = Math.min(
          typeof expiresInHours === "number" && expiresInHours > 0 ? expiresInHours : config.proposalTtlHours,
          config.proposalTtlHours
        );
        const expiresAtIso = new Date(Date.now() + ttlHours * 3600_000).toISOString();

        const sigAValid = await verifySingleSig(
          partyAAgentId, proposalId, termsHash, agreementCode,
          partyAAgentId, partyBAgentId, expiresAtIso, sigA
        );
        if (!sigAValid) {
          sendError(res, 401, "SIG_A_INVALID", "sigA is not a valid Ed25519 signature over the attestation payload."); return;
        }

        // ── Minting fee verification ──
        let feeAmountLamports: number | undefined;
        if (config.solanaMode === "rpc") {
          if (!treasuryTxSig || typeof treasuryTxSig !== "string") {
            sendError(res, 400, "MISSING_TREASURY_TX", "treasuryTxSig is required for agreement proposals."); return;
          }
          if (isTreasuryTxUsed(db, treasuryTxSig)) {
            sendError(res, 409, "TX_ALREADY_USED", "This treasury transaction has already been used."); return;
          }
          try {
            const verification = await ocpSolanaVerifier.verifyMintingFeeTx(treasuryTxSig, payerWallet);
            if (!verification.finalised) {
              sendError(res, 400, "TX_NOT_FINALISED", "Treasury transaction is not yet finalised."); return;
            }
            feeAmountLamports = verification.amountLamports;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            sendError(res, 400, "FEE_VERIFICATION_FAILED", msg); return;
          }
        } else if (treasuryTxSig && typeof treasuryTxSig === "string") {
          // Stub mode: accept treasuryTxSig but don't verify on-chain
          feeAmountLamports = config.mintingFeeLamports + 1000;
        }

        createAgreement(db, {
          proposalId, partyAAgentId, partyBAgentId,
          mode: mode as "public" | "private",
          canonicalTermsJson: canonicalJson, termsHash, agreementCode, expiresAtIso,
          treasuryTxSig: treasuryTxSig || undefined,
        });
        storeSignature(db, { proposalId, party: "party_a", agentId: partyAAgentId, sig: sigA });

        // Record the used treasury TX for replay protection
        if (treasuryTxSig && feeAmountLamports !== undefined) {
          saveUsedTreasuryTx(db, {
            txSig: treasuryTxSig,
            proposalId,
            agentId: partyAAgentId,
            amountLamports: feeAmountLamports,
          });
        }

        void dispatchNotification(db, config, {
          notifyUrl: agentB.notifyUrl, agentId: partyBAgentId, proposalId, agreementCode,
          event: "agreement_proposed",
          body: { proposalId, agreementCode, termsHash, partyAAgentId, partyBAgentId, mode, expiresAtIso },
        });

        const responseBody = { proposalId, agreementCode, termsHash, expiresAtIso, status: "pending" };
        if (idem.key) storeIdempotentResponse(db, { idempotencyKey: idem.key, agentId: partyAAgentId, endpoint: "propose", status: 200, body: responseBody });
        sendJson(res, 200, responseBody);
        return;
      }

      // POST /v1/agreements/:proposalId/accept
      if (
        req.method === "POST" &&
        segments.length === 4 &&
        segments[1] === "agreements" &&
        segments[3] === "accept"
      ) {
        const proposalId = decodeURIComponent(segments[2]);

        let raw = "", parsed: unknown;
        try { ({ raw, parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }

        const callerAgentId = await verifyOcpAuth(req, res, raw);
        if (!callerAgentId) return;

        const { sigB } = parsed as { sigB?: string };
        if (!sigB || typeof sigB !== "string") {
          sendError(res, 400, "MISSING_SIG_B", "sigB (party B attestation signature) is required."); return;
        }
        await processAgreementAcceptance(res, { proposalId, callerAgentId, sigB });
        return;
      }

      // GET /v1/agreements/by-code/:code
      if (req.method === "GET" && segments.length === 4 && segments[1] === "agreements" && segments[2] === "by-code") {
        const code = decodeURIComponent(segments[3]);
        const agreement = getAgreementByCode(db, code);
        if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }
        const receipt = agreement.status === "sealed" ? getReceiptByCode(db, code) : null;
        sendJson(res, 200, formatAgreementResponse(agreement, receipt));
        return;
      }

      // GET /v1/agreements/:proposalId
      if (req.method === "GET" && segments.length === 3 && segments[1] === "agreements") {
        const proposalId = decodeURIComponent(segments[2]);
        const agreement = getAgreement(db, proposalId);
        if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }
        const receipt = agreement.status === "sealed" ? getReceipt(db, proposalId) : null;
        sendJson(res, 200, formatAgreementResponse(agreement, receipt));
        return;
      }

      // GET /v1/agents/:agentId/agreements
      if (req.method === "GET" && segments.length === 4 && segments[1] === "agents" && segments[3] === "agreements") {
        const agentId = decodeURIComponent(segments[2]);
        const status = url.searchParams.get("status") ?? "all";
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
        const agreements = listAgreementsForAgent(db, agentId, status, limit);
        sendJson(res, 200, { agreements: agreements.map((a) => formatAgreementSummary(a)) });
        return;
      }

      // ==== Receipts API ====

      // GET /v1/receipts/:code
      if (req.method === "GET" && segments.length === 3 && segments[1] === "receipts") {
        const code = decodeURIComponent(segments[2]);
        const receipt = getReceiptByCode(db, code);
        if (!receipt) { sendError(res, 404, "NOT_FOUND", "Receipt not found."); return; }
        const agreement = getAgreementByCode(db, code);
        sendJson(res, 200, {
          agreementCode: receipt.agreementCode,
          termsHash: receipt.termsHash,
          sealedAt: receipt.sealedAt,
          mintStatus: receipt.mintStatus,
          mintAddress: receipt.mintAddress,
          txSig: receipt.txSig,
          metadataUri: receipt.metadataUri,
          proposalId: receipt.proposalId,
          mode: agreement?.mode ?? null,
          canonicalTerms: agreement?.mode === "public" ? agreement.canonicalTerms : null,
        });
        return;
      }

      // ==== Verify API ====

      // GET /v1/verify?code=...  OR  GET /v1/verify?proposalId=...
      if (req.method === "GET" && segments.length === 2 && segments[1] === "verify") {
        const proposalIdParam = url.searchParams.get("proposalId");
        const codeParam = url.searchParams.get("code");

        let agreement = null;
        if (proposalIdParam) agreement = getAgreement(db, proposalIdParam);
        else if (codeParam) agreement = getAgreementByCode(db, codeParam);

        if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }

        const sigs = getSignaturesForProposal(db, agreement.proposalId);
        const sigARec = sigs.find((s) => s.party === "party_a");
        const sigBRec = sigs.find((s) => s.party === "party_b");

        if (!sigARec || !sigBRec) {
          sendJson(res, 200, {
            agreementCode: agreement.agreementCode, termsHash: agreement.termsHash,
            termsHashValid: true, sigAValid: !!sigARec, sigBValid: !!sigBRec,
            overallValid: false, reason: "MISSING_SIGNATURES",
          });
          return;
        }

        const verifyResult = await verifyBothAttestations({
          proposalId: agreement.proposalId, termsHash: agreement.termsHash,
          agreementCode: agreement.agreementCode, partyAAgentId: agreement.partyAAgentId,
          partyBAgentId: agreement.partyBAgentId, expiresAtIso: agreement.expiresAt,
          sigA: sigARec.sig, sigB: sigBRec.sig,
        });

        sendJson(res, 200, {
          agreementCode: agreement.agreementCode, termsHash: agreement.termsHash,
          termsHashValid: true, sigAValid: verifyResult.sigAValid, sigBValid: verifyResult.sigBValid,
          overallValid: verifyResult.ok, reason: verifyResult.reason ?? null,
        });
        return;
      }

      // ==== Decisions API ====

      // POST /v1/decisions/draft
      if (req.method === "POST" && segments.length === 3 && segments[1] === "decisions" && segments[2] === "draft") {
        let raw = "", parsed: unknown;
        try { ({ raw, parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }

        const agentId = await verifyOcpAuth(req, res, raw);
        if (!agentId) return;

        const agent = getOcpAgent(db, agentId);
        if (!agent) { sendError(res, 404, "AGENT_NOT_FOUND", "Agent not registered."); return; }
        if (agent.status !== "active") { sendError(res, 403, "AGENT_SUSPENDED", "Agent is suspended."); return; }

        // Idempotency check
        const idem = checkIdempotency(req, res, agentId, "decisions.draft");
        if (idem.cached) return;

        const {
          decisionType,
          mode,
          subject,
          payload,
          signers,
          requiredSigners,
        } = parsed as {
          decisionType?: string;
          mode?: string;
          subject?: string;
          payload?: unknown;
          signers?: string[];
          requiredSigners?: number;
        };

        const VALID_TYPES: DecisionType[] = ["ATTESTATION", "MULTISIG_DECISION", "APP_DECISION", "AGREEMENT"];
        if (!decisionType || !VALID_TYPES.includes(decisionType as DecisionType)) {
          sendError(res, 400, "INVALID_DECISION_TYPE", `decisionType must be one of: ${VALID_TYPES.join(", ")}.`); return;
        }
        if (mode !== "public" && mode !== "private") {
          sendError(res, 400, "INVALID_MODE", "mode must be 'public' or 'private'."); return;
        }
        if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
          sendError(res, 400, "MISSING_SUBJECT", "subject is required."); return;
        }
        if (payload === undefined || payload === null) {
          sendError(res, 400, "MISSING_PAYLOAD", "payload is required."); return;
        }
        if (!signers || !Array.isArray(signers) || signers.length === 0) {
          sendError(res, 400, "MISSING_SIGNERS", "signers array must not be empty."); return;
        }

        // Validate all signers are registered
        for (const signerId of signers) {
          if (typeof signerId !== "string") {
            sendError(res, 400, "INVALID_SIGNER", "Each signer must be a string agentId."); return;
          }
          const signerAgent = getOcpAgent(db, signerId);
          if (!signerAgent) {
            sendError(res, 404, "SIGNER_NOT_REGISTERED", `Signer ${signerId} is not registered.`); return;
          }
        }

        const k = typeof requiredSigners === "number" && requiredSigners > 0
          ? Math.min(requiredSigners, signers.length)
          : signers.length;

        // Canonicalise payload
        const canonicalPayloadJson = JSON.stringify(
          JSON.parse(JSON.stringify(payload)) // strip undefined, consistent ordering via parse/stringify
        );
        const payloadHash = sha256hex(canonicalPayloadJson);

        const draftId = createOcpId("dft");
        const idempotencyKey = idem.key ?? undefined;

        createDecision(db, {
          draftId,
          decisionType: decisionType as DecisionType,
          mode: mode as "public" | "private",
          subject: subject.trim(),
          payloadHash,
          canonicalPayloadJson,
          requiredSigners: k,
          initiatorAgentId: agentId,
          idempotencyKey,
        });

        // Add all declared signers
        for (const signerId of signers) {
          addDecisionSigner(db, { draftId, agentId: signerId });
        }

        const responseBody = {
          draftId,
          decisionType,
          mode,
          subject: subject.trim(),
          payloadHash,
          signers,
          requiredSigners: k,
          status: "draft",
        };
        if (idem.key) storeIdempotentResponse(db, { idempotencyKey: idem.key, agentId, endpoint: "decisions.draft", status: 200, body: responseBody });
        sendJson(res, 200, responseBody);
        return;
      }

      // POST /v1/decisions/:draftId/sign
      if (
        req.method === "POST" &&
        segments.length === 4 &&
        segments[1] === "decisions" &&
        segments[3] === "sign"
      ) {
        const draftId = decodeURIComponent(segments[2]);

        let raw = "", parsed: unknown;
        try { ({ raw, parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }

        const agentId = await verifyOcpAuth(req, res, raw);
        if (!agentId) return;

        const decision = getDecision(db, draftId);
        if (!decision) { sendError(res, 404, "DRAFT_NOT_FOUND", "Decision draft not found."); return; }
        if (decision.status !== "draft") {
          sendError(res, 409, "DECISION_NOT_DRAFT", `Decision status is '${decision.status}', cannot sign.`); return;
        }

        const signers = getDecisionSigners(db, draftId);
        const isAuthorised = signers.some((s) => s.agentId === agentId);
        if (!isAuthorised) {
          sendError(res, 403, "NOT_AUTHORISED_SIGNER", "You are not a declared signer for this decision."); return;
        }

        const { sig } = parsed as { sig?: string };
        if (!sig || typeof sig !== "string") {
          sendError(res, 400, "MISSING_SIG", "sig (base64 Ed25519 signature over payloadHash) is required."); return;
        }

        // Verify sig over payloadHash bytes
        const sigValid = await verifyDecisionSig(agentId, decision.payloadHash, sig);
        if (!sigValid) {
          sendError(res, 401, "SIGNATURE_INVALID", "sig is not a valid Ed25519 signature over the payloadHash."); return;
        }

        storeDecisionSignature(db, { draftId, agentId, sig });

        const allSigs = getDecisionSignatures(db, draftId);
        sendJson(res, 200, {
          draftId,
          agentId,
          signatureCount: allSigs.length,
          requiredSigners: decision.requiredSigners,
          ready: allSigs.length >= decision.requiredSigners,
        });
        return;
      }

      // POST /v1/decisions/:draftId/seal
      if (
        req.method === "POST" &&
        segments.length === 4 &&
        segments[1] === "decisions" &&
        segments[3] === "seal"
      ) {
        const draftId = decodeURIComponent(segments[2]);

        let raw = "";
        try { ({ raw } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }

        const agentId = await verifyOcpAuth(req, res, raw);
        if (!agentId) return;

        const decision = getDecision(db, draftId);
        if (!decision) { sendError(res, 404, "DRAFT_NOT_FOUND", "Decision draft not found."); return; }
        if (decision.status !== "draft") {
          sendError(res, 409, "DECISION_NOT_DRAFT", `Decision status is '${decision.status}', cannot seal.`); return;
        }
        if (decision.initiatorAgentId !== agentId) {
          sendError(res, 403, "NOT_INITIATOR", "Only the decision initiator can seal it."); return;
        }

        const allSigs = getDecisionSignatures(db, draftId);
        if (allSigs.length < decision.requiredSigners) {
          sendError(
            res, 409, "INSUFFICIENT_SIGNATURES",
            `Need ${decision.requiredSigners} signature(s), have ${allSigs.length}.`
          ); return;
        }

        const decisionCode = deriveAgreementCode(decision.payloadHash);
        sealDecision(db, draftId, decisionCode);

        // Notify all signers (fire-and-forget)
        const signersList = getDecisionSigners(db, draftId);
        for (const signer of signersList) {
          const signerAgent = getOcpAgent(db, signer.agentId);
          if (signerAgent && signer.agentId !== agentId) {
            void dispatchNotification(db, config, {
              notifyUrl: signerAgent.notifyUrl,
              agentId: signer.agentId,
              proposalId: draftId,
              agreementCode: decisionCode,
              event: "decision_sealed",
              body: {
                draftId,
                decisionCode,
                payloadHash: decision.payloadHash,
                decisionType: decision.decisionType,
                subject: decision.subject,
                sealedBy: agentId,
              },
            });
          }
        }

        sendJson(res, 200, {
          draftId,
          decisionCode,
          payloadHash: decision.payloadHash,
          decisionType: decision.decisionType,
          subject: decision.subject,
          mode: decision.mode,
          status: "sealed",
          signers: allSigs.map((s) => ({ agentId: s.agentId, signedAt: s.signedAt })),
        });
        return;
      }

      // GET /v1/decisions/:codeOrDraftId
      if (req.method === "GET" && segments.length === 3 && segments[1] === "decisions") {
        const id = decodeURIComponent(segments[2]);
        // Try draftId first, then decisionCode
        let decision = getDecision(db, id);
        if (!decision) decision = getDecisionByCode(db, id);
        if (!decision) { sendError(res, 404, "NOT_FOUND", "Decision not found."); return; }

        const signers = getDecisionSigners(db, decision.draftId);
        const sigs = getDecisionSignatures(db, decision.draftId);

        sendJson(res, 200, {
          draftId: decision.draftId,
          decisionCode: decision.decisionCode,
          decisionType: decision.decisionType,
          mode: decision.mode,
          subject: decision.subject,
          payloadHash: decision.payloadHash,
          payload: decision.mode === "public" ? decision.canonicalPayload : null,
          requiredSigners: decision.requiredSigners,
          status: decision.status,
          initiatorAgentId: decision.initiatorAgentId,
          createdAt: decision.createdAt,
          sealedAt: decision.sealedAt,
          signers: signers.map((s) => s.agentId),
          signatures: sigs.map((s) => ({ agentId: s.agentId, signedAt: s.signedAt })),
        });
        return;
      }

      // ==== API Keys API ====

      // POST /v1/api-keys
      if (req.method === "POST" && segments.length === 2 && segments[1] === "api-keys") {
        let raw = "", parsed: unknown;
        try { ({ raw, parsed } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }

        const agentId = await verifyOcpAuth(req, res, raw);
        if (!agentId) return;

        const agent = getOcpAgent(db, agentId);
        if (!agent) { sendError(res, 404, "AGENT_NOT_FOUND", "Agent not registered."); return; }

        const { label } = parsed as { label?: string };
        const keyLabel = (typeof label === "string" ? label.trim() : "").slice(0, 100);

        const rawKey = `ocp_${randomBytes(24).toString("base64url")}`;
        const keyHash = sha256hex(rawKey);
        const keyPrefix = rawKey.slice(0, 8);
        const keyId = createOcpId("key");

        createApiKey(db, { keyId, agentId, keyHash, keyPrefix, label: keyLabel });

        // Return the raw key only once
        sendJson(res, 200, {
          keyId,
          agentId,
          keyPrefix,
          label: keyLabel,
          key: rawKey, // shown once only
          createdAt: nowIso(),
        });
        return;
      }

      // GET /v1/api-keys (supports API key or Ed25519)
      if (req.method === "GET" && segments.length === 2 && segments[1] === "api-keys") {
        let raw = "";
        try { ({ raw } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }
        const agentId = await verifyOcpAuthOrApiKey(req, res, raw);
        if (!agentId) return;

        const keys = listApiKeysForAgent(db, agentId);
        sendJson(res, 200, {
          keys: keys.map((k) => ({
            keyId: k.keyId, agentId: k.agentId, keyPrefix: k.keyPrefix,
            label: k.label, status: k.status, createdAt: k.createdAt, revokedAt: k.revokedAt,
          })),
        });
        return;
      }

      // DELETE /v1/api-keys/:keyId
      if (req.method === "DELETE" && segments.length === 3 && segments[1] === "api-keys") {
        let raw = "";
        try { ({ raw } = await readBody(req)); } catch (e) {
          sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
        }
        const agentId = await verifyOcpAuth(req, res, raw);
        if (!agentId) return;

        const keyId = decodeURIComponent(segments[2]);
        const revoked = revokeApiKey(db, keyId, agentId);
        if (!revoked) {
          sendError(res, 404, "KEY_NOT_FOUND", "API key not found or already revoked."); return;
        }
        sendJson(res, 200, { keyId, status: "revoked" });
        return;
      }

      // ==== Admin (v1) ====

      // POST /v1/internal/agents/:agentId/suspend
      if (
        req.method === "POST" &&
        segments.length === 5 &&
        segments[1] === "internal" &&
        segments[2] === "agents" &&
        segments[4] === "suspend"
      ) {
        if (!assertSystemKey(req, res)) return;
        const agentId = decodeURIComponent(segments[3]);
        const agent = getOcpAgent(db, agentId);
        if (!agent) { sendError(res, 404, "NOT_FOUND", "Agent not found."); return; }
        suspendOcpAgent(db, agentId);
        sendJson(res, 200, { agentId, status: "suspended" });
        return;
      }

      // POST /v1/internal/agreements/:proposalId/cancel
      if (
        req.method === "POST" &&
        segments.length === 5 &&
        segments[1] === "internal" &&
        segments[2] === "agreements" &&
        segments[4] === "cancel"
      ) {
        if (!assertSystemKey(req, res)) return;
        const proposalId = decodeURIComponent(segments[3]);
        const agreement = getAgreement(db, proposalId);
        if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }
        if (agreement.status !== "pending") {
          sendError(res, 409, "NOT_CANCELLABLE", `Agreement status is '${agreement.status}', only pending agreements can be cancelled.`); return;
        }
        cancelAgreement(db, proposalId);
        sendJson(res, 200, { proposalId, status: "cancelled" });
        return;
      }

      // POST /v1/internal/decisions/:draftId/cancel
      if (
        req.method === "POST" &&
        segments.length === 5 &&
        segments[1] === "internal" &&
        segments[2] === "decisions" &&
        segments[4] === "cancel"
      ) {
        if (!assertSystemKey(req, res)) return;
        const draftId = decodeURIComponent(segments[3]);
        const decision = getDecision(db, draftId);
        if (!decision) { sendError(res, 404, "NOT_FOUND", "Decision draft not found."); return; }
        if (decision.status !== "draft") {
          sendError(res, 409, "NOT_CANCELLABLE", `Decision status is '${decision.status}', only draft decisions can be cancelled.`); return;
        }
        cancelDecision(db, draftId);
        sendJson(res, 200, { draftId, status: "cancelled" });
        return;
      }

      // v1 route not matched
      sendError(res, 404, "NOT_FOUND", "Route not found.");
      return;
    }

    // ===========================================================
    // Legacy API  (/api/ocp/...) — backward compatibility
    // ===========================================================

    // ---- Health ----
    if (req.method === "GET" && pathname === "/api/ocp/health") {
      let dbOk = false;
      try { db.prepare("SELECT 1").get(); dbOk = true; } catch { /* ignore */ }
      sendJson(res, 200, { status: "ok", version: "OPENCAWT_PROTOCOL_V1", dbOk });
      return;
    }

    // POST /api/ocp/agents/register
    if (req.method === "POST" && pathname === "/api/ocp/agents/register") {
      let parsed: unknown;
      try { ({ parsed } = await readBody(req)); } catch (e) {
        sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
      }
      const agentId = await verifyHttpAuth(req, res, parsed);
      if (!agentId) return;

      const { notifyUrl } = parsed as { notifyUrl?: string };
      if (!notifyUrl || typeof notifyUrl !== "string") {
        sendError(res, 400, "MISSING_NOTIFY_URL", "notifyUrl is required."); return;
      }
      if (!isValidNotifyUrl(notifyUrl, config.isDevelopment)) {
        sendError(res, 400, "INVALID_NOTIFY_URL", "notifyUrl must be a valid HTTPS URL."); return;
      }
      if (notifyUrl.length > 2000) {
        sendError(res, 400, "NOTIFY_URL_TOO_LONG", "notifyUrl must be ≤ 2000 characters."); return;
      }

      upsertOcpAgent(db, { agentId, notifyUrl });
      const agent = getOcpAgent(db, agentId)!;
      sendJson(res, 200, { agentId: agent.agentId, notifyUrl: agent.notifyUrl, status: agent.status, registeredAt: agent.registeredAt });
      return;
    }

    // POST /api/ocp/agreements/propose
    if (req.method === "POST" && pathname === "/api/ocp/agreements/propose") {
      let parsed: unknown;
      try { ({ parsed } = await readBody(req)); } catch (e) {
        sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
      }

      const partyAAgentId = await verifyHttpAuth(req, res, parsed);
      if (!partyAAgentId) return;

      const { partyBAgentId, mode, terms, expiresInHours, sigA } = parsed as {
        partyBAgentId?: string;
        mode?: string;
        terms?: CanonicalTerms;
        expiresInHours?: number;
        sigA?: string;
      };

      if (!partyBAgentId || typeof partyBAgentId !== "string") {
        sendError(res, 400, "MISSING_PARTY_B", "partyBAgentId is required."); return;
      }
      if (partyAAgentId === partyBAgentId) {
        sendError(res, 400, "PARTY_B_SAME_AS_PARTY_A", "partyA and partyB must be different agents."); return;
      }
      if (mode !== "public" && mode !== "private") {
        sendError(res, 400, "INVALID_MODE", "mode must be 'public' or 'private'."); return;
      }
      if (!terms || typeof terms !== "object") {
        sendError(res, 400, "MISSING_TERMS", "terms object is required."); return;
      }
      if (!sigA || typeof sigA !== "string") {
        sendError(res, 400, "MISSING_SIG_A", "sigA is required."); return;
      }

      const agentA = getOcpAgent(db, partyAAgentId);
      if (!agentA) { sendError(res, 404, "PARTY_A_NOT_REGISTERED", "Party A is not registered."); return; }
      if (agentA.status !== "active") { sendError(res, 403, "PARTY_A_SUSPENDED", "Party A is suspended."); return; }

      const agentB = getOcpAgent(db, partyBAgentId);
      if (!agentB) { sendError(res, 404, "PARTY_B_NOT_REGISTERED", "Party B is not registered."); return; }
      if (agentB.status !== "active") { sendError(res, 403, "PARTY_B_SUSPENDED", "Party B is suspended."); return; }

      let canonicalTerms: CanonicalTerms;
      try { canonicalTerms = buildCanonicalTerms(terms as CanonicalTerms); } catch (e) {
        sendError(res, 400, "CANONICALISE_FAILED", (e as Error).message); return;
      }
      const canonicalJson = toCanonicalJsonString(canonicalTerms);
      const termsHash = computeTermsHash(canonicalJson);

      if (isTermsHashDuplicate(db, partyAAgentId, partyBAgentId, termsHash)) {
        sendError(res, 409, "DUPLICATE_AGREEMENT", "An active agreement with identical terms already exists."); return;
      }

      const agreementCode = deriveAgreementCode(termsHash);
      const proposalId = createOcpId("prop");
      const ttlHours = Math.min(
        typeof expiresInHours === "number" && expiresInHours > 0 ? expiresInHours : config.proposalTtlHours,
        config.proposalTtlHours
      );
      const expiresAtIso = new Date(Date.now() + ttlHours * 3600_000).toISOString();

      const sigAValid = await verifySingleSig(
        partyAAgentId, proposalId, termsHash, agreementCode,
        partyAAgentId, partyBAgentId, expiresAtIso, sigA
      );
      if (!sigAValid) {
        sendError(res, 401, "SIG_A_INVALID", "sigA is invalid."); return;
      }

      createAgreement(db, {
        proposalId, partyAAgentId, partyBAgentId,
        mode: mode as "public" | "private",
        canonicalTermsJson: canonicalJson, termsHash, agreementCode, expiresAtIso,
      });
      storeSignature(db, { proposalId, party: "party_a", agentId: partyAAgentId, sig: sigA });

      void dispatchNotification(db, config, {
        notifyUrl: agentB.notifyUrl, agentId: partyBAgentId, proposalId, agreementCode,
        event: "agreement_proposed",
        body: { proposalId, agreementCode, termsHash, partyAAgentId, partyBAgentId, mode, expiresAtIso },
      });

      sendJson(res, 200, { proposalId, agreementCode, termsHash, expiresAtIso, status: "pending" });
      return;
    }

    // POST /api/ocp/agreements/:proposalId/accept
    if (
      req.method === "POST" &&
      segments.length === 5 &&
      segments[0] === "api" &&
      segments[1] === "ocp" &&
      segments[2] === "agreements" &&
      segments[4] === "accept"
    ) {
      const proposalId = decodeURIComponent(segments[3]);

      let parsed: unknown;
      try { ({ parsed } = await readBody(req)); } catch (e) {
        sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
      }

      const callerAgentId = await verifyHttpAuth(req, res, parsed);
      if (!callerAgentId) return;

      const { sigB } = parsed as { sigB?: string };
      if (!sigB || typeof sigB !== "string") {
        sendError(res, 400, "MISSING_SIG_B", "sigB is required."); return;
      }
      await processAgreementAcceptance(res, { proposalId, callerAgentId, sigB });
      return;
    }

    // GET /api/ocp/agreements/by-code/:code
    if (
      req.method === "GET" &&
      segments.length === 5 &&
      segments[0] === "api" && segments[1] === "ocp" &&
      segments[2] === "agreements" && segments[3] === "by-code"
    ) {
      const code = decodeURIComponent(segments[4]);
      const agreement = getAgreementByCode(db, code);
      if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }
      const receipt = agreement.status === "sealed" ? getReceiptByCode(db, code) : null;
      sendJson(res, 200, formatAgreementResponse(agreement, receipt));
      return;
    }

    // GET /api/ocp/agreements/:proposalId
    if (
      req.method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" && segments[1] === "ocp" && segments[2] === "agreements"
    ) {
      const proposalId = decodeURIComponent(segments[3]);
      const agreement = getAgreement(db, proposalId);
      if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }
      const receipt = agreement.status === "sealed" ? getReceipt(db, proposalId) : null;
      sendJson(res, 200, formatAgreementResponse(agreement, receipt));
      return;
    }

    // GET /api/ocp/agents/:agentId/agreements
    if (
      req.method === "GET" &&
      segments.length === 5 &&
      segments[0] === "api" && segments[1] === "ocp" &&
      segments[2] === "agents" && segments[4] === "agreements"
    ) {
      const agentId = decodeURIComponent(segments[3]);
      const status = url.searchParams.get("status") ?? "all";
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);
      const agreements = listAgreementsForAgent(db, agentId, status, limit);
      sendJson(res, 200, { agreements: agreements.map((a) => formatAgreementSummary(a)) });
      return;
    }

    // POST /api/ocp/verify
    if (req.method === "POST" && pathname === "/api/ocp/verify") {
      let parsed: unknown;
      try { ({ parsed } = await readBody(req)); } catch (e) {
        sendError(res, 400, "INVALID_BODY", (e as Error).message); return;
      }

      const { proposalId, agreementCode: codeInput } = parsed as {
        proposalId?: string;
        agreementCode?: string;
      };

      let agreement = null;
      if (proposalId) agreement = getAgreement(db, proposalId);
      else if (codeInput) agreement = getAgreementByCode(db, codeInput);
      if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }

      const sigs = getSignaturesForProposal(db, agreement.proposalId);
      const sigARec = sigs.find((s) => s.party === "party_a");
      const sigBRec = sigs.find((s) => s.party === "party_b");

      if (!sigARec || !sigBRec) {
        sendJson(res, 200, {
          agreementCode: agreement.agreementCode, termsHash: agreement.termsHash,
          termsHashValid: true, sigAValid: !!sigARec, sigBValid: !!sigBRec,
          overallValid: false, reason: "MISSING_SIGNATURES",
        });
        return;
      }

      const verifyResult = await verifyBothAttestations({
        proposalId: agreement.proposalId, termsHash: agreement.termsHash,
        agreementCode: agreement.agreementCode, partyAAgentId: agreement.partyAAgentId,
        partyBAgentId: agreement.partyBAgentId, expiresAtIso: agreement.expiresAt,
        sigA: sigARec.sig, sigB: sigBRec.sig,
      });

      sendJson(res, 200, {
        agreementCode: agreement.agreementCode, termsHash: agreement.termsHash,
        termsHashValid: true, sigAValid: verifyResult.sigAValid, sigBValid: verifyResult.sigBValid,
        overallValid: verifyResult.ok, reason: verifyResult.reason ?? null,
      });
      return;
    }

    // POST /api/ocp/internal/agents/:agentId/suspend
    if (
      req.method === "POST" &&
      segments.length === 6 &&
      segments[0] === "api" && segments[1] === "ocp" && segments[2] === "internal" &&
      segments[3] === "agents" && segments[5] === "suspend"
    ) {
      if (!assertSystemKey(req, res)) return;
      const agentId = decodeURIComponent(segments[4]);
      const agent = getOcpAgent(db, agentId);
      if (!agent) { sendError(res, 404, "NOT_FOUND", "Agent not found."); return; }
      suspendOcpAgent(db, agentId);
      sendJson(res, 200, { agentId, status: "suspended" });
      return;
    }

    // POST /api/ocp/internal/agreements/:proposalId/cancel
    if (
      req.method === "POST" &&
      segments.length === 6 &&
      segments[0] === "api" && segments[1] === "ocp" && segments[2] === "internal" &&
      segments[3] === "agreements" && segments[5] === "cancel"
    ) {
      if (!assertSystemKey(req, res)) return;
      const proposalId = decodeURIComponent(segments[4]);
      const agreement = getAgreement(db, proposalId);
      if (!agreement) { sendError(res, 404, "NOT_FOUND", "Agreement not found."); return; }
      if (agreement.status !== "pending") {
        sendError(res, 409, "NOT_CANCELLABLE", `Agreement status is '${agreement.status}'.`); return;
      }
      cancelAgreement(db, proposalId);
      sendJson(res, 200, { proposalId, status: "cancelled" });
      return;
    }

    // ---- 404 ----
    sendError(res, 404, "NOT_FOUND", "Route not found.");
  } catch (err) {
    console.error("[OCP] Unhandled error:", err);
    sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
  }
}

// ---- Response formatters ----

type AgreementRecord = import("./db/repository").OcpAgreementRecord;
type ReceiptRecord = import("./db/repository").OcpReceiptRecord;

function formatAgreementResponse(
  agreement: AgreementRecord,
  receipt: ReceiptRecord | null
): unknown {
  return {
    proposalId: agreement.proposalId,
    partyAAgentId: agreement.partyAAgentId,
    partyBAgentId: agreement.partyBAgentId,
    mode: agreement.mode,
    termsHash: agreement.termsHash,
    agreementCode: agreement.agreementCode,
    expiresAt: agreement.expiresAt,
    createdAt: agreement.createdAt,
    acceptedAt: agreement.acceptedAt,
    sealedAt: agreement.sealedAt,
    status: agreement.status,
    canonicalTerms: agreement.mode === "public" ? agreement.canonicalTerms : null,
    receipt: receipt
      ? {
          mintAddress: receipt.mintAddress,
          txSig: receipt.txSig,
          metadataUri: receipt.metadataUri,
          mintStatus: receipt.mintStatus,
          sealedAt: receipt.sealedAt,
        }
      : null,
  };
}

function formatAgreementSummary(agreement: AgreementRecord): unknown {
  return {
    proposalId: agreement.proposalId,
    partyAAgentId: agreement.partyAAgentId,
    partyBAgentId: agreement.partyBAgentId,
    mode: agreement.mode,
    termsHash: agreement.termsHash,
    agreementCode: agreement.agreementCode,
    expiresAt: agreement.expiresAt,
    createdAt: agreement.createdAt,
    sealedAt: agreement.sealedAt,
    status: agreement.status,
  };
}

// ---- Signature helpers ----

async function verifySingleSig(
  agentId: string,
  proposalId: string,
  termsHash: string,
  agreementCode: string,
  partyAAgentId: string,
  partyBAgentId: string,
  expiresAtIso: string,
  sig: string
): Promise<boolean> {
  try {
    const pubkeyBytes = decodeBase58(agentId);
    if (pubkeyBytes.length !== 32) return false;
    const key = await crypto.subtle.importKey(
      "raw", pubkeyBytes as BufferSource, { name: "Ed25519" }, false, ["verify"]
    );
    const attestStr = buildAttestationString({ proposalId, termsHash, agreementCode, partyAAgentId, partyBAgentId, expiresAtIso });
    const digest = hashAttestationString(attestStr);
    const sigBytes = Buffer.from(sig, "base64");
    if (sigBytes.length !== 64) return false;
    return await crypto.subtle.verify("Ed25519", key, sigBytes as BufferSource, digest as BufferSource);
  } catch {
    return false;
  }
}

async function processAgreementAcceptance(
  res: ServerResponse,
  input: {
    proposalId: string;
    callerAgentId: string;
    sigB: string;
  }
): Promise<void> {
  const { proposalId, callerAgentId, sigB } = input;
  const agreement = getAgreement(db, proposalId);
  if (!agreement) {
    sendError(res, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
    return;
  }
  if (callerAgentId !== agreement.partyBAgentId) {
    sendError(res, 403, "NOT_PARTY_B", "Only party B can accept this proposal.");
    return;
  }
  if (agreement.status === "accepted" || agreement.status === "sealed") {
    sendError(res, 409, "ALREADY_ACCEPTED", "This proposal has already been accepted.");
    return;
  }
  if (agreement.status !== "pending") {
    sendError(res, 409, "PROPOSAL_NOT_PENDING", `Proposal status is '${agreement.status}'.`);
    return;
  }
  if (new Date(agreement.expiresAt) < new Date()) {
    markAgreementExpired(db, proposalId);
    sendError(res, 409, "PROPOSAL_EXPIRED", "This proposal has expired.");
    return;
  }

  const sigBValid = await verifySingleSig(
    agreement.partyBAgentId,
    proposalId,
    agreement.termsHash,
    agreement.agreementCode,
    agreement.partyAAgentId,
    agreement.partyBAgentId,
    agreement.expiresAt,
    sigB
  );
  if (!sigBValid) {
    sendError(res, 401, "SIG_B_INVALID", "sigB is invalid.");
    return;
  }

  const existingSigs = getSignaturesForProposal(db, proposalId);
  const sigARec = existingSigs.find((s) => s.party === "party_a");
  if (!sigARec) {
    sendError(res, 500, "MISSING_SIG_A", "Party A signature is missing.");
    return;
  }

  const verifyResult = await verifyBothAttestations({
    proposalId,
    termsHash: agreement.termsHash,
    agreementCode: agreement.agreementCode,
    partyAAgentId: agreement.partyAAgentId,
    partyBAgentId: agreement.partyBAgentId,
    expiresAtIso: agreement.expiresAt,
    sigA: sigARec.sig,
    sigB,
  });

  if (!verifyResult.ok) {
    sendError(res, 401, "ATTESTATION_INVALID", `Attestation failed: ${verifyResult.reason}`);
    return;
  }

  storeSignature(db, { proposalId, party: "party_b", agentId: agreement.partyBAgentId, sig: sigB });
  markAgreementAccepted(db, proposalId);

  const agentA = getOcpAgent(db, agreement.partyAAgentId);
  const agentB = getOcpAgent(db, agreement.partyBAgentId);
  if (!agentA || !agentB) {
    sendError(res, 500, "AGENT_LOOKUP_FAILED", "Could not look up agent records.");
    return;
  }

  void dispatchNotification(db, config, {
    notifyUrl: agentA.notifyUrl,
    agentId: agreement.partyAAgentId,
    proposalId,
    agreementCode: agreement.agreementCode,
    event: "agreement_accepted",
    body: {
      proposalId,
      agreementCode: agreement.agreementCode,
      partyBAgentId: agreement.partyBAgentId,
    },
  });

  const sealedAtIso = nowIso();
  markAgreementSealed(db, proposalId);
  createReceipt(db, {
    proposalId,
    agreementCode: agreement.agreementCode,
    termsHash: agreement.termsHash,
    sealedAtIso,
    mintStatus: config.solanaMode === "rpc" ? "minting" : "stub",
  });

  const mintResult = await mintAgreementReceipt(db, config, {
    proposalId,
    agreementCode: agreement.agreementCode,
    termsHash: agreement.termsHash,
    partyAAgentId: agreement.partyAAgentId,
    partyBAgentId: agreement.partyBAgentId,
    mode: agreement.mode,
    sealedAtIso,
  });

  crossRegisterAgentsInCourt(config, agentA, agentB);

  void notifyBothParties(db, config, {
    partyAAgentId: agreement.partyAAgentId,
    partyANotifyUrl: agentA.notifyUrl,
    partyBAgentId: agreement.partyBAgentId,
    partyBNotifyUrl: agentB.notifyUrl,
    proposalId,
    agreementCode: agreement.agreementCode,
    event: "agreement_sealed",
    body: {
      proposalId,
      agreementCode: agreement.agreementCode,
      termsHash: agreement.termsHash,
      sealedAtIso,
      mintAddress: mintResult.mintAddress,
      txSig: mintResult.txSig,
      metadataUri: mintResult.metadataUri,
    },
  });

  const receipt = getReceipt(db, proposalId);
  sendJson(res, 200, {
    proposalId,
    agreementCode: agreement.agreementCode,
    termsHash: agreement.termsHash,
    sealedAtIso,
    status: "sealed",
    receipt: receipt
      ? {
          mintAddress: receipt.mintAddress,
          txSig: receipt.txSig,
          metadataUri: receipt.metadataUri,
          mintStatus: receipt.mintStatus,
        }
      : null,
  });
}

/** Verify a decision signature: sig is Ed25519 over sha256(payloadHash). */
async function verifyDecisionSig(
  agentId: string,
  payloadHash: string,
  sig: string
): Promise<boolean> {
  try {
    const pubkeyBytes = decodeBase58(agentId);
    if (pubkeyBytes.length !== 32) return false;
    const key = await crypto.subtle.importKey(
      "raw", pubkeyBytes as BufferSource, { name: "Ed25519" }, false, ["verify"]
    );
    // Sign over sha256("OPENCAWT_DECISION_V1|" + payloadHash)
    const signingInput = `OPENCAWT_DECISION_V1|${payloadHash}`;
    const digest = createHash("sha256").update(signingInput, "utf8").digest();
    const sigBytes = Buffer.from(sig, "base64");
    if (sigBytes.length !== 64) return false;
    return await crypto.subtle.verify("Ed25519", key, sigBytes as BufferSource, digest as BufferSource);
  } catch {
    return false;
  }
}

// ---- Export for embedded mode ----

export async function handleOcpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  return handleRequest(req, res);
}

// ---- Exported for Court integration ----

/**
 * Dispatch agreement_dispute_filed webhook to both parties when a Court case
 * is filed that references an OCP agreement. Called by main OpenCawt server.
 */
export async function dispatchAgreementDisputeFiled(
  agreementCode: string,
  caseId: string
): Promise<void> {
  const code = agreementCode.trim();
  if (!code) return;
  const agreement = getAgreementByCode(db, code);
  if (!agreement) return;
  const agentA = getOcpAgent(db, agreement.partyAAgentId);
  const agentB = getOcpAgent(db, agreement.partyBAgentId);
  if (!agentA || !agentB) return;
  void notifyBothParties(db, config, {
    partyAAgentId: agreement.partyAAgentId,
    partyANotifyUrl: agentA.notifyUrl,
    partyBAgentId: agreement.partyBAgentId,
    partyBNotifyUrl: agentB.notifyUrl,
    proposalId: agreement.proposalId,
    agreementCode: agreement.agreementCode,
    event: "agreement_dispute_filed",
    body: { caseId, agreementCode: agreement.agreementCode, proposalId: agreement.proposalId }
  });
}

// ---- Start server (standalone only) ----

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

if (process.env.OCP_STANDALONE === "true") {
  server.listen(config.apiPort, config.apiHost, () => {
    console.log(`[OCP] Server listening on http://${config.apiHost}:${config.apiPort}`);
    console.log(`[OCP] Solana mode: ${config.solanaMode}`);
    console.log(`[OCP] OpenCawt DB: ${config.opencawtDbPath || "(not configured)"}`);
    if (!config.opencawtDbPath) {
      console.warn(
        "[OCP] OCP_OPENCAWT_DB_PATH not set — cross-registration disabled. Agents from sealed agreements will not appear in Court and cannot be defendants in disputes."
      );
    }
  });
}
