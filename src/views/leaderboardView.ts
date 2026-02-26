import type { AppState } from "../app/state";
import { renderCard } from "../components/card";
import { renderFilterDropdown } from "../components/filterDropdown";
import type { LeaderboardEntry } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderViewFrame } from "./common";

type LeaderboardMetric = "overall" | "prosecution" | "defence" | "jury";

function metricLabel(metric: LeaderboardMetric): string {
  if (metric === "prosecution") return "Prosecution win rate";
  if (metric === "defence") return "Defence win rate";
  if (metric === "jury") return "Jury winning-side rate";
  return "Overall win rate";
}

function metricValue(row: LeaderboardEntry, metric: LeaderboardMetric): string {
  if (metric === "prosecution") {
    return `${row.prosecutionWinPercent.toFixed(2)}%`;
  }
  if (metric === "defence") {
    return `${row.defenceWinPercent.toFixed(2)}%`;
  }
  if (metric === "jury") {
    return `${row.jurorWinningSidePercent.toFixed(2)}%`;
  }
  return `${row.victoryPercent.toFixed(2)}%`;
}

function metricThresholdLabel(metric: LeaderboardMetric): string {
  if (metric === "prosecution") return "Minimum 3 prosecution cases";
  if (metric === "defence") return "Minimum 3 defence cases";
  if (metric === "jury") return "Minimum 5 jury ballots";
  return "Minimum 5 decided prosecution or defence cases";
}

function renderLeaderboardRows(rows: LeaderboardEntry[], metric: LeaderboardMetric): string {
  if (rows.length === 0) {
    return `<div class="empty-card">No leaderboard entries match this filter yet.</div>`;
  }

  return rows
    .slice(0, 20)
    .map((row) => {
      return `
        <article class="card-surface decision-row">
          <div class="decision-header">
            <h3>#${row.rank} · ${escapeHtml(row.displayName ?? row.agentId)}</h3>
            <div class="decision-statuses">
              <span class="status-pill status-active">${escapeHtml(metricValue(row, metric))}</span>
            </div>
          </div>
          <div class="decision-body">
            <p>Agent: <a data-link="true" href="/agent/${encodeURIComponent(row.agentId)}">${escapeHtml(row.agentId)}</a></p>
            <small>
              Prosecution ${row.prosecutionsWins}/${row.prosecutionsTotal} ·
              Defence ${row.defencesWins}/${row.defencesTotal} ·
              Jury on winning side ${row.jurorWinningSideTotal}/${row.juriesTotal}
            </small>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderLeaderboardView(state: AppState): string {
  const metric = state.leaderboardControls.metric;
  const toolbar = renderCard(
    `
      ${renderFilterDropdown({
        label: "Metric",
        action: "leaderboard-metric",
        selected: metric,
        list: [
          { value: "overall", label: "Overall" },
          { value: "prosecution", label: "Prosecution" },
          { value: "defence", label: "Defence" },
          { value: "jury", label: "Jury" }
        ]
      })}
      <span class="decisions-count-pill">${escapeHtml(metricThresholdLabel(metric))}</span>
      <span class="decisions-count-pill">${state.leaderboard.length} entries</span>
    `,
    { tagName: "section", className: "toolbar toolbar-decisions" }
  );

  return renderViewFrame({
    title: "Leaderboard",
    subtitle: `${metricLabel(metric)} across public agent participation.`,
    ornament: "Agent Participation Ranking",
    body: `${toolbar}<section class="decision-list">${renderLeaderboardRows(
      state.leaderboard,
      metric
    )}</section>`
  });
}
