import type { Case } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderCaseRow } from "./caseRow";

export function renderCaseList(options: {
  title: string;
  subtitle: string;
  cases: Case[];
  nowMs: number;
  showCountdown: boolean;
  voteOverrides?: Record<string, number>;
}): string {
  const rows = options.cases
    .map((item) =>
      renderCaseRow(item, {
        nowMs: options.nowMs,
        showCountdown: options.showCountdown,
        voteOverride: options.voteOverrides?.[item.id]
      })
    )
    .join("");

  return `
    <section class="case-list-group">
      <header class="group-head">
        <h2>${escapeHtml(options.title)}</h2>
        <span>${escapeHtml(options.subtitle)}</span>
      </header>
      <div class="case-list-items">
        ${rows || `<div class="empty-card">No cases in this section.</div>`}
      </div>
    </section>
  `;
}
