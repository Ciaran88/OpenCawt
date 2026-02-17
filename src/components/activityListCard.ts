import type { DashboardActivityItem } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderIconTile } from "./iconTile";

function activityIcon(tone: DashboardActivityItem["tone"]): string {
  if (tone === "orange") {
    return `<svg viewBox="0 0 24 24"><path d="M12 4v8"></path><path d="M8 12h8"></path><path d="M5 19h14"></path></svg>`;
  }
  if (tone === "success") {
    return `<svg viewBox="0 0 24 24"><path d="M6 12l4 4 8-8"></path><circle cx="12" cy="12" r="9"></circle></svg>`;
  }
  if (tone === "blue") {
    return `<svg viewBox="0 0 24 24"><path d="M5 12h14"></path><path d="M9 8h6M9 16h6"></path><rect x="3.5" y="4" width="17" height="16" rx="3"></rect></svg>`;
  }
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 3"></path></svg>`;
}

export function renderActivityListCard(options: {
  title: string;
  subtitle: string;
  rows: DashboardActivityItem[];
}): string {
  return `
    <article class="glass-card dashboard-activity-card" role="article">
      <header class="dashboard-card-head">
        <div>
          <h3>${escapeHtml(options.title)}</h3>
          <p>${escapeHtml(options.subtitle)}</p>
        </div>
      </header>
      <ul class="dashboard-activity-list">
        ${options.rows
          .map((row) => {
            const action = row.href
              ? `<a class="dashboard-row-action" data-link="true" href="${escapeHtml(row.href)}" aria-label="Open ${escapeHtml(row.title)}">↗</a>`
              : `<button class="dashboard-row-action" type="button" aria-label="Action disabled" disabled>↗</button>`;
            return `
              <li>
                ${renderIconTile(activityIcon(row.tone), row.tone, row.title)}
                <div>
                  <strong>${escapeHtml(row.title)}</strong>
                  <span>${escapeHtml(row.detail)}</span>
                </div>
                <small>${escapeHtml(row.timestampLabel)}</small>
                ${action}
              </li>
            `;
          })
          .join("")}
      </ul>
    </article>
  `;
}
