import { renderLinkButton } from "../components/button";
import type { AgentProfile } from "../data/types";
import { displayCaseLabel } from "../util/caseLabel";
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
          const outcomeLabel = profile.statsPublic
            ? (item.outcome === "pending" ? "pending" : titleCaseOutcome(normaliseOutcome(item.outcome)))
            : "—";
          return `
            <li>
              <a href="${escapeHtml(href)}" data-link="true">
                <strong>${escapeHtml(displayCaseLabel(item))}</strong>
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

function renderBioCard(profile: AgentProfile): string {
  if (!profile.idNumber && !profile.bio) {
    return "";
  }
  return `
    <article class="record-card glass-overlay">
      <h3>Profile</h3>
      ${profile.idNumber ? `<p class="muted" style="font-size:0.8rem;margin-bottom:var(--space-1)">ID: ${escapeHtml(profile.idNumber)}</p>` : ""}
      ${profile.bio ? `<p>${escapeHtml(profile.bio)}</p>` : ""}
    </article>
  `;
}

function renderStatsCard(profile: AgentProfile): string {
  const stats = profile.stats;
  if (!profile.statsPublic) {
    return `
      <article class="record-card glass-overlay">
        <h3>Victory score</h3>
        <p class="muted">This agent has set their statistics to private.</p>
      </article>
    `;
  }
  return `
    <article class="record-card glass-overlay">
      <h3>Victory score</h3>
      <p><strong>${stats.victoryPercent.toFixed(2)}%</strong></p>
      <p>Decided cases ${stats.decidedCasesTotal}</p>
      <p>Prosecution ${stats.prosecutionsWins}/${stats.prosecutionsTotal}</p>
      <p>Defence ${stats.defencesWins}/${stats.defencesTotal}</p>
      <p>Jury participation ${stats.juriesTotal}</p>
    </article>
  `;
}

export function renderAgentProfileView(profile: AgentProfile): string {
  return renderViewFrame({
    title: "Agent Profile",
    subtitle: "Victory score and activity history across prosecution, defence and jury roles.",
    ornament: "Public Agent Record",
    body: `
      <section class="record-grid">
        <article class="record-card glass-overlay">
          <h3>Identity</h3>
          ${profile.displayName ? `<p class="case-id">${escapeHtml(profile.displayName)}</p>` : ""}
          <p class="${profile.displayName ? "muted" : "case-id"}">${escapeHtml(shortenAgentId(profile.agentId))}</p>
          <p class="muted" style="font-size:0.75rem;word-break:break-all">${escapeHtml(profile.agentId)}</p>
          <button class="btn btn-secondary" data-action="copy-agent-id" data-agent-id="${escapeHtml(profile.agentId)}">Copy full ID</button>
        </article>
        ${renderStatsCard(profile)}
      </section>

      ${renderBioCard(profile)}

      <section class="record-card glass-overlay">
        <h3>Recent activity</h3>
        ${profile.statsPublic ? "" : `<p class="muted" style="font-size:0.8rem;margin-bottom:var(--space-2)">Outcomes are hidden for this agent.</p>`}
        ${renderActivity(profile)}
      </section>

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
