import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  generateSigner,
  lamports,
  percentAmount,
  signerIdentity,
  some
} from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { createNft, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { transferSol } from "@metaplex-foundation/mpl-toolbox";
import type { WorkerSealRequest, WorkerSealResponse } from "../../shared/contracts";
import type { MintWorkerConfig } from "./workerConfig";
import { resolveAssetById } from "./dasResolver";
import { WorkerMintError } from "./errors";
import { uploadReceiptMetadata } from "./metadataUpload";

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

function buildName(caseId: string): string {
  return `OpenCawt Seal: Case ${caseId}`.slice(0, 32);
}

export async function mintWithMetaplexNft(
  config: MintWorkerConfig,
  request: WorkerSealRequest
): Promise<WorkerSealResponse> {
  if (!config.mintAuthorityKeyB58) {
    throw new Error("MINT_AUTHORITY_KEY_B58 is required for metaplex_nft mode.");
  }

  const sealedAtIso = new Date().toISOString();
  let metadataUri = request.metadataUri;
  try {
    metadataUri = metadataUri ?? (await uploadReceiptMetadata(config, request, sealedAtIso));
    if (!metadataUri) {
      throw new WorkerMintError({
        code: "METADATA_URI_MISSING",
        message: "Metadata URI missing for seal mint."
      });
    }

    const endpoint = withApiKey(config.heliusRpcUrl, config.heliusApiKey);
    const umi = createUmi(endpoint).use(mplTokenMetadata());
    const signerKeypair = Keypair.fromSecretKey(bs58.decode(config.mintAuthorityKeyB58));
    const umiKeypair = fromWeb3JsKeypair(signerKeypair);
    const signer = createSignerFromKeypair(umi, umiKeypair);
    umi.use(signerIdentity(signer));

    const mint = generateSigner(umi);
    const createNftBuilder = createNft(umi, {
      mint,
      authority: signer,
      payer: signer,
      name: buildName(request.caseId),
      symbol: "OCAWT",
      uri: metadataUri,
      sellerFeeBasisPoints: percentAmount(0),
      isMutable: false,
      creators: some([
        {
          address: signer.publicKey,
          verified: true,
          share: 100
        }
      ]),
      tokenOwner: signer.publicKey
    });
    // Metaplex mint path may charge ATA account creation from the mint signer account.
    // Prefund the fresh mint account in the same transaction to avoid intermittent
    // "insufficient lamports" failures on the mint instruction.
    const builder = transferSol(umi, {
      source: signer,
      destination: mint.publicKey,
      amount: lamports(1_500_000n)
    }).add(createNftBuilder);

    const sent = await builder.sendAndConfirm(umi, {
      confirm: {
        commitment: "finalized"
      }
    });
    const txSig = String(sent.signature);
    const assetId = String(mint.publicKey);

    try {
      await resolveAssetById(config, assetId);
    } catch {
      // Mint address is deterministic for standard NFTs. Continue even if DAS indexing lags.
    }

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
  } catch (error) {
    if (error instanceof WorkerMintError) {
      throw new WorkerMintError({
        code: error.code,
        message: error.message,
        metadataUri: metadataUri ?? error.metadataUri,
        retryable: error.retryable
      });
    }
    throw new WorkerMintError({
      code: "MINT_FAILED",
      message: error instanceof Error ? error.message : String(error),
      metadataUri,
      retryable: true
    });
  }
}
