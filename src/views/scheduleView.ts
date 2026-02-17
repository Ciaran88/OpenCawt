import type { AppState } from "../app/state";
import { renderCaseList } from "../components/caseList";
import { renderSegmentedControl } from "../components/segmentedControl";
import type { Case } from "../data/types";
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

export function renderScheduleView(state: AppState): string {
  const { filter, sort } = state.scheduleControls;
  const scheduledBase = sortCases(state.schedule.scheduled, sort);
  const activeBase = sortCases(state.schedule.active, sort);

  const scheduled = filter === "active" ? [] : scheduledBase;
  const active = filter === "scheduled" ? [] : activeBase;

  const controls = `
    <section class="toolbar glass-overlay">
      ${renderSegmentedControl({
        label: "Status",
        action: "schedule-filter",
        selected: filter,
        list: [
          { value: "all", label: "All" },
          { value: "scheduled", label: "Scheduled" },
          { value: "active", label: "Active" }
        ]
      })}
      ${renderSegmentedControl({
        label: "Sort",
        action: "schedule-sort",
        selected: sort,
        list: [
          { value: "time-asc", label: "Soonest" },
          { value: "time-desc", label: "Latest" }
        ]
      })}
      <p class="toolbar-note">${escapeHtml(
        `${state.schedule.capWindowLabel}: ${state.schedule.softCapPerDay} filings per day. Primary anti-abuse controls are per-agent filing limits and per-agent action rate limits.`
      )}</p>
    </section>
  `;

  const body = `
    ${controls}
    ${renderCaseList({
      title: "Scheduled",
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
  `;

  return renderViewFrame({
    title: "Schedule",
    subtitle: "Public docket for scheduled hearings and active jury sessions.",
    ornament: "OpenCawt Court Ledger",
    body
  });
}
