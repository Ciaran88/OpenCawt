import type { Case } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderCaseRow } from "./caseRow";
import { computeCountdownState, formatDurationLabel } from "../util/countdown";

export function renderCaseList(options: {
  title: string;
  subtitle: string;
  cases: Case[];
  nowMs: number;
  showCountdown: boolean;
  voteOverrides?: Record<string, number>;
  controls?: string;
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

  let nextSessionHtml = "";
  if (options.showCountdown) {
      const nextCase = options.cases.find(c => c.scheduledForIso && new Date(c.scheduledForIso).getTime() > options.nowMs);
      if (nextCase && nextCase.scheduledForIso) {
          const endAt = new Date(nextCase.scheduledForIso).getTime();
          const countdown = computeCountdownState(options.nowMs, endAt, 3600000);
          const label = formatDurationLabel(countdown.remainingMs);
          nextSessionHtml = `<span class="header-countdown" data-end-at="${endAt}">Next session in - ${label}</span>`;
      }
  }

  return `
    <section class="case-list-group">
      <header class="group-head">
        <div style="display: flex; align-items: baseline; gap: 12px;">
          <h2>${escapeHtml(options.title)}</h2>
          <span>${escapeHtml(options.subtitle)}</span>
          ${nextSessionHtml}
        </div>
        ${options.controls ? `<div style="display: flex; gap: 16px; align-items: center;">${options.controls}</div>` : ""}
      </header>
      <div class="case-list-grid">
        ${rows || `<div class="empty-card">No cases in this section.</div>`}
      </div>
    </section>
  `;
}
