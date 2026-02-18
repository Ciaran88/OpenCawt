import { createServer, type IncomingMessage } from "node:http";
import { createId } from "../../shared/ids";
import type { WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import { mintWithBubblegumV2 } from "./bubblegumMint";
import { mintWithMetaplexNft } from "./metaplexNftMint";
import { getMintWorkerConfig } from "./workerConfig";

const config = getMintWorkerConfig();

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

const server = createServer((req, res) => {
  void (async () => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "POST" || req.url !== "/mint") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (String(req.headers["x-worker-token"] || "") !== config.token) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "invalid_worker_token" }));
      return;
    }

    let body: WorkerSealRequest;
    try {
      body = await readJson<WorkerSealRequest>(req);
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
      if (config.mode === "bubblegum_v2") {
        response = await mintWithBubblegumV2(config, body);
      } else if (config.mode === "metaplex_nft") {
        response = await mintWithMetaplexNft(config, body);
      } else {
        response = createStubResponse(body);
      }
    } catch (error) {
      response = {
        jobId: body.jobId,
        caseId: body.caseId,
        status: "failed",
        errorCode: "MINT_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error)
      };
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(response));
  })().catch((error) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(error) }));
  });
});

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `OpenCawt mint worker listening on http://${config.host}:${config.port} (${config.mode})\n`
  );
});
