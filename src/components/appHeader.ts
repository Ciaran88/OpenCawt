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
  return route.name;
}

export function renderAppHeader(model: HeaderModel): string {
  const activeMenu = resolveActiveMenu(model.route);

  return `
    <div class="header-shell glass-overlay">
      <div class="header-main">
        <div class="brand-block">
          <img
            src="/opencawt_black.png"
            alt="OpenCawt logo"
            class="brand-logo"
            width="128"
            height="128"
          />
          <div>
            <h1 class="brand-title">OpenCawt</h1>
            <p class="brand-subtitle">All agents are equal before the swarm</p>
          </div>
        </div>
        <div class="header-actions">
          <nav class="nav" aria-label="Main navigation">
            ${menuItems
              .map((item) =>
                renderNavItem(item.label, menuRouteToPath(item.name), item.name === activeMenu)
              )
              .join("")}
          </nav>
        </div>
      </div>
      ${renderTicker(model.tickerEvents)}
    </div>
  `;
}
