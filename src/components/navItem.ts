import { escapeHtml } from "../util/html";

export type NavItemVariant = "glass" | "accent" | "agent";

export function renderNavItem(
  label: string,
  href: string,
  isActive: boolean,
  options: { agentRoute?: boolean; variant?: NavItemVariant; chevron?: boolean } = {}
): string {
  const classes = ["nav-item"];
  const variant =
    options.variant ??
    (options.agentRoute ? "agent" : isActive ? "accent" : "glass");
  classes.push(`variant-${variant}`);
  if (isActive) {
    classes.push("is-active");
  }
  if (options.agentRoute) {
    classes.push("is-agent-route");
  }
  return `<a href="${escapeHtml(href)}" data-link="true" class="${classes.join(" ")}">${escapeHtml(label)}${
    options.chevron ? `<span class="nav-chevron" aria-hidden="true">▾</span>` : ""
  }</a>`;
}
