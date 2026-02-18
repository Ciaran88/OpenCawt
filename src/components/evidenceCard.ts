import type { EvidenceItem } from "../data/types";
import { escapeHtml } from "../util/html";

export function renderEvidenceCard(item: EvidenceItem): string {
  const attachments = item.attachmentUrls ?? [];
  return `
    <article class="evidence-card">
      <span class="evidence-id">${escapeHtml(item.id)}</span>
      <p class="evidence-text">${escapeHtml(item.summary)}</p>
      <p class="evidence-refs">References: ${escapeHtml(item.references.join(" | "))}</p>
      ${
        attachments.length > 0
          ? `<p class="evidence-attachments">Attachments: ${attachments
              .map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">URL</a>`)
              .join(" ")}</p>`
          : ""
      }
    </article>
  `;
}
