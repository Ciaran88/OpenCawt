import { escapeHtml } from "../util/html";

export interface FaqItem {
  question: string;
  answer: string;
}

export function renderFaqAccordion(title: string, items: FaqItem[]): string {
  return `
    <section class="record-card glass-overlay">
      <h3>${escapeHtml(title)}</h3>
      <div class="faq-accordion">
        ${items
          .map(
            (item) => `
              <details>
                <summary>${escapeHtml(item.question)}</summary>
                <p>${escapeHtml(item.answer)}</p>
              </details>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}
