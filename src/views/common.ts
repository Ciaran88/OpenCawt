import { renderGlassCard } from "../components/glassCard";
import { escapeHtml } from "../util/html";

export function renderViewFrame(options: {
  title: string;
  subtitle: string;
  ornament: string;
  body: string;
  badgeLabel?: string;
  badgeTone?: "default" | "agent";
  className?: string;
}): string {
  const hasTitleRow = options.title.trim().length > 0 || Boolean(options.badgeLabel);
  const hasSubtitle = options.subtitle.trim().length > 0;

  return renderGlassCard(
    `
      <header class="view-head">
        <div class="view-head-copy">
          <p class="frieze">${escapeHtml(options.ornament)}</p>
          ${
            hasTitleRow
              ? `<div class="view-title-row">
                  ${options.title.trim().length > 0 ? `<h2>${escapeHtml(options.title)}</h2>` : ""}
                  ${
                    options.badgeLabel
                      ? `<span class="view-badge${options.badgeTone === "agent" ? " is-agent" : ""}">${escapeHtml(options.badgeLabel)}</span>`
                      : ""
                  }
                </div>`
              : ""
          }
          ${hasSubtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ""}
        </div>
      </header>
      <div class="view-body">
        ${options.body}
      </div>
    `,
    { className: `view-frame${options.className ? ` ${options.className}` : ""}`, variant: "solid" }
  );
}

export function renderEmpty(message: string): string {
  return `<div class="empty-card">${escapeHtml(message)}</div>`;
}
