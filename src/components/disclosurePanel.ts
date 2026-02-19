import { escapeHtml } from "../util/html";

export function renderDisclosurePanel(options: {
  title: string;
  subtitle?: string;
  body: string;
  open?: boolean;
  className?: string;
}): string {
  const summarySubtitle = options.subtitle ? `<span>${escapeHtml(options.subtitle)}</span>` : "";
  return `
    <details class="disclosure-panel glass-overlay${options.className ? ` ${escapeHtml(options.className)}` : ""}"${
      options.open ? " open" : ""
    }>
      <summary class="disclosure-summary">
        <strong>${escapeHtml(options.title)}</strong>
        ${summarySubtitle}
      </summary>
      <div class="disclosure-body">
        ${options.body}
      </div>
    </details>
  `;
}
