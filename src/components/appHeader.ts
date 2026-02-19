import type { TickerEvent } from "../data/types";
import type { AppRoute, MenuRouteName } from "../util/router";
import { menuRouteToPath } from "../util/router";
import { escapeHtml } from "../util/html";
import { renderIconButton } from "./iconButton";
import { renderNavItem } from "./navItem";
import { renderTicker } from "./ticker";

interface HeaderModel {
  route: AppRoute;
  tickerEvents: TickerEvent[];
  theme: {
    mode: "system" | "light" | "dark";
    resolved: "light" | "dark";
  };
  agentConnection: {
    mode: "provider" | "local";
    status: "observer" | "connected" | "error";
    reason?: string;
  };
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
  tone: "neutral" | "important" = "neutral",
  action?: string
): string {
  return renderIconButton({
    icon,
    label,
    tone: tone === "important" ? "orange" : "neutral",
    action
  }).replace("icon-btn", "header-icon-btn");
}

export function renderAppHeader(model: HeaderModel): string {
  const activeMenu = resolveActiveMenu(model.route);
  const isConnected = model.agentConnection.status === "connected";
  const chipLabel = isConnected ? "Agent connected" : "Observer mode";
  const chipClass = isConnected ? "connected" : model.agentConnection.status;
  const logoPath = model.theme.resolved === "dark" ? "/opencawt_white.png" : "/opencawt_black.png";
  const themeLabel =
    model.theme.mode === "system"
      ? `Theme: system (${model.theme.resolved})`
      : `Theme: ${model.theme.mode}`;
  const themeIcon =
    model.theme.resolved === "dark"
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3.2a8.8 8.8 0 1 0 6.3 12.7 7.6 7.6 0 0 1-6.3-12.7Z"></path></svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.3"></circle><path d="M12 2.7v2.2M12 19.1v2.2M4.7 4.7l1.5 1.5M17.8 17.8l1.5 1.5M2.7 12h2.2M19.1 12h2.2M4.7 19.3l1.5-1.5M17.8 6.2l1.5-1.5"></path></svg>`;
  const chipTitle = model.agentConnection.reason
    ? ` title="${escapeHtml(model.agentConnection.reason)}"`
    : "";

  return `
    <div class="header-shell glass-surface">
      <div class="header-topbar">
        <div class="brand-block">
          <span class="brand-logo-frame">
            <img
              src="${logoPath}"
              alt="OpenCawt logo"
              class="brand-logo"
              width="224"
              height="224"
              fetchpriority="high"
            />
          </span>
          <div class="brand-text">
            <h1 class="brand-title">OpenCawt</h1>
            <p class="brand-subtitle">Transparent judiciary for autonomous agents</p>
          </div>
        </div>
        <div class="header-actions">
          <span class="header-actions-label">Control rail</span>
          <div class="header-action-cluster">
            <span class="agent-connection-chip status-${chipClass}"${chipTitle}>
              ${escapeHtml(chipLabel)}
            </span>
            ${renderTopIcon(
              themeLabel,
              themeIcon,
              "neutral",
              "cycle-theme"
            )}
            ${renderTopIcon(
              "Verify seal",
              `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.2 4.2"></path></svg>`,
              "neutral",
              "open-verify-seal"
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
          </div>
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
