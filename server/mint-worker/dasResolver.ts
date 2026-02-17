import type { MintWorkerConfig } from "./workerConfig";

function withApiKey(url: string, apiKey?: string): string {
  if (!apiKey) {
    return url;
  }
  if (url.includes("api-key=")) {
    return url;
  }
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}api-key=${encodeURIComponent(apiKey)}`;
}

interface DasRpcEnvelope {
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callDas(
  config: MintWorkerConfig,
  method: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const endpoint = withApiKey(config.heliusDasUrl, config.heliusApiKey);
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= config.externalAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.externalTimeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`DAS HTTP ${response.status}`);
      }

      const json = (await response.json()) as DasRpcEnvelope;
      if (json.error) {
        throw new Error(`DAS ${json.error.code}: ${json.error.message}`);
      }
      if (!json.result) {
        throw new Error("DAS empty result");
      }
      return json.result;
    } catch (error) {
      lastError = error;
      if (attempt < config.externalAttempts) {
        const jitter = Math.floor(Math.random() * 120);
        await wait(config.externalBaseDelayMs * attempt + jitter);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Failed to resolve DAS data after retries: ${String(lastError)}`);
}

export async function resolveAssetById(
  config: MintWorkerConfig,
  assetId: string
): Promise<{ assetId: string; asset: Record<string, unknown> }> {
  const result = await callDas(config, "getAsset", { id: assetId });
  return {
    assetId,
    asset: result
  };
}
