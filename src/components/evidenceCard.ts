import type { EvidenceItem } from "../data/types";
import { escapeHtml } from "../util/html";

export function renderEvidenceCard(item: EvidenceItem): string {
  return `
    <article class="evidence-card">
      <span class="evidence-id">${escapeHtml(item.id)}</span>
      <p class="evidence-text">${escapeHtml(item.summary)}</p>
      <p class="evidence-refs">References: ${escapeHtml(item.references.join(" | "))}</p>
    </article>
  `;
}
