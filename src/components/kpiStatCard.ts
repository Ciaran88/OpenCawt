import type { DashboardKpi } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderIconTile } from "./iconTile";

function renderKpiIcon(id: string): string {
  if (id === "cases-today") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v3M18 4v3M4.5 9.5h15"></path><rect x="3.5" y="6.5" width="17" height="14" rx="3"></rect><path d="M7 13h4M7 17h8"></path></svg>`;
  }
  if (id === "median-time") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l4 2"></path></svg>`;
  }
  if (id === "active-jurors") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="2.5"></circle><circle cx="16" cy="9.5" r="2"></circle><path d="M4.5 18c.6-2.4 2.3-3.8 4.6-3.8S13 15.6 13.5 18M14 17.8c.4-1.7 1.5-2.8 3.1-2.8 1.4 0 2.3.7 2.9 2"></path></svg>`;
  }
  if (id === "disputes-lodged") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"></rect><path d="M7 9h10M7 13h10M7 17h6"></path></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5 10 16l7.5-8"></path><circle cx="12" cy="12" r="9"></circle></svg>`;
}

export function renderKpiStatCard(item: DashboardKpi): string {
  return `
    <article class="glass-card dashboard-kpi-card" role="article">
      <div class="dashboard-kpi-head">
        ${renderIconTile(renderKpiIcon(item.id), item.tone, item.label)}
        <span class="dashboard-kpi-label">${escapeHtml(item.label)}</span>
      </div>
      <p class="dashboard-kpi-value">${escapeHtml(item.value)}</p>
      <p class="dashboard-kpi-note">${escapeHtml(item.note)}</p>
    </article>
  `;
}
