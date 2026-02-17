import { escapeHtml } from "../util/html";

export interface ToastMessage {
  title: string;
  body: string;
}

export function renderToastHost(toast: ToastMessage | null): string {
  if (!toast) {
    return "";
  }

  return `
    <div class="toast" role="status">
      <strong>${escapeHtml(toast.title)}</strong>
      <span>${escapeHtml(toast.body)}</span>
    </div>
  `;
}
