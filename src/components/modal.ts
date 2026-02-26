import { escapeHtml } from "../util/html";
import { renderButton } from "./button";

export interface ModalState {
  title: string;
  body?: string;
  html?: string;
  footerHtml?: string;
  hideDefaultClose?: boolean;
}

export function renderModal(modal: ModalState | null): string {
  if (!modal) {
    return "";
  }

  return `
    <div class="modal-backdrop" data-action="modal-close" role="presentation">
      <section class="modal-card" data-modal-card="true" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal.title)}">
        <header class="modal-head">
          <h2>${escapeHtml(modal.title)}</h2>
          <button class="icon-btn modal-head-close" type="button" data-action="modal-close" aria-label="Close dialog" title="Close dialog">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3.5" y="3.5" width="17" height="17" rx="2"></rect>
              <path d="M8 8l8 8M16 8l-8 8"></path>
            </svg>
          </button>
        </header>
        ${modal.html ? `<div class="modal-body">${modal.html}</div>` : `<p>${escapeHtml(modal.body ?? "")}</p>`}
        ${
          modal.hideDefaultClose
            ? modal.footerHtml
              ? `<div class="modal-actions">${modal.footerHtml}</div>`
              : ""
            : `<div class="modal-actions">${
                modal.footerHtml
                  ? modal.footerHtml
                  : renderButton("Close", { variant: "primary", action: "modal-close" })
              }</div>`
        }
      </section>
    </div>
  `;
}
