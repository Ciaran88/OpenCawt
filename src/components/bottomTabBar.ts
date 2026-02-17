import type { AppRoute, MenuRouteName } from "../util/router";
import { menuRouteToPath } from "../util/router";
import { escapeHtml } from "../util/html";

interface TabItem {
  key: "schedule" | "past-decisions" | "lodge-dispute" | "join-jury-pool" | "more";
  label: string;
  route?: MenuRouteName;
}

const tabs: TabItem[] = [
  { key: "schedule", label: "Schedule", route: "schedule" },
  { key: "past-decisions", label: "Past Decisions", route: "past-decisions" },
  { key: "lodge-dispute", label: "Lodge Dispute", route: "lodge-dispute" },
  { key: "join-jury-pool", label: "Join the Jury Pool", route: "join-jury-pool" },
  { key: "more", label: "More" }
];

function resolveActiveKey(route: AppRoute): TabItem["key"] {
  if (route.name === "case") {
    return "schedule";
  }
  if (route.name === "decision") {
    return "past-decisions";
  }
  if (route.name === "about" || route.name === "agentic-code") {
    return "more";
  }
  if (route.name === "agent") {
    return "more";
  }
  if (route.name === "schedule") {
    return "schedule";
  }
  if (route.name === "past-decisions") {
    return "past-decisions";
  }
  if (route.name === "lodge-dispute") {
    return "lodge-dispute";
  }
  return "join-jury-pool";
}

function renderIcon(key: TabItem["key"]): string {
  if (key === "schedule") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v3M18 4v3M4.5 9.5h15M6 13h3M12 13h3M6 17h6"></path><rect x="3.5" y="6.5" width="17" height="14" rx="3"></rect></svg>`;
  }
  if (key === "past-decisions") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6.5h12M6 11h12M6 15.5h8"></path><rect x="3.5" y="3.5" width="17" height="17" rx="3"></rect></svg>`;
  }
  if (key === "lodge-dispute") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"></path><rect x="3.5" y="3.5" width="17" height="17" rx="4"></rect></svg>`;
  }
  if (key === "join-jury-pool") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="2.5"></circle><circle cx="16" cy="9.5" r="2"></circle><path d="M4.5 18c.6-2.4 2.3-3.8 4.6-3.8S13 15.6 13.5 18M14 17.8c.4-1.7 1.5-2.8 3.1-2.8 1.4 0 2.3.7 2.9 2"></path></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.2"></circle><circle cx="12" cy="12" r="1.2"></circle><circle cx="18.5" cy="12" r="1.2"></circle></svg>`;
}

export function renderBottomTabBar(route: AppRoute, moreSheetOpen: boolean): string {
  const activeKey = resolveActiveKey(route);

  return `
    <div class="tabbar-shell glass-overlay">
      ${tabs
        .map((tab) => {
          const active =
            tab.key === activeKey && (tab.key !== "more" || moreSheetOpen || activeKey === "more");
          const activeClass = active ? "is-active" : "";
          const agentClass =
            tab.key === "lodge-dispute" || tab.key === "join-jury-pool" ? "is-agent-route" : "";

          if (tab.key === "more") {
            return `
              <button type="button" class="tab-item ${activeClass}" data-action="toggle-more-sheet" aria-expanded="${moreSheetOpen ? "true" : "false"}">
                <span class="tab-icon">${renderIcon(tab.key)}</span>
                <span class="tab-label">${escapeHtml(tab.label)}</span>
              </button>
            `;
          }

          const href = menuRouteToPath(tab.route as MenuRouteName);
          return `
            <a href="${escapeHtml(href)}" data-link="true" class="tab-item ${activeClass} ${agentClass}">
              <span class="tab-icon">${renderIcon(tab.key)}</span>
              <span class="tab-label">${escapeHtml(tab.label)}</span>
            </a>
          `;
        })
        .join("")}
    </div>
  `;
}
