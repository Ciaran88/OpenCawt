import type { AppState } from "../app/state";
import { renderCaseList } from "../components/caseList";
import { renderKpiStatCard } from "../components/kpiStatCard";
import { renderSegmentedControl } from "../components/segmentedControl";
import type { Case } from "../data/types";
import { displayCaseLabel } from "../util/caseLabel";
import { escapeHtml } from "../util/html";
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
              <span class="case-id">${escapeHtml(displayCaseLabel(item))}</span>
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
    <section class="toolbar toolbar-compact glass-surface">
      ${renderSegmentedControl({
        label: "Status",
        action: "schedule-filter",
        selected: state.scheduleControls.filter,
        list: [
          { value: "all", label: "All" },
          { value: "scheduled", label: "Scheduled" },
          { value: "active", label: "Active" }
        ]
      })}
      ${renderSegmentedControl({
        label: "Sort",
        action: "schedule-sort",
        selected: state.scheduleControls.sort,
        list: [
          { value: "time-asc", label: "Soonest" },
          { value: "time-desc", label: "Latest" }
        ]
      })}
    </section>
  `;
}

function renderDocketSections(state: AppState): string {
  const { filter, sort } = state.scheduleControls;
  const scheduledBase = sortCases(state.schedule.scheduled, sort);
  const activeBase = sortCases(state.schedule.active, sort);

  const scheduled = filter === "active" ? [] : scheduledBase;
  const active = filter === "scheduled" ? [] : activeBase;

  return `
    <section class="dashboard-docket-stack">
      ${renderDocketControls(state)}
      ${renderCaseList({
        title: "Court schedule",
        subtitle: `${scheduled.length} listed`,
        cases: scheduled,
        nowMs: state.nowMs,
        showCountdown: true,
        voteOverrides: state.liveVotes
      })}
      ${renderCaseList({
        title: "Active",
        subtitle: `${active.length} live`,
        cases: active,
        nowMs: state.nowMs,
        showCountdown: false,
        voteOverrides: state.liveVotes
      })}
      <section class="toolbar open-defence-toolbar glass-surface">
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
        ${renderSegmentedControl({
          label: "Sort",
          action: "open-defence-sort",
          selected: state.openDefenceControls.timeSort,
          list: [
            { value: "soonest", label: "Soonest" },
            { value: "latest", label: "Latest" }
          ]
        })}
        ${renderSegmentedControl({
          label: "Start",
          action: "open-defence-window",
          selected: state.openDefenceControls.startWindow,
          list: [
            { value: "all", label: "Any" },
            { value: "next-2h", label: "2h" },
            { value: "next-6h", label: "6h" }
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
  const kpiBlock = `
    <section class="dashboard-grid">
      <div class="dashboard-kpi-grid">
        ${dashboard.kpis.map((item) => renderKpiStatCard(item)).join("")}
      </div>
    </section>
  `;

  return renderViewFrame({
    title: "",
    subtitle: "",
    ornament: "",
    body: `${kpiBlock}
    <div class="frieze">COURT SCHEDULE</div>
    ${renderDocketSections(state)}`,
    className: "schedule-frame"
  });
}
