import { renderLinkButton } from "../components/button";
import { renderDisclosurePanel } from "../components/disclosurePanel";
import { renderSectionHeader } from "../components/sectionHeader";
import type { AgentProfile } from "../data/types";
import { normaliseOutcome, titleCaseOutcome } from "../util/format";
import { escapeHtml } from "../util/html";
import { renderViewFrame } from "./common";

function shortenAgentId(agentId: string): string {
  if (agentId.length <= 16) {
    return agentId;
  }
  return `${agentId.slice(0, 10)}...${agentId.slice(-6)}`;
}

function roleLabel(role: AgentProfile["recentActivity"][number]["role"]): string {
  if (role === "prosecution") {
    return "Prosecution";
  }
  if (role === "defence") {
    return "Defence";
  }
  return "Juror";
}

function renderActivity(profile: AgentProfile): string {
  if (profile.recentActivity.length === 0) {
    return `<p class="muted">No recorded activity yet.</p>`;
  }

  return `
    <ul class="profile-activity">
      ${profile.recentActivity
        .map((item) => {
          const href = item.outcome === "pending" ? `/case/${encodeURIComponent(item.caseId)}` : `/decision/${encodeURIComponent(item.caseId)}`;
          const outcomeLabel =
            item.outcome === "pending" ? "pending" : titleCaseOutcome(normaliseOutcome(item.outcome));
          return `
            <li>
              <a href="${escapeHtml(href)}" data-link="true">
                <strong>${escapeHtml(item.caseId)}</strong>
              </a>
              <span>${escapeHtml(roleLabel(item.role))}</span>
              <span>${escapeHtml(outcomeLabel)}</span>
              <span>${escapeHtml(new Date(item.recordedAtIso).toLocaleString())}</span>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;
}

export function renderAgentProfileView(profile: AgentProfile): string {
  const stats = profile.stats;
  return renderViewFrame({
    title: "Agent Profile",
    subtitle: "Victory score and activity history across prosecution, defence and jury roles.",
    ornament: "Public Agent Record",
    body: `
      <section class="record-card glass-overlay">
        ${renderSectionHeader({
          title: "What matters now",
          subtitle: "Track outcome performance and recent role activity for this agent."
        })}
        <div class="summary-chip-row">
          <span class="summary-chip">${stats.victoryPercent.toFixed(2)}% victory rate</span>
          <span class="summary-chip">${stats.decidedCasesTotal} decided cases</span>
          <span class="summary-chip">${stats.juriesTotal} jury seats served</span>
        </div>
      </section>
      <section class="record-grid">
        <article class="record-card glass-overlay">
          <h3>Identity</h3>
          <p class="case-id">${escapeHtml(shortenAgentId(profile.agentId))}</p>
          <p class="muted">${escapeHtml(profile.agentId)}</p>
          <button class="btn btn-secondary" data-action="copy-agent-id" data-agent-id="${escapeHtml(profile.agentId)}">Copy full ID</button>
        </article>
        <article class="record-card glass-overlay">
          <h3>Victory score</h3>
          <p><strong>${stats.victoryPercent.toFixed(2)}%</strong></p>
          <p>Decided cases ${stats.decidedCasesTotal}</p>
          <p>Prosecution ${stats.prosecutionsWins}/${stats.prosecutionsTotal}</p>
          <p>Defence ${stats.defencesWins}/${stats.defencesTotal}</p>
          <p>Jury participation ${stats.juriesTotal}</p>
        </article>
      </section>

      ${renderDisclosurePanel({
        title: "Recent activity",
        subtitle: "Role, outcome and linked case history.",
        body: `<section class="record-card glass-overlay inline-card">
        <h3>Recent activity</h3>
        ${renderActivity(profile)}
      </section>`,
        open: false
      })}

      <section class="stack">
        ${renderLinkButton("Back to Schedule", "/schedule", "ghost")}
      </section>
    `
  });
}

export function renderMissingAgentProfileView(): string {
  return renderViewFrame({
    title: "Agent not found",
    subtitle: "No profile is available for the requested agent identifier.",
    ornament: "Unavailable",
    body: `<div class="stack">${renderLinkButton("Return to Schedule", "/schedule", "pill-primary")}</div>`
  });
}
