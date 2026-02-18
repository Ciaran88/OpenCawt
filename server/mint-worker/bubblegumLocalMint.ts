import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, publicKey, signerIdentity } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { mintV1, mplBubblegum, parseLeafFromMintV1Transaction } from "@metaplex-foundation/mpl-bubblegum";
import type { WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import type { MintWorkerConfig } from "./workerConfig";
import { resolveAssetById } from "./dasResolver";

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

function buildMintMetadata(request: WorkerSealRequest, metadataUri: string) {
  const name = `OpenCawt Seal: Case ${request.caseId}`;
  return {
    name: name.slice(0, 32),
    symbol: "OCAWT",
    uri: metadataUri,
    sellerFeeBasisPoints: 0,
    primarySaleHappened: false,
    isMutable: false,
    tokenStandard: null,
    collection: null,
    uses: null,
    creators: []
  };
}

export async function mintWithBubblegumLocalSigning(
  config: MintWorkerConfig,
  request: WorkerSealRequest,
  metadataUri: string,
  sealedAtIso: string
): Promise<WorkerSealResponse> {
  if (!config.mintAuthorityKeyB58) {
    throw new Error("MINT_AUTHORITY_KEY_B58 is required for local signing minting.");
  }
  if (!config.bubblegumTreeAddress) {
    throw new Error("BUBBLEGUM_TREE_ADDRESS is required for local signing minting.");
  }

  const endpoint = withApiKey(config.heliusRpcUrl, config.heliusApiKey);
  const umi = createUmi(endpoint).use(mplBubblegum());

  const secretBytes = bs58.decode(config.mintAuthorityKeyB58);
  const signerKeypair = Keypair.fromSecretKey(secretBytes);
  const umiKeypair = fromWeb3JsKeypair(signerKeypair);
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(signer));

  const builder = mintV1(umi, {
    leafOwner: signer.publicKey,
    leafDelegate: signer.publicKey,
    merkleTree: publicKey(config.bubblegumTreeAddress),
    metadata: {
      ...buildMintMetadata(request, metadataUri),
      creators: [
        {
          address: signer.publicKey,
          verified: true,
          share: 100
        }
      ]
    }
  });

  const sent = await builder.sendAndConfirm(umi, {
    confirm: {
      commitment: "finalized"
    }
  });

  const txSig = String(sent.signature);
  const leaf = await parseLeafFromMintV1Transaction(umi, sent.signature);
  const assetId = String(leaf.id);

  await resolveAssetById(config, assetId);

  return {
    jobId: request.jobId,
    caseId: request.caseId,
    assetId,
    txSig,
    sealedUri: metadataUri,
    metadataUri,
    sealedAtIso,
    status: "minted"
  };
}
