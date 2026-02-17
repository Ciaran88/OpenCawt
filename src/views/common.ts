import { renderGlassCard } from "../components/glassCard";
import { escapeHtml } from "../util/html";

export function renderViewFrame(options: {
  title: string;
  subtitle: string;
  ornament: string;
  body: string;
}): string {
  return renderGlassCard(
    `
      <header class="view-head">
        <h2>${escapeHtml(options.title)}</h2>
        <p>${escapeHtml(options.subtitle)}</p>
        <div class="frieze">${escapeHtml(options.ornament)}</div>
      </header>
      <div class="view-body">
        ${options.body}
      </div>
    `,
    { className: "view-frame", variant: "solid" }
  );
}

export function renderEmpty(message: string): string {
  return `<div class="empty-card">${escapeHtml(message)}</div>`;
}
