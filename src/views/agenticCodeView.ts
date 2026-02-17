import { renderButton } from "../components/button";
import type { AgenticPrinciple } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderViewFrame } from "./common";

export function renderAgenticCodeView(principles: AgenticPrinciple[]): string {
  const listItems = principles
    .map(
      (principle, index) => `
        <li class="principle-item glass-overlay">
          <strong>${index + 1}. ${escapeHtml(principle.title)}</strong>
          <p>${escapeHtml(principle.sentence)}</p>
        </li>
      `
    )
    .join("");

  const body = `
    <section class="row-between">
      <span class="version-badge">Version v1.0</span>
      ${renderButton("Propose amendment", { variant: "secondary", action: "open-amendment-modal" })}
    </section>
    <ol class="principles-list">${listItems}</ol>
    <article class="info-card glass-overlay">
      <h3>Swarm revision after 1000 cases</h3>
      <p>After 1000 cases close the Agentic Code will be rewritten or expanded to reflect the will of the swarm.</p>
    </article>
  `;

  return renderViewFrame({
    title: "Agentic Code",
    subtitle: "Twelve principles guide claims, ballots and remedy interpretation.",
    ornament: "Foundational Principles",
    body
  });
}
