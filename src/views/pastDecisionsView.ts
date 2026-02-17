import type { AppState } from "../app/state";
import { renderLinkButton } from "../components/button";
import { renderSegmentedControl } from "../components/segmentedControl";
import { renderStatusPill, statusFromOutcome } from "../components/statusPill";
import type { Decision } from "../data/types";
import { formatDashboardDateLabel, titleCaseOutcome } from "../util/format";
import { escapeHtml } from "../util/html";
import { renderViewFrame } from "./common";

function applyDecisionFilters(state: AppState): Decision[] {
  const query = state.decisionsControls.query.trim().toLowerCase();
  const outcome = state.decisionsControls.outcome;

  return state.decisions
    .filter((decision) => {
      if (outcome !== "all" && decision.outcome !== outcome) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        decision.caseId.toLowerCase().includes(query) || decision.id.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => new Date(b.closedAtIso).getTime() - new Date(a.closedAtIso).getTime());
}

export function renderPastDecisionsView(state: AppState): string {
  const rows = applyDecisionFilters(state);

  const toolbar = `
    <section class="toolbar toolbar-decisions glass-overlay">
      <label class="search-field" aria-label="Search decisions">
        <span class="segmented-label">Search</span>
        <input data-action="decisions-query" type="search" placeholder="Case ID" value="${escapeHtml(
          state.decisionsControls.query
        )}" />
      </label>
      ${renderSegmentedControl({
        label: "Outcome",
        action: "decisions-outcome",
        selected: state.decisionsControls.outcome,
        list: [
          { value: "all", label: "All" },
          { value: "for_prosecution", label: "For prosecution" },
          { value: "for_defence", label: "For defence" },
          { value: "mixed", label: "Mixed" }
        ]
      })}
      <p class="toolbar-note">${rows.length} decisions shown</p>
    </section>
  `;

  const list = rows
    .map((decision) => {
      const dateLabel = decision.displayDateLabel ?? formatDashboardDateLabel(decision.closedAtIso);
      return `
        <article class="decision-row card-surface" role="article">
          <div>
            <h3>${escapeHtml(decision.caseId)}</h3>
            <p>${escapeHtml(decision.summary)}</p>
            <small>${escapeHtml(dateLabel)}</small>
          </div>
          <div class="decision-statuses">
            ${renderStatusPill(titleCaseOutcome(decision.outcome), statusFromOutcome(decision.outcome))}
            ${renderStatusPill(decision.status === "sealed" ? "Sealed" : "Closed", decision.status)}
          </div>
          <div class="decision-actions">
            ${renderLinkButton("View", `/decision/${encodeURIComponent(decision.caseId)}`, "pill-primary")}
          </div>
        </article>
      `;
    })
    .join("");

  return renderViewFrame({
    title: "Past Decisions",
    subtitle: "Completed records with verdict summaries and sealing placeholders.",
    ornament: "Deterministic Record Ledger",
    body: `${toolbar}<section class="decision-list">${list || `<div class="empty-card">No decisions found.</div>`}</section>`
  });
}
