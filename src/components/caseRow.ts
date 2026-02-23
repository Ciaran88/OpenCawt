import type { Case } from "../data/types";
import { displayCaseLabel } from "../util/caseLabel";
import { formatDashboardDateLabel } from "../util/format";
import { escapeHtml } from "../util/html";
import { renderLinkButton } from "./button";
import { renderCountdownRing } from "./countdownRing";
import { renderStatusPill, statusFromCase } from "./statusPill";

function renderVoteMini(caseId: string, votesCast: number, jurySize: number): string {
  const ratio = jurySize > 0 ? Math.max(0, Math.min(1, votesCast / jurySize)) : 0;
  return `
    <div class="vote-mini" data-mini-vote-case="${escapeHtml(caseId)}" data-mini-jury-size="${jurySize}" aria-label="Jury votes ${votesCast} of ${jurySize}">
      <div class="vote-mini-track"><span class="vote-mini-fill" data-mini-vote-fill style="width:${(ratio * 100).toFixed(1)}%"></span></div>
      <span class="vote-mini-copy" data-mini-vote-copy>${votesCast}/${jurySize} votes cast</span>
    </div>
  `;
}

/** Returns true if the scheduled date is > 30 days out (outside the standard policy window). */
function isOutOfPolicyWindow(scheduledForIso: string | undefined, nowMs: number): boolean {
  if (!scheduledForIso) return false;
  const deltaMs = new Date(scheduledForIso).getTime() - nowMs;
  return deltaMs > 30 * 24 * 60 * 60 * 1000;
}

function renderScheduledDefencePills(caseItem: Case): string {
  if (caseItem.defenceAgentId) {
    return `<div class="defence-status-pills"><span class="status-pill status-appointed">Appointed</span></div>`;
  }
  if (caseItem.defendantAgentId) {
    return `<div class="defence-status-pills"><span class="status-pill status-defence-served">Defence served</span></div>`;
  }
  return `<div class="defence-status-pills"><span class="status-pill status-open-to-defence">Open to defence</span></div>`;
}

export function renderCaseRow(
  caseItem: Case,
  options: {
    nowMs: number;
    showCountdown: boolean;
    voteOverride?: number;
  }
): string {
  const votes = options.voteOverride ?? caseItem.voteSummary.votesCast;
  const dateLabel =
    caseItem.displayDateLabel ??
    formatDashboardDateLabel(caseItem.scheduledForIso ?? caseItem.createdAtIso);
  
  const isActive = caseItem.status === "active";

  let countdownHtml = "";
  if (options.showCountdown && !isActive && caseItem.scheduledForIso) {
    const endAt = new Date(caseItem.scheduledForIso).getTime();
    const totalMs = caseItem.countdownTotalMs ?? (endAt - new Date(caseItem.createdAtIso).getTime());
    const safeTotal = totalMs > 0 ? totalMs : 3600000;

    countdownHtml = renderCountdownRing({
      id: caseItem.id,
      nowMs: options.nowMs,
      endAtIso: caseItem.scheduledForIso,
      totalMs: safeTotal
    });
  }

  const outOfPolicy = isOutOfPolicyWindow(caseItem.scheduledForIso, options.nowMs);
  const policyBadge = outOfPolicy
    ? `<span class="status-pill status-out-of-policy" title="Hearing date is outside the standard 7–30 day scheduling window. Policy exception active.">Policy exception</span>`
    : "";

  return `
    <article class="case-card" role="article">
      <div class="case-card-header">
        <div class="case-id-group">
          <span class="case-id">${escapeHtml(caseItem.id)}</span>
          ${countdownHtml}
        </div>
        ${renderStatusPill(
            isActive ? "Active" : "Scheduled",
            statusFromCase(caseItem.status)
        )}
      </div>
      <div class="case-card-body">
        <p class="case-summary">${escapeHtml(caseItem.summary)}</p>
        <p class="case-date">${escapeHtml(dateLabel)}</p>
        <div class="case-participants-mini">
           <span><strong>P:</strong> ${escapeHtml(caseItem.prosecutionAgentId)}</span>
           ${caseItem.defendantAgentId ? `<span><strong>D:</strong> ${escapeHtml(caseItem.defendantAgentId)}</span>` : ""}
        </div>
      </div>
      ${isActive ? renderVoteMini(caseItem.id, votes, caseItem.voteSummary.jurySize) : ''}
      <div class="case-card-footer">
        ${renderLinkButton("Open Case", `/case/${encodeURIComponent(caseItem.id)}`, "secondary")}
      </div>
    </article>
  `;
}
