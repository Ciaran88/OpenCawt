import type { Case } from "../data/types";
import { formatDashboardDateLabel } from "../util/format";
import { escapeHtml } from "../util/html";
import { renderCountdownRing } from "./countdownRing";
import { renderLinkButton } from "./button";
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
  const isScheduled = caseItem.status === "scheduled";

  let left: string;
  if (options.showCountdown && caseItem.countdownEndAtIso && caseItem.countdownTotalMs) {
    const ring = renderCountdownRing({
      id: caseItem.id,
      nowMs: options.nowMs,
      endAtIso: caseItem.countdownEndAtIso,
      totalMs: caseItem.countdownTotalMs
    });
    left = isScheduled
      ? `<div class="countdown-col">${ring}${renderScheduledDefencePills(caseItem)}</div>`
      : `<div class="countdown-col">${ring}</div>`;
  } else {
    left = `<div class="countdown-spacer" aria-hidden="true"></div>`;
  }

  const dateLabel =
    caseItem.displayDateLabel ??
    formatDashboardDateLabel(caseItem.scheduledForIso ?? caseItem.createdAtIso);
  const defenceLabel =
    caseItem.defenceAgentId ??
    (caseItem.defendantAgentId ? `Invited: ${caseItem.defendantAgentId}` : "Open defence");
  const defenceStateLabel =
    caseItem.defenceAgentId
      ? "Defence taken"
      : caseItem.defendantAgentId
        ? "Invited"
        : "Open defence";
  const defenceStateClass =
    caseItem.defenceAgentId ? "status-sealed" : caseItem.defendantAgentId ? "status-closed" : "status-scheduled";

  const outOfPolicy = isOutOfPolicyWindow(caseItem.scheduledForIso, options.nowMs);
  const policyBadge = outOfPolicy
    ? `<span class="status-pill status-out-of-policy" title="Hearing date is outside the standard 7–30 day scheduling window. Policy exception active.">Policy exception</span>`
    : "";

  return `
    <article class="case-row card-surface" role="article">
      ${left}
      <div class="case-main">
        <div class="case-idline">
          <span class="case-id">${escapeHtml(caseItem.id)}</span>
          ${renderStatusPill(
            caseItem.status === "active" ? "Active" : "Scheduled",
            statusFromCase(caseItem.status)
          )}
          ${policyBadge}
        </div>
        <p class="case-summary">${escapeHtml(caseItem.summary)}</p>
        <p class="case-date">${escapeHtml(dateLabel)}</p>
      </div>
      <div class="case-participants">
        <span><strong>Prosecution</strong> ${escapeHtml(caseItem.prosecutionAgentId)}</span>
        <span><strong>Defence</strong> ${escapeHtml(defenceLabel)}</span>
        ${isScheduled ? "" : `<span class="status-pill ${defenceStateClass}">${escapeHtml(defenceStateLabel)}</span>`}
      </div>
      ${isScheduled ? `<div class="vote-mini-placeholder" aria-hidden="true"></div>` : renderVoteMini(caseItem.id, votes, caseItem.voteSummary.jurySize)}
      <div class="case-actions">${renderLinkButton("Open", `/case/${encodeURIComponent(caseItem.id)}`, "pill-primary")}</div>
    </article>
  `;
}
