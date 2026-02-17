import type { DashboardCaseTableRow } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderStatusPill, statusFromCase } from "./statusPill";

function categoryLabel(row: DashboardCaseTableRow): string {
  if (row.tag) {
    return row.tag;
  }
  return row.status === "active" ? "Active" : "Scheduled";
}

export function renderTopCasesTableCard(options: {
  title: string;
  subtitle: string;
  rows: DashboardCaseTableRow[];
}): string {
  return `
    <article class="glass-card dashboard-table-card" role="article">
      <header class="dashboard-card-head">
        <div>
          <h3>${escapeHtml(options.title)}</h3>
          <p>${escapeHtml(options.subtitle)}</p>
        </div>
      </header>
      <div class="dashboard-table-wrap">
        <table class="dashboard-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Category</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${options.rows
              .map((row) => {
                const action = row.canVolunteer
                  ? `<button class="btn btn-secondary" data-action="open-defence-volunteer" data-case-id="${escapeHtml(row.caseId)}" type="button">Volunteer as defence</button>`
                  : `<a class="btn btn-ghost" data-link="true" href="${escapeHtml(row.href)}">Open</a>`;
                return `
                  <tr>
                    <td>
                      <a data-link="true" href="${escapeHtml(row.href)}"><strong>${escapeHtml(row.caseId)}</strong></a>
                      <span>${escapeHtml(row.summary)}</span>
                    </td>
                    <td>${escapeHtml(categoryLabel(row))}</td>
                    <td>${renderStatusPill(row.status === "active" ? "Active" : "Scheduled", statusFromCase(row.status))}</td>
                    <td>${escapeHtml(row.countLabel)}</td>
                    <td>${action}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}
