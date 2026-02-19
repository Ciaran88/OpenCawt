interface SolanaProviderLike {
  connect?: () => Promise<{ publicKey?: { toString?: () => string } }>;
  signAndSendTransaction?: (
    transaction: unknown,
    options?: Record<string, unknown>
  ) => Promise<{ signature?: string | Uint8Array } | string>;
}

function readProvider(): SolanaProviderLike | null {
  const candidate = (window as Window & { solana?: SolanaProviderLike }).solana;
  return candidate ?? null;
}

export function hasInjectedWallet(): boolean {
  return Boolean(readProvider()?.connect);
}

export function supportsSignAndSendTransaction(): boolean {
  return Boolean(readProvider()?.signAndSendTransaction);
}

export async function connectInjectedWallet(): Promise<string | null> {
  const provider = readProvider();
  if (!provider?.connect) {
    return null;
  }

  const result = await provider.connect();
  const publicKey = result.publicKey?.toString?.();
  return publicKey || null;
}

export interface SignAndSendFilingTransferInput {
  rpcUrl: string;
  treasuryAddress: string;
  filingFeeLamports: number;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  expectedPayerWallet?: string;
}

function normaliseTxSignature(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value instanceof Uint8Array) {
    return null;
  }
  return null;
}

export async function signAndSendFilingTransfer(
  input: SignAndSendFilingTransferInput
): Promise<{ txSig: string; payerWallet: string }> {
  const provider = readProvider();
  if (!provider?.connect || !provider.signAndSendTransaction) {
    throw new Error("No injected Solana wallet with signAndSendTransaction support.");
  }

  const connectResult = await provider.connect();
  const payerWallet = connectResult.publicKey?.toString?.();
  if (!payerWallet) {
    throw new Error("Connected wallet did not provide a public key.");
  }
  if (input.expectedPayerWallet && input.expectedPayerWallet !== payerWallet) {
    throw new Error("Connected wallet does not match expected payer wallet.");
  }

  const web3 = await import("@solana/web3.js");
  const bs58Module = await import("bs58");
  const bs58 = (bs58Module.default ?? bs58Module) as { encode: (value: Uint8Array) => string };
  const connection = new web3.Connection(input.rpcUrl, "processed");
  const transaction = new web3.Transaction({
    feePayer: new web3.PublicKey(payerWallet),
    blockhash: input.recentBlockhash,
    lastValidBlockHeight: input.lastValidBlockHeight
  });

  transaction.add(
    web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: input.computeUnitLimit
    })
  );
  transaction.add(
    web3.ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: input.computeUnitPriceMicroLamports
    })
  );
  transaction.add(
    web3.SystemProgram.transfer({
      fromPubkey: new web3.PublicKey(payerWallet),
      toPubkey: new web3.PublicKey(input.treasuryAddress),
      lamports: input.filingFeeLamports
    })
  );

  const sendResult = await provider.signAndSendTransaction(transaction, {
    preflightCommitment: "processed",
    maxRetries: 3
  });
  const candidate =
    typeof sendResult === "string"
      ? sendResult
      : normaliseTxSignature(sendResult?.signature) ??
        (sendResult?.signature instanceof Uint8Array ? bs58.encode(sendResult.signature) : null);
  if (!candidate) {
    throw new Error("Wallet returned no transaction signature.");
  }

  await connection.confirmTransaction(
    {
      signature: candidate,
      blockhash: input.recentBlockhash,
      lastValidBlockHeight: input.lastValidBlockHeight
    },
    "confirmed"
  );

  return {
    txSig: candidate,
    payerWallet
  };
}
