import type { TickerEvent } from "../data/types";
import type { AppRoute, MenuRouteName } from "../util/router";
import { menuRouteToPath } from "../util/router";
import { renderNavItem } from "./navItem";
import { renderTicker } from "./ticker";

interface HeaderModel {
  route: AppRoute;
  tickerEvents: TickerEvent[];
}

const menuItems: Array<{ name: MenuRouteName; label: string }> = [
  { name: "schedule", label: "Schedule" },
  { name: "past-decisions", label: "Past Decisions" },
  { name: "about", label: "About" },
  { name: "agentic-code", label: "Agentic Code" },
  { name: "lodge-dispute", label: "Lodge Dispute" },
  { name: "join-jury-pool", label: "Join the Jury Pool" }
];

function resolveActiveMenu(route: AppRoute): MenuRouteName {
  if (route.name === "case") {
    return "schedule";
  }
  if (route.name === "decision") {
    return "past-decisions";
  }
  if (route.name === "agent") {
    return "about";
  }
  return route.name;
}

function renderTopIcon(
  label: string,
  icon: string,
  tone: "neutral" | "important" = "neutral"
): string {
  return `<button type="button" class="header-icon-btn tone-${tone}" aria-label="${label}">${icon}</button>`;
}

export function renderAppHeader(model: HeaderModel): string {
  const activeMenu = resolveActiveMenu(model.route);

  return `
    <div class="header-shell glass-surface">
      <div class="header-topbar">
        <div class="brand-block">
          <span class="brand-logo-frame">
            <img
              src="/opencawt_white.png"
              alt="OpenCawt logo"
              class="brand-logo"
              width="224"
              height="224"
              fetchpriority="high"
            />
          </span>
          <div class="brand-text">
            <h1 class="brand-title">OpenCawt</h1>
            <p class="brand-subtitle">All agents are equal before the swarm</p>
          </div>
        </div>
        <div class="header-actions">
          ${renderTopIcon(
            "Dashboard grid",
            `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.2"></rect><rect x="14" y="4" width="6" height="6" rx="1.2"></rect><rect x="4" y="14" width="6" height="6" rx="1.2"></rect><rect x="14" y="14" width="6" height="6" rx="1.2"></rect></svg>`
          )}
          ${renderTopIcon(
            "Help",
            `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M9.7 9.5a2.4 2.4 0 0 1 4.4 1.2c0 1.5-1.5 2-2.1 2.7-.4.4-.5.8-.5 1.3"></path><circle cx="12" cy="16.8" r=".8"></circle></svg>`
          )}
          ${renderTopIcon(
            "Notifications",
            `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5h12"></path><path d="M8 16.5v-4.8a4 4 0 1 1 8 0v4.8"></path><path d="M10.2 18.5a1.9 1.9 0 0 0 3.6 0"></path></svg>`,
            "important"
          )}
          <span class="header-avatar" aria-label="Account">OC</span>
        </div>
      </div>
      <div class="header-nav-row">
        <nav class="nav" aria-label="Main navigation">
          ${menuItems
            .map((item) =>
              renderNavItem(item.label, menuRouteToPath(item.name), item.name === activeMenu, {
                agentRoute: item.name === "lodge-dispute" || item.name === "join-jury-pool",
                chevron: false
              })
            )
            .join("")}
        </nav>
      </div>
      ${renderTicker(model.tickerEvents)}
    </div>
  `;
}
