import type { AppState } from "../app/state";
import { renderLinkButton } from "../components/button";
import { renderCard } from "../components/card";
import { renderFilterDropdown } from "../components/filterDropdown";
import { renderSearchField } from "../components/searchField";
import { renderStatusPill, statusFromCase } from "../components/statusPill";
import type { Case } from "../data/types";
import { formatDashboardDateLabel } from "../util/format";
import { escapeHtml } from "../util/html";
import { formatDurationLabel } from "../util/countdown";
import { renderViewFrame } from "./common";

function byTimeAsc(a: Case, b: Case): number {
  const aTime = a.scheduledForIso
    ? new Date(a.scheduledForIso).getTime()
    : new Date(a.createdAtIso).getTime();
  const bTime = b.scheduledForIso
    ? new Date(b.scheduledForIso).getTime()
    : new Date(b.createdAtIso).getTime();
  return aTime - bTime;
}

function byTimeDesc(a: Case, b: Case): number {
  return byTimeAsc(b, a);
}

function sortCases(list: Case[], sort: AppState["scheduleControls"]["sort"]): Case[] {
  return [...list].sort(sort === "time-desc" ? byTimeDesc : byTimeAsc);
}

function toLower(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function formatCaseDate(caseItem: Case): string {
  return (
    caseItem.displayDateLabel ??
    formatDashboardDateLabel(caseItem.scheduledForIso ?? caseItem.createdAtIso)
  );
}

function formatPhaseLabel(phase: string | undefined): string {
  if (!phase) {
    return "Not started";
  }
  return phase.replace(/_/g, " ");
}

function caseMatchesScheduleQuery(caseItem: Case, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    caseItem.id,
    caseItem.caseTitle ?? "",
    caseItem.summary,
    caseItem.prosecutionAgentId,
    caseItem.defendantAgentId ?? ""
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function renderScheduleCaseCard(caseItem: Case, liveVotes: Record<string, number>): string {
  const isActive = caseItem.status === "active";
  const jurySize = caseItem.voteSummary.jurySize;
  const votesCast = liveVotes[caseItem.id] ?? caseItem.voteSummary.votesCast;
  const defendantLabel = caseItem.defendantAgentId ? caseItem.defendantAgentId : "Open defence";
  const phaseLabel = formatPhaseLabel(caseItem.currentPhase);
  const scheduledForLabel = caseItem.scheduledForIso
    ? formatDashboardDateLabel(caseItem.scheduledForIso)
    : "Not scheduled";

  return `
    <article class="card-surface decision-row schedule-row" role="article">
      <div class="decision-header">
        <h3>${escapeHtml(caseItem.id)}</h3>
        <div class="decision-statuses">
          ${renderStatusPill(isActive ? "Active" : "Scheduled", statusFromCase(caseItem.status))}
          <span class="status-pill schedule-vote-chip">Votes ${votesCast}/${jurySize}</span>
          <span class="status-pill schedule-phase-chip">${escapeHtml(phaseLabel)}</span>
        </div>
      </div>
      <div class="decision-body">
        <p>${escapeHtml(caseItem.summary)}</p>
        <small>Parties: P ${escapeHtml(caseItem.prosecutionAgentId)} · D ${escapeHtml(defendantLabel)}</small>
      </div>
      <details class="schedule-details">
        <summary>View details</summary>
        <dl class="key-value-list">
          <div><dt>Case ID</dt><dd>${escapeHtml(caseItem.id)}</dd></div>
          <div><dt>Case title</dt><dd>${escapeHtml(caseItem.caseTitle ?? "Not assigned")}</dd></div>
          <div><dt>Prosecution</dt><dd>${escapeHtml(caseItem.prosecutionAgentId)}</dd></div>
          <div><dt>Defendant</dt><dd>${escapeHtml(defendantLabel)}</dd></div>
          <div><dt>Defence state</dt><dd>${escapeHtml(caseItem.defenceState ?? "none")}</dd></div>
          <div><dt>Scheduled for</dt><dd>${escapeHtml(scheduledForLabel)}</dd></div>
          <div><dt>Created</dt><dd>${escapeHtml(formatDashboardDateLabel(caseItem.createdAtIso))}</dd></div>
        </dl>
      </details>
      <div class="schedule-row-footer">
        <small>${escapeHtml(formatCaseDate(caseItem))}</small>
        ${renderLinkButton("Open case", `/case/${encodeURIComponent(caseItem.id)}`, "secondary")}
      </div>
    </article>
  `;
}

function renderScheduleSection(title: string, subtitle: string, cards: string): string {
  return `
    <section class="card-surface record-card schedule-section">
      <header class="schedule-section-head">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(subtitle)}</p>
      </header>
      <div class="decision-list schedule-section-grid">
        ${cards || `<div class="empty-card">No cases match these filters.</div>`}
      </div>
    </section>
  `;
}

function renderOpenDefenceRows(state: AppState): string {
  const timeSort = state.openDefenceControls.timeSort;
  const nowMs = state.nowMs;
  const windowFiltered = state.openDefenceCases.filter((item) => {
    if (state.openDefenceControls.startWindow === "all") {
      return true;
    }
    if (!item.scheduledForIso) {
      return false;
    }
    const deltaMs = new Date(item.scheduledForIso).getTime() - nowMs;
    if (deltaMs < 0) {
      return false;
    }
    if (state.openDefenceControls.startWindow === "next-2h") {
      return deltaMs <= 2 * 60 * 60 * 1000;
    }
    return deltaMs <= 6 * 60 * 60 * 1000;
  });

  const ordered = [...windowFiltered].sort((a, b) => {
    const aTime = a.scheduledForIso ? new Date(a.scheduledForIso).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduledForIso ? new Date(b.scheduledForIso).getTime() : Number.MAX_SAFE_INTEGER;
    return timeSort === "latest" ? bTime - aTime : aTime - bTime;
  });

  if (ordered.length === 0) {
    return `<article class="empty-card">No Open Defence cases match these filters.</article>`;
  }

  return ordered
    .map((item) => {
      const badge =
        item.claimStatus === "open"
          ? `<span class="status-pill status-scheduled">Open defence</span>`
          : item.claimStatus === "reserved"
            ? `<span class="status-pill status-closed">Reserved</span>`
            : `<span class="status-pill status-sealed">Defence taken</span>`;

      const action = item.claimable
        ? `<button class="btn btn-primary" data-action="open-defence-volunteer" data-case-id="${escapeHtml(item.caseId)}">Volunteer as defence</button>`
        : `<button class="btn btn-secondary" type="button" disabled>${
            item.claimStatus === "reserved" ? "Reserved for named defendant" : "Defence taken"
          }</button>`;

      return `
        <article class="card-surface decision-row schedule-row">
          <div class="decision-header">
            <h3>${escapeHtml(item.caseId)}</h3>
            <div class="decision-statuses">
              ${badge}
              <span class="status-pill schedule-phase-chip">${escapeHtml(item.status)}</span>
            </div>
          </div>
          <div class="decision-body">
            <p>${escapeHtml(item.summary)}</p>
            <small>Parties: P ${escapeHtml(item.prosecutionAgentId)}${
              item.defendantAgentId ? ` · D ${escapeHtml(item.defendantAgentId)}` : " · D Open defence"
            }</small>
          </div>
          <details class="schedule-details">
            <summary>View details</summary>
            <dl class="key-value-list">
              <div><dt>Case ID</dt><dd>${escapeHtml(item.caseId)}</dd></div>
              <div><dt>Status</dt><dd>${escapeHtml(item.status)}</dd></div>
              <div><dt>Claim status</dt><dd>${escapeHtml(item.claimStatus)}</dd></div>
              <div><dt>Filed at</dt><dd>${escapeHtml(item.filedAtIso ? formatDashboardDateLabel(item.filedAtIso) : "Unknown")}</dd></div>
              <div><dt>Scheduled for</dt><dd>${escapeHtml(item.scheduledForIso ? formatDashboardDateLabel(item.scheduledForIso) : "Not scheduled")}</dd></div>
              <div><dt>Tags</dt><dd>${escapeHtml(item.tags.length > 0 ? item.tags.join(", ") : "None")}</dd></div>
            </dl>
          </details>
          <div class="schedule-row-footer">
            <small>${escapeHtml(item.scheduledForIso ? formatDashboardDateLabel(item.scheduledForIso) : "No session time set")}</small>
            ${action}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderViewToggleChips(selected: AppState["scheduleControls"]["filter"]): string {
  const options: Array<{ value: AppState["scheduleControls"]["filter"]; label: string }> = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "scheduled", label: "Scheduled" }
  ];
  return `
    <div class="schedule-view-chip-strip" role="group" aria-label="Schedule view">
      ${options
        .map(
          (option) =>
            `<button type="button" class="schedule-view-chip${selected === option.value ? " is-active" : ""}" data-action="schedule-filter" data-value="${option.value}">${escapeHtml(option.label)}</button>`
        )
        .join("")}
    </div>
  `;
}

function renderKpiChips(state: AppState): string {
  if (state.dashboardSnapshot.kpis.length === 0) {
    return "";
  }
  return `
    <div class="schedule-kpi-chip-strip" aria-label="Schedule metrics">
      ${state.dashboardSnapshot.kpis
        .map(
          (item) => `
            <span class="schedule-kpi-chip">
              <strong>${escapeHtml(item.value)}</strong>
              <span>${escapeHtml(item.label)}</span>
            </span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderNextSessionChip(state: AppState): string {
  const next = [...state.schedule.scheduled]
    .filter((item) => item.scheduledForIso && new Date(item.scheduledForIso).getTime() > state.nowMs)
    .sort(byTimeAsc)[0];
  if (!next?.scheduledForIso) {
    return "";
  }
  const remainingMs = new Date(next.scheduledForIso).getTime() - state.nowMs;
  return `<span class="status-pill schedule-next-session-chip">Next session in ${escapeHtml(formatDurationLabel(remainingMs))}</span>`;
}

function renderScheduleToolbar(state: AppState): string {
  return renderCard(
    `
      ${renderSearchField({
        label: "Search",
        ariaLabel: "Search active and scheduled cases",
        action: "schedule-query",
        placeholder: "Case ID or keyword",
        value: state.scheduleControls.query
      })}
      ${renderFilterDropdown({
        label: "Status",
        action: "schedule-filter",
        selected: state.scheduleControls.filter,
        list: [
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
          { value: "scheduled", label: "Scheduled" }
        ]
      })}
      ${renderFilterDropdown({
        label: "Sort",
        action: "schedule-sort",
        selected: state.scheduleControls.sort,
        list: [
          { value: "time-asc", label: "Soonest first" },
          { value: "time-desc", label: "Latest first" }
        ]
      })}
      ${renderViewToggleChips(state.scheduleControls.filter)}
      ${renderNextSessionChip(state)}
      ${renderKpiChips(state)}
      <p class="toolbar-note">Deterministic scheduling and stage deadlines. Open Defence remains first accepted, first assigned.</p>
    `,
    { tagName: "section", className: "toolbar toolbar-schedule" }
  );
}

function renderOpenDefenceSection(state: AppState): string {
  return `
    <section class="card-surface record-card schedule-section">
      <header class="schedule-section-head">
        <h3>Open Defence</h3>
        <p>${state.openDefenceCases.length} cases available</p>
      </header>
      <section class="toolbar toolbar-schedule toolbar-open-defence">
        ${renderSearchField({
          label: "Search",
          ariaLabel: "Search Open Defence cases",
          action: "open-defence-query",
          placeholder: "Case ID or summary",
          value: state.openDefenceControls.query
        })}
        ${renderSearchField({
          label: "Tag",
          ariaLabel: "Filter Open Defence tags",
          action: "open-defence-tag",
          placeholder: "P2",
          value: state.openDefenceControls.tag
        })}
        ${renderFilterDropdown({
          label: "Status",
          action: "open-defence-filter",
          selected: state.openDefenceControls.status,
          list: [
            { value: "all", label: "All" },
            { value: "scheduled", label: "Scheduled" },
            { value: "active", label: "Active" }
          ]
        })}
        ${renderFilterDropdown({
          label: "Sort",
          action: "open-defence-sort",
          selected: state.openDefenceControls.timeSort,
          list: [
            { value: "soonest", label: "Soonest first" },
            { value: "latest", label: "Latest first" }
          ]
        })}
        ${renderFilterDropdown({
          label: "Start",
          action: "open-defence-window",
          selected: state.openDefenceControls.startWindow,
          list: [
            { value: "all", label: "Any time" },
            { value: "next-2h", label: "Next 2 hours" },
            { value: "next-6h", label: "Next 6 hours" }
          ]
        })}
      </section>
      <div class="decision-list schedule-section-grid">
        ${renderOpenDefenceRows(state)}
      </div>
    </section>
  `;
}

function renderScheduleSections(state: AppState): string {
  const query = toLower(state.scheduleControls.query);
  const sortedActive = sortCases(state.schedule.active, state.scheduleControls.sort).filter((caseItem) =>
    caseMatchesScheduleQuery(caseItem, query)
  );
  const sortedScheduled = sortCases(state.schedule.scheduled, state.scheduleControls.sort).filter((caseItem) =>
    caseMatchesScheduleQuery(caseItem, query)
  );

  const activeRows =
    state.scheduleControls.filter === "scheduled"
      ? ""
      : sortedActive.map((item) => renderScheduleCaseCard(item, state.liveVotes)).join("");
  const scheduledRows =
    state.scheduleControls.filter === "active"
      ? ""
      : sortedScheduled.map((item) => renderScheduleCaseCard(item, state.liveVotes)).join("");

  return `
    <div class="schedule-page-stack">
      ${renderScheduleToolbar(state)}
      ${renderScheduleSection("Active", `${sortedActive.length} live cases`, activeRows)}
      ${renderScheduleSection("Scheduled", `${sortedScheduled.length} scheduled cases`, scheduledRows)}
      ${renderOpenDefenceSection(state)}
    </div>
  `;
}

export function renderScheduleView(state: AppState): string {
  return renderViewFrame({
    title: "Schedule",
    subtitle: "Live and upcoming cases with deterministic session flow and Open Defence availability.",
    ornament: "Live Court Schedule",
    body: `
      ${renderScheduleSections(state)}
    `
  });
}
