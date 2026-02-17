interface SolanaProviderLike {
  connect?: () => Promise<{ publicKey?: { toString?: () => string } }>;
}

function readProvider(): SolanaProviderLike | null {
  const candidate = (window as Window & { solana?: SolanaProviderLike }).solana;
  return candidate ?? null;
}

export function hasInjectedWallet(): boolean {
  return Boolean(readProvider()?.connect);
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
