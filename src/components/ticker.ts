import type { TickerEvent } from "../data/types";
import { displayCaseLabel } from "../util/caseLabel";
import { escapeHtml } from "../util/html";

function renderThumbIcon(direction: "up" | "down"): string {
  const rotate = direction === "down" ? ' transform="rotate(180 12 12)"' : "";
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"${rotate}>
        <path d="M5.2 10.2h3.5v8.5H5.2z"></path>
        <path d="M8.7 10.4 12.3 5c.8-1.1 2.5-.5 2.3.9l-.4 2.5h4.2c1 0 1.7 1 1.4 1.9l-1.3 5.2c-.2.9-1.1 1.5-2 1.5H8.7"></path>
      </g>
    </svg>
  `;
}

function renderOutcomeIcon(outcome: TickerEvent["outcome"]): string {
  if (outcome === "for_prosecution") {
    return `<span class="ticker-icon icon-up" aria-hidden="true">${renderThumbIcon("up")}</span>`;
  }
  if (outcome === "for_defence") {
    return `<span class="ticker-icon icon-down" aria-hidden="true">${renderThumbIcon("down")}</span>`;
  }
  return `<span class="ticker-icon icon-void" aria-hidden="true">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"></circle>
      <path d="M8.2 8.2 15.8 15.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
    </svg>
  </span>`;
}

function renderItem(event: TickerEvent): string {
  return `
    <span class="ticker-item" role="listitem">
      ${renderOutcomeIcon(event.outcome)}
      <a href="/decision/${escapeHtml(event.caseId)}" data-link="true" class="ticker-case">${escapeHtml(displayCaseLabel(event))}</a>
      <span class="ticker-label">${escapeHtml(event.label)}</span>
    </span>
  `;
}

export function renderTicker(events: TickerEvent[]): string {
  const items =
    events.length > 0
      ? events.map(renderItem).join("")
      : `<span class="ticker-item">No recent decisions</span>`;

  return `
    <div class="ticker" aria-label="Recently concluded cases">
      <div class="ticker-track" role="list">
        ${items}
        ${items}
      </div>
    </div>
  `;
}
