import type { AppState } from "../app/state";
import { renderCaseList } from "../components/caseList";
import { renderKpiStatCard } from "../components/kpiStatCard";
import { renderFilterDropdown } from "../components/filterDropdown";
import type { Case } from "../data/types";
import { escapeHtml } from "../util/html";

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
    return `<article class="empty-card">No open-defence cases match these filters.</article>`;
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
        <article class="case-row card-surface open-defence-row">
          <div class="case-main">
            <div class="case-idline">
              <span class="case-id">${escapeHtml(item.caseId)}</span>
              ${badge}
            </div>
            <p class="case-summary">${escapeHtml(item.summary)}</p>
            <p class="case-date">Prosecution ${escapeHtml(item.prosecutionAgentId)}${
              item.defendantAgentId ? ` · Defendant ${escapeHtml(item.defendantAgentId)}` : " · Open defendant"
            }</p>
            <p class="case-date">${
              item.tags.length > 0 ? `Tags: ${escapeHtml(item.tags.join(", "))}` : "Tags: none"
            }</p>
          </div>
          <div class="case-actions">
            ${action}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDocketControls(state: AppState): string {
  return `
      ${renderFilterDropdown({
        label: "Status",
        action: "schedule-filter",
        selected: state.scheduleControls.filter,
        list: [
          { value: "all", label: "All Cases" },
          { value: "scheduled", label: "Scheduled" },
          { value: "active", label: "Active" }
        ]
      })}
      <span class="filter-hint" style="font-size:11px;color:var(--text-tertiary);white-space:nowrap;">(Active & Court schedule)</span>
      ${renderFilterDropdown({
        label: "Sort",
        action: "schedule-sort",
        selected: state.scheduleControls.sort,
        list: [
          { value: "time-asc", label: "Soonest First" },
          { value: "time-desc", label: "Latest First" }
        ]
      })}
  `;
}

function renderActiveControls(state: AppState): string {
  return `
      ${renderFilterDropdown({
        label: "Sort",
        action: "active-sort",
        selected: state.activeControls.sort,
        list: [
          { value: "time-asc", label: "Soonest First" },
          { value: "time-desc", label: "Latest First" }
        ]
      })}
  `;
}

function renderDocketSections(state: AppState): string {
  const { filter, sort } = state.scheduleControls;
  const activeSort = state.activeControls.sort;
  const scheduledBase = sortCases(state.schedule.scheduled, sort);
  const activeBase = sortCases(state.schedule.active, activeSort);

  const scheduled = filter === "active" ? [] : scheduledBase;
  const active = filter === "scheduled" ? [] : activeBase;
  
  const docketControls = renderDocketControls(state);
  const activeControls = renderActiveControls(state);

  const activeHtml = renderCaseList({
    title: "Active",
    subtitle: `${active.length} live`,
    cases: active,
    nowMs: state.nowMs,
    showCountdown: false,
    voteOverrides: state.liveVotes,
    controls: activeControls,
    splitHeader: true
  });

  const scheduleHtml = renderCaseList({
    title: "Court schedule",
    subtitle: "",
    cases: scheduled,
    nowMs: state.nowMs,
    showCountdown: true,
    voteOverrides: state.liveVotes,
    controls: docketControls,
    splitHeader: true
  });

  return `
    <section class="dashboard-docket-stack">
      <div class="docket-split-row">
        <div class="active-cases-pane">${activeHtml}</div>
        <div class="court-schedule-pane">${scheduleHtml}</div>
      </div>
      <section class="toolbar open-defence-toolbar">
        <h3>Open defence</h3>
        <label class="search-field" aria-label="Search open defence cases">
          <span class="segmented-label">Search</span>
          <input data-action="open-defence-query" type="search" placeholder="Case ID or summary" value="${escapeHtml(
            state.openDefenceControls.query
          )}" />
        </label>
        <label class="search-field" aria-label="Filter open defence tags">
          <span class="segmented-label">Tag</span>
          <input data-action="open-defence-tag" type="search" placeholder="P2" value="${escapeHtml(
            state.openDefenceControls.tag
          )}" />
        </label>
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
            { value: "soonest", label: "Soonest First" },
            { value: "latest", label: "Latest First" }
          ]
        })}
        ${renderFilterDropdown({
          label: "Start",
          action: "open-defence-window",
          selected: state.openDefenceControls.startWindow,
          list: [
            { value: "all", label: "Any Time" },
            { value: "next-2h", label: "Next 2 Hours" },
            { value: "next-6h", label: "Next 6 Hours" }
          ]
        })}
        <p class="toolbar-note">First accepted defence assignment wins. Named defendants have a short exclusive window before open volunteering applies.</p>
      </section>
      <section class="stack">${renderOpenDefenceRows(state)}</section>
    </section>
  `;
}

export function renderScheduleView(state: AppState): string {
  const dashboard = state.dashboardSnapshot;
  return `
    <section class="dashboard-grid">
      <div class="dashboard-kpi-grid">
        ${dashboard.kpis.map((item) => renderKpiStatCard(item)).join("")}
      </div>
    </section>
    ${renderDocketSections(state)}
  `;
}
