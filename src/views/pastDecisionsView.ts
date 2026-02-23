import type { AppState } from "../app/state";
import { renderFilterDropdown } from "../components/filterDropdown";
import { renderSearchField } from "../components/searchField";
import { renderStatusPill, statusFromOutcome } from "../components/statusPill";
import type { Decision } from "../data/types";
import { formatDashboardDateLabel, normaliseOutcome, titleCaseOutcome } from "../util/format";
import { escapeHtml } from "../util/html";
import { renderCard } from "../components/card";
import { renderViewFrame } from "./common";

function applyDecisionFilters(state: AppState): Decision[] {
  const query = state.decisionsControls.query.trim().toLowerCase();
  const outcome = state.decisionsControls.outcome;

  return state.decisions
    .filter((decision) => {
      const normalisedOutcome = normaliseOutcome(decision.outcome);
      if (outcome !== "all" && normalisedOutcome !== outcome) {
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

  const toolbar = renderCard(
    `
    ${renderSearchField({
      label: "Search",
      ariaLabel: "Search decisions",
      action: "decisions-query",
      placeholder: "Case ID",
      value: state.decisionsControls.query
    })}
    ${renderFilterDropdown({
      label: "Outcome",
      action: "decisions-outcome",
      selected: state.decisionsControls.outcome,
      list: [
        { value: "all", label: "All" },
        { value: "for_prosecution", label: "For prosecution" },
        { value: "for_defence", label: "For defence" },
        { value: "void", label: "Void" }
      ]
    })}
    <p class="toolbar-note">${rows.length} decisions shown</p>
    `,
    { tagName: "section", className: "toolbar toolbar-decisions" }
  );

  const list = rows
    .map((decision) => {
      const dateLabel = decision.displayDateLabel ?? formatDashboardDateLabel(decision.closedAtIso);
      const normalisedOutcome = normaliseOutcome(decision.outcome);
      
      return `
        <a href="/decision/${encodeURIComponent(decision.caseId)}" class="card-surface decision-row">
          <div class="decision-header">
            <h3>${escapeHtml(decision.caseId)}</h3>
            <div class="decision-statuses">
              ${renderStatusPill(titleCaseOutcome(normalisedOutcome), statusFromOutcome(normalisedOutcome))}
              ${renderStatusPill(decision.status === "sealed" ? "Sealed" : "Closed", decision.status)}
            </div>
          </div>
          <div class="decision-body">
            <p>${escapeHtml(decision.summary)}</p>
            <small>${escapeHtml(dateLabel)}</small>
          </div>
        </a>
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
