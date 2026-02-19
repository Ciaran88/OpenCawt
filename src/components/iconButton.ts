import { escapeHtml } from "../util/html";

export function renderIconButton(options: {
  icon: string;
  label: string;
  action?: string;
  tone?: "neutral" | "primary" | "orange";
}): string {
  const tone = options.tone ?? "neutral";
  return `<button type="button" class="icon-btn tone-${tone}" aria-label="${escapeHtml(options.label)}"${
    options.action ? ` data-action="${escapeHtml(options.action)}"` : ""
  }>${options.icon}</button>`;
}
