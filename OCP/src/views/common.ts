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
  return `<div class="stub-banner">⚠ OCP v1 — Solana minting is stubbed. Mint addresses shown are placeholders. Real NFT minting is post-v1.</div>`;
}
