import { escapeHtml } from "../util/html";

export type IconTileTone = "blue" | "orange" | "neutral" | "success";

export function renderIconTile(icon: string, tone: IconTileTone = "neutral", label?: string): string {
  const title = label ? ` aria-label="${escapeHtml(label)}"` : " aria-hidden=\"true\"";
  return `<span class="icon-tile tone-${tone}"${title}>${icon}</span>`;
}
