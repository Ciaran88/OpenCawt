import { escapeHtml } from "../util/html";

export function renderSectionHeader(options: {
  title: string;
  subtitle?: string;
  actionsHtml?: string;
  compact?: boolean;
}): string {
  return `
    <header class="section-header${options.compact ? " is-compact" : ""}">
      <div class="section-header-copy">
        <h3>${escapeHtml(options.title)}</h3>
        ${options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ""}
      </div>
      ${options.actionsHtml ? `<div class="section-header-actions">${options.actionsHtml}</div>` : ""}
    </header>
  `;
}
