import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import dns from "node:dns";

// Prefer IPv4 to reduce intermittent DNS resolution failures (EAI_AGAIN, IPv6 flakiness)
dns.setDefaultResultOrder("ipv4first");
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createId } from "../../shared/ids";
import type { WorkerMintRequest, WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import { mintWithBubblegumV2 } from "./bubblegumMint";
import { asWorkerMintError } from "./errors";
import { mintWithMetaplexNft } from "./metaplexNftMint";
import { mintOcpAgreement } from "./ocpAgreementMint";
import { getMintWorkerConfig } from "./workerConfig";

const config = getMintWorkerConfig();

function log(level: "info" | "warn" | "error", message: string, fields?: Record<string, unknown>): void {
  process.stdout.write(
    `${JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...(fields ?? {}) })}\n`
  );
}

function deriveMintAuthorityPubkey(): string | undefined {
  if (!config.mintAuthorityKeyB58) return undefined;
  if (config.mode === "stub") return undefined;
  if (config.mode === "bubblegum_v2" && config.mintSigningStrategy === "external_endpoint") return undefined;
  try {
    const secret = bs58.decode(config.mintAuthorityKeyB58);
    const keypair = Keypair.fromSecretKey(secret);
    return keypair.publicKey.toBase58();
  } catch {
    return undefined;
  }
}

async function readJson<T>(req: IncomingMessage, limitBytes = 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += part.length;
    if (total > limitBytes) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function createStubResponse(body: WorkerSealRequest): WorkerSealResponse {
  const sealedAtIso = new Date().toISOString();
  return {
    jobId: body.jobId,
    caseId: body.caseId,
    assetId: `asset_${createId("cnft")}`,
    txSig: `tx_${createId("mint")}`,
    sealedUri: body.externalUrl,
    metadataUri: `${body.externalUrl}#metadata`,
    sealedAtIso,
    status: "minted"
  };
}

/** Narrow a WorkerMintRequest to WorkerSealRequest (court_case path). */
function isOcpRequest(body: WorkerMintRequest): body is import("../../shared/contracts").OcpMintRequest {
  return "requestType" in body && body.requestType === "ocp_agreement";
}

const server = createServer((req, res) => {
  void (async () => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: true,
          role: "worker",
          mode: config.mode,
          now: new Date().toISOString()
        })
      );
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      if (String(req.headers["x-worker-token"] || "") !== config.token) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "invalid_worker_token" }));
        return;
      }
      const mintAuthorityPubkey = deriveMintAuthorityPubkey();
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: true,
          mode: config.mode,
          ...(mintAuthorityPubkey ? { mintAuthorityPubkey } : {})
        })
      );
      return;
    }

    if (req.method !== "POST" || req.url !== "/mint") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (String(req.headers["x-worker-token"] || "") !== config.token) {
      log("warn", "worker_auth_failed", {
        requestId,
        method: req.method,
        url: req.url
      });
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "invalid_worker_token" }));
      return;
    }

    let body: WorkerMintRequest;
    try {
      body = await readJson<WorkerMintRequest>(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PAYLOAD_TOO_LARGE")) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: "payload_too_large" }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }

    let response: WorkerSealResponse;
    try {
      if (isOcpRequest(body)) {
        // OCP agreement NFT — dispatches to OCP-specific metadata + metaplex_nft mint
        response = await mintOcpAgreement(config, body);
      } else if (config.mode === "bubblegum_v2") {
        response = await mintWithBubblegumV2(config, body);
      } else if (config.mode === "metaplex_nft") {
        response = await mintWithMetaplexNft(config, body);
      } else {
        response = createStubResponse(body);
      }
    } catch (error) {
      const mintError = asWorkerMintError(error);
      log("error", "worker_mint_failed", {
        requestId,
        code: mintError?.code ?? "MINT_FAILED",
        message: mintError?.message ?? (error instanceof Error ? error.message : String(error)),
        mode: config.mode
      });
      // Determine a stable jobId + caseId for the error response regardless of request type
      const jobId  = "jobId"  in body ? body.jobId  : "unknown";
      const caseId = isOcpRequest(body) ? body.agreementCode
                   : "caseId" in body   ? body.caseId : "unknown";
      response = {
        jobId,
        caseId,
        status: "failed",
        errorCode: mintError?.code ?? "MINT_FAILED",
        errorMessage: mintError?.message ?? (error instanceof Error ? error.message : String(error)),
        metadataUri: mintError?.metadataUri
      };
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(response));
  })().catch((error) => {
    const requestId = randomUUID();
    log("error", "worker_request_failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
    res.setHeader("X-Request-Id", requestId);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(error) }));
  });
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `OpenCawt mint worker listening on http://${config.host}:${config.port} (${config.mode})\n`
  );
});
