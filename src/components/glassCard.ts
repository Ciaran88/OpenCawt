import { escapeHtml } from "../util/html";

export type GlassCardVariant = "solid" | "glass";

export function renderGlassCard(
  content: string,
  options: {
    className?: string;
    variant?: GlassCardVariant;
  } = {}
): string {
  const variant = options.variant ?? "solid";
  const className = options.className ? ` ${escapeHtml(options.className)}` : "";
  return `<section class="glass-card card-${variant}${className}">${content}</section>`;
}
