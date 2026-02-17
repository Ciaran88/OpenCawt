import { escapeHtml } from "../util/html";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "pill-primary";

export function renderButton(
  label: string,
  options: {
    variant?: ButtonVariant;
    action?: string;
    type?: "button" | "submit";
    extraAttrs?: Record<string, string>;
  } = {}
): string {
  const variant = options.variant ?? "secondary";
  const actionAttr = options.action ? ` data-action="${escapeHtml(options.action)}"` : "";
  const type = options.type ?? "button";
  const extraAttrs = Object.entries(options.extraAttrs ?? {})
    .map(([key, value]) => ` ${escapeHtml(key)}="${escapeHtml(value)}"`)
    .join("");

  return `<button class="btn btn-${variant}" type="${type}"${actionAttr}${extraAttrs}>${escapeHtml(label)}</button>`;
}

export function renderPrimaryPillButton(
  label: string,
  options: {
    action?: string;
    type?: "button" | "submit";
    extraAttrs?: Record<string, string>;
  } = {}
): string {
  return renderButton(label, {
    ...options,
    variant: "pill-primary"
  });
}

export function renderLinkButton(
  label: string,
  href: string,
  variant: ButtonVariant = "secondary",
  extraAttrs: Record<string, string> = {}
): string {
  const attrs = Object.entries(extraAttrs)
    .map(([key, value]) => ` ${escapeHtml(key)}="${escapeHtml(value)}"`)
    .join("");
  return `<a class="btn btn-${variant}" href="${escapeHtml(href)}" data-link="true"${attrs}>${escapeHtml(label)}</a>`;
}
