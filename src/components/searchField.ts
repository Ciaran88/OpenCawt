import { escapeHtml } from "../util/html";

export interface SearchFieldOptions {
  label: string;
  ariaLabel?: string;
  action: string;
  placeholder: string;
  value: string;
}

export function renderSearchField(options: SearchFieldOptions): string {
  const ariaLabel = options.ariaLabel ?? options.label;
  return `
    <label class="search-field" aria-label="${escapeHtml(ariaLabel)}">
      <span class="segmented-label">${escapeHtml(options.label)}</span>
      <input data-action="${escapeHtml(options.action)}" type="search" placeholder="${escapeHtml(options.placeholder)}" value="${escapeHtml(options.value)}" />
    </label>
  `;
}
