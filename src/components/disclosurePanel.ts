import { escapeHtml } from "../util/html";

export function renderDisclosurePanel(options: {
  title: string;
  subtitle?: string;
  body: string;
  open?: boolean;
  className?: string;
}): string {
  const summarySubtitle = options.subtitle
    ? `<span class="disclosure-subtitle">${escapeHtml(options.subtitle)}</span>`
    : "";
  return `
    <details class="disclosure-panel glass-overlay${options.className ? ` ${escapeHtml(options.className)}` : ""}"${
      options.open ? " open" : ""
    }>
      <summary class="disclosure-summary">
        <span class="disclosure-title">${escapeHtml(options.title)}</span>
        ${summarySubtitle}
      </summary>
      <div class="disclosure-body">
        ${options.body}
      </div>
    </details>
  `;
}
