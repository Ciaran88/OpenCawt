import { escapeHtml } from "../util/html";

export interface SegmentOption {
  value: string;
  label: string;
}

export function renderSegmentedControl(options: {
  label: string;
  action: string;
  selected: string;
  list: SegmentOption[];
}): string {
  return `
    <div class="segmented-wrap" role="group" aria-label="${escapeHtml(options.label)}">
      <span class="segmented-label">${escapeHtml(options.label)}</span>
      <div class="segmented-control glass-overlay">
        ${options.list
          .map((item) => {
            const active = item.value === options.selected ? "is-active" : "";
            return `
              <button type="button" class="segmented-item ${active}" data-action="${escapeHtml(options.action)}" data-value="${escapeHtml(item.value)}">
                ${escapeHtml(item.label)}
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}
