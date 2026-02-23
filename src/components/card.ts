import { escapeHtml } from "../util/html";

export interface CardOptions {
  title?: string;
  className?: string;
  tagName?: string;
}

export function renderCard(content: string, options: CardOptions = {}): string {
  const tagName = options.tagName ?? "article";
  const className = `card-surface${options.className ? ` ${options.className}` : ""}`;
  const titleHtml = options.title ? `<h3>${escapeHtml(options.title)}</h3>` : "";

  return `
    <${tagName} class="${escapeHtml(className)}">
      ${titleHtml}
      ${content}
    </${tagName}>
  `;
}
