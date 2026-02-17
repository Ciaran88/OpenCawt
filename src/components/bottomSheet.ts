import { escapeHtml } from "../util/html";

export interface BottomSheetAction {
  label: string;
  href: string;
  subtitle?: string;
}

export interface BottomSheetState {
  title: string;
  actions: BottomSheetAction[];
}

export function renderBottomSheet(sheet: BottomSheetState | null): string {
  if (!sheet) {
    return "";
  }

  return `
    <div class="sheet-backdrop" data-action="close-more-sheet" role="presentation">
      <section class="sheet-panel glass-overlay" data-sheet-panel="true" role="dialog" aria-modal="true" aria-label="${escapeHtml(sheet.title)}">
        <header class="sheet-header">
          <h2>${escapeHtml(sheet.title)}</h2>
          <button type="button" class="sheet-close" data-action="close-more-sheet" aria-label="Close sheet">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"></path></svg>
          </button>
        </header>
        <div class="sheet-list">
          ${sheet.actions
            .map(
              (action) => `
                <a href="${escapeHtml(action.href)}" data-link="true" class="sheet-item">
                  <span class="sheet-item-title">${escapeHtml(action.label)}</span>
                  ${action.subtitle ? `<span class="sheet-item-subtitle">${escapeHtml(action.subtitle)}</span>` : ""}
                </a>
              `
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}
