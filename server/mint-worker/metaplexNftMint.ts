import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  percentAmount,
  signerIdentity,
  some,
  transactionBuilder
} from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { createV1, mintV1, mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { createAssociatedToken, findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
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

    const mint = createSignerFromKeypair(umi, fromWeb3JsKeypair(Keypair.generate()));
    const token = findAssociatedTokenPda(umi, {
      mint: mint.publicKey,
      owner: signer.publicKey
    });

    const createBuilder = createV1(umi, {
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
      tokenStandard: TokenStandard.NonFungible,
      collectionDetails: null,
      decimals: null,
      printSupply: null
    });

    const ataBuilder = createAssociatedToken(umi, {
      payer: signer,
      ata: token,
      owner: signer.publicKey,
      mint: mint.publicKey
    });

    const mintBuilder = mintV1(umi, {
      mint: mint.publicKey,
      authority: signer,
      payer: signer,
      token,
      tokenOwner: signer.publicKey,
      tokenStandard: TokenStandard.NonFungible,
      amount: 1
    });

    const builder = transactionBuilder().add(createBuilder).add(ataBuilder).add(mintBuilder);

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
