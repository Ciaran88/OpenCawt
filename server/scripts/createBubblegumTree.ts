import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, generateSigner, signerIdentity } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import { createTree, fetchTreeConfigFromSeeds, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalNumberEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return parsed;
}

function optionalBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

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

async function main() {
  const rpcUrlRaw =
    process.env.HELIUS_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    "https://mainnet.helius-rpc.com";
  const endpoint = withApiKey(rpcUrlRaw, process.env.HELIUS_API_KEY?.trim());
  const mintAuthorityKeyB58 = requiredEnv("MINT_AUTHORITY_KEY_B58");

  const maxDepth = optionalNumberEnv("TREE_MAX_DEPTH", 14);
  const maxBufferSize = optionalNumberEnv("TREE_MAX_BUFFER_SIZE", 64);
  const canopyDepth = optionalNumberEnv("TREE_CANOPY_DEPTH", 8);
  const isPublic = optionalBooleanEnv("TREE_PUBLIC", false);

  const umi = createUmi(endpoint).use(mplBubblegum());
  const authority = Keypair.fromSecretKey(bs58.decode(mintAuthorityKeyB58));
  const umiAuthority = createSignerFromKeypair(umi, fromWeb3JsKeypair(authority));
  umi.use(signerIdentity(umiAuthority));

  const merkleTree = generateSigner(umi);
  const builder = await createTree(umi, {
    merkleTree,
    maxDepth,
    maxBufferSize,
    canopyDepth,
    public: isPublic
  });

  const sent = await builder.sendAndConfirm(umi, {
    confirm: { commitment: "finalized" }
  });
  const treeConfig = await fetchTreeConfigFromSeeds(umi, { merkleTree: merkleTree.publicKey });

  process.stdout.write(
    JSON.stringify(
      {
        merkleTreeAddress: merkleTree.publicKey,
        treeConfigAddress: treeConfig.publicKey,
        txSignature: String(sent.signature),
        maxDepth,
        maxBufferSize,
        canopyDepth,
        public: isPublic
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
