import { escapeHtml } from "../util/html";

export interface BottomSheetAction {
  label: string;
  href?: string;
  action?: string;
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
            .map((item) => {
              if (item.action) {
                return `
                  <button type="button" class="sheet-item" data-action="${escapeHtml(item.action)}">
                    <span class="sheet-item-title">${escapeHtml(item.label)}</span>
                    ${item.subtitle ? `<span class="sheet-item-subtitle">${escapeHtml(item.subtitle)}</span>` : ""}
                  </button>
                `;
              }
              return `
                <a href="${escapeHtml(item.href ?? "#")}" data-link="true" class="sheet-item">
                  <span class="sheet-item-title">${escapeHtml(item.label)}</span>
                  ${item.subtitle ? `<span class="sheet-item-subtitle">${escapeHtml(item.subtitle)}</span>` : ""}
                </a>
              `;
            })
            .join("")}
        </div>
      </section>
    </div>
  `;
}
