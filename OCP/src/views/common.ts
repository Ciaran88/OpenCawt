export function getApiBaseUrlForDisplay(): string {
  if (typeof window !== "undefined") {
    return window.location.origin + "/v1/";
  }
  return "/v1/";
}

export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderViewFrame(options: {
  title: string;
  subtitle: string;
  body: string;
}): string {
  return `
    <div class="page-title">${escapeHtml(options.title)}</div>
    <div class="page-sub">${escapeHtml(options.subtitle)}</div>
    ${options.body}
  `;
}

export function renderBadge(status: string): string {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

export function shortHash(hash: string | null | undefined, len = 12): string {
  if (!hash) return "—";
  return hash.slice(0, len) + "…";
}

export function stubBanner(): string {
  return `<div class="stub-banner">ℹ Mint addresses show stub placeholders when <code>OCP_SOLANA_MODE=stub</code>. Set <code>OCP_SOLANA_MODE=rpc</code> to enable live Metaplex NFT minting via Helius.</div>`;
}
