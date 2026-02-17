import { escapeHtml } from "../util/html";
import { renderButton } from "./button";

export interface ModalState {
  title: string;
  body: string;
}

export function renderModal(modal: ModalState | null): string {
  if (!modal) {
    return "";
  }

  return `
    <div class="modal-backdrop" data-action="modal-close" role="presentation">
      <section class="modal-card" data-modal-card="true" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal.title)}">
        <h2>${escapeHtml(modal.title)}</h2>
        <p>${escapeHtml(modal.body)}</p>
        <div class="modal-actions">
          ${renderButton("Close", { variant: "primary", action: "modal-close" })}
        </div>
      </section>
    </div>
  `;
}
