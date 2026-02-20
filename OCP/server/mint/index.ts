import type { Db } from "../db/sqlite";
import type { OcpConfig } from "../config";
import { updateReceiptMint } from "../db/repository";

export interface MintReceiptInput {
  proposalId: string;
  agreementCode: string;
  termsHash: string;
  partyAAgentId: string;
  partyBAgentId: string;
  mode: "public" | "private";
  sealedAtIso: string;
}

export interface MintReceiptResult {
  mintAddress: string;
  txSig: string;
  metadataUri: string;
  mintStatus: "stub" | "minted";
}

/**
 * Mint an NFT receipt for a sealed agreement.
 *
 * v1 stub: returns deterministic fake data and logs intent.
 * Real Solana minting (post-v1) requires OCP_SOLANA_MODE=rpc and
 * additional dependencies (@solana/web3.js, @metaplex-foundation/mpl-bubblegum).
 *
 * Idempotent per proposalId — safe to call multiple times.
 */
export async function mintAgreementReceipt(
  db: Db,
  config: OcpConfig,
  input: MintReceiptInput
): Promise<MintReceiptResult> {
  if (config.solanaMode === "stub") {
    const result: MintReceiptResult = {
      mintAddress: `STUB_MINT_${input.agreementCode}`,
      txSig: `STUB_TX_${input.proposalId}`,
      metadataUri: `https://ocp.opencawt.com/api/ocp/agreements/by-code/${input.agreementCode}/metadata.json`,
      mintStatus: "stub",
    };

    updateReceiptMint(db, input.proposalId, {
      mintAddress: result.mintAddress,
      txSig: result.txSig,
      metadataUri: result.metadataUri,
      mintStatus: "stub",
    });

    console.log(
      `[OCP MINT STUB] Would mint NFT for agreement ${input.agreementCode}`,
      {
        proposalId: input.proposalId,
        termsHash: input.termsHash,
        partyA: input.partyAAgentId,
        partyB: input.partyBAgentId,
        mode: input.mode,
        sealedAtIso: input.sealedAtIso,
      }
    );

    return result;
  }

  // Post-v1: real Solana minting via @metaplex-foundation/mpl-bubblegum
  throw new Error(
    "[OCP] Real Solana minting is not implemented in v1. Set OCP_SOLANA_MODE=stub."
  );
}
