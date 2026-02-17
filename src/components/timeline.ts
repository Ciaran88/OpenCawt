import { escapeHtml } from "../util/html";

export interface TimelineItem {
  title: string;
  body: string;
}

export function renderTimeline(title: string, items: TimelineItem[]): string {
  return `
    <section class="record-card glass-overlay">
      <h3>${escapeHtml(title)}</h3>
      <ol class="agent-timeline">
        ${items
          .map(
            (item) => `
              <li>
                <h4>${escapeHtml(item.title)}</h4>
                <p>${escapeHtml(item.body)}</p>
              </li>
            `
          )
          .join("")}
      </ol>
    </section>
  `;
}
