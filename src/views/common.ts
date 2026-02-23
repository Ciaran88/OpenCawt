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
  beforeHead?: string;
}): string {
  const hasTitleRow = options.title.trim().length > 0 || Boolean(options.badgeLabel);
  const hasSubtitle = options.subtitle.trim().length > 0;
  const hasHead = hasTitleRow || hasSubtitle || options.ornament.trim().length > 0;

  return renderGlassCard(
    `
      ${options.beforeHead ?? ""}
      ${hasHead ? `<header class="view-head">
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
        <div class="frieze">${escapeHtml(options.ornament)}</div>
      </header>` : ""}
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

export function renderPanelResizeButton(panel: "left" | "right"): string {
  // Inline script to handle cycling: default -> expanded -> shrunk -> default
  // Also handles mutual exclusion: if expanding one panel, shrink the other if it is expanded.
  const js = `
    var btn = this;
    var panel = '${panel}';
    var otherPanel = panel === 'left' ? 'right' : 'left';
    var states = ['default', 'expanded', 'shrunk'];
    var current = btn.dataset.sizeState || 'default';
    var next = states[(states.indexOf(current) + 1) % states.length];
    
    var layout = btn.closest('.case-view-layout');
    if (layout) {
      layout.setAttribute('data-' + panel + '-size', next);
      btn.dataset.sizeState = next;

      if (next === 'expanded') {
        var otherAttr = 'data-' + otherPanel + '-size';
        if (layout.getAttribute(otherAttr) === 'expanded') {
          layout.setAttribute(otherAttr, 'default');
          var otherBtn = layout.querySelector('button[data-panel="' + otherPanel + '"]');
          if (otherBtn) {
            otherBtn.dataset.sizeState = 'default';
          }
        }
      }
    }
  `.replace(/\n/g, " ");

  const icon =
    panel === "left"
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="3" y2="21"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="15" x2="15" y1="3" y2="21"/></svg>`;

  return `
    <button type="button" class="btn-icon-ghost" data-panel="${panel}" onclick="${escapeHtml(js)}" aria-label="Resize panel">
      ${icon}
    </button>
  `;
}
