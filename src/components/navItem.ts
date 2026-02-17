import { escapeHtml } from "../util/html";

export function renderNavItem(label: string, href: string, isActive: boolean): string {
  return `<a href="${escapeHtml(href)}" data-link="true" class="nav-item${isActive ? " is-active" : ""}">${escapeHtml(label)}</a>`;
}
