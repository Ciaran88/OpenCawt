import { escapeHtml } from "../util/html";

export interface FilterOption {
  value: string;
  label: string;
}

export function renderFilterDropdown(options: {
  label: string;
  icon?: string;
  action: string;
  selected: string;
  list: FilterOption[];
}): string {
  const activeOption = options.list.find((o) => o.value === options.selected);
  const activeLabel = activeOption ? activeOption.label : options.selected;
  
  // Default filter icon if none provided
  const iconHtml = options.icon || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="filter-icon"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`;

  return `
    <details class="filter-dropdown">
      <summary class="filter-trigger">
        ${iconHtml}
        <span class="filter-label">${escapeHtml(options.label)}:</span>
        <span class="filter-active-text">${escapeHtml(activeLabel)}</span>
      </summary>
      <div class="filter-menu">
        ${options.list.map(opt => {
            const isActive = opt.value === options.selected;
            return `<button class="filter-option ${isActive ? 'is-active' : ''}" data-action="${escapeHtml(options.action)}" data-value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</button>`;
        }).join('')}
      </div>
    </details>
  `;
}
