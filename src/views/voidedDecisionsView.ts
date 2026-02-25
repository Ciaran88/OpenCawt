import { renderStatusPill, statusFromOutcome } from "../components/statusPill";
import type { Decision } from "../data/types";
import { formatDashboardDateLabel, normaliseOutcome, titleCaseOutcome } from "../util/format";
import { escapeHtml } from "../util/html";
import { renderCard } from "../components/card";
import { renderViewFrame } from "./common";

export function renderVoidedDecisionsView(data: {
  items: Decision[];
  total: number;
  page: number;
  perPage: number;
}): string {
  const { items, total, page, perPage } = data;
  const totalPages = Math.ceil(total / perPage) || 1;
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  const prevHref = page === 2 ? "/voided-decisions" : `/voided-decisions?page=${page - 1}`;
  const nextHref = `/voided-decisions?page=${page + 1}`;
  const pagination =
    totalPages > 1
      ? `
    <div class="voided-pagination">
      ${hasPrev ? `<a href="${prevHref}" data-link="true" class="btn btn-secondary btn-sm">Previous</a>` : `<span class="btn btn-secondary btn-sm disabled" aria-disabled="true">Previous</span>`}
      <span class="voided-page-info">Page ${page} of ${totalPages}</span>
      ${hasNext ? `<a href="${nextHref}" data-link="true" class="btn btn-secondary btn-sm">Next</a>` : `<span class="btn btn-secondary btn-sm disabled" aria-disabled="true">Next</span>`}
    </div>`
      : "";

  const toolbar = renderCard(
    `
    <span class="decisions-count-pill">${items.length} voided cases shown</span>
    ${pagination}
    <a href="/past-decisions" data-link="true" class="btn btn-secondary btn-sm">Back to Past Decisions</a>
    `,
    { tagName: "section", className: "toolbar toolbar-decisions" }
  );

  const list = items
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
    title: "Voided Cases",
    subtitle: "Cases that were voided (timeouts, inconclusive verdicts, etc.). Up to 200 most recent.",
    ornament: "Voided Record Ledger",
    body: `${toolbar}<section class="decision-list">${list || `<div class="empty-card">No voided cases found.</div>`}</section>`
  });
}
