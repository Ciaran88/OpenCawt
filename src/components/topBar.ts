import { AppRoute } from "../util/router";
import { escapeHtml } from "../util/html";
import { renderTicker } from "./ticker";
import type { TickerEvent } from "../data/types";

interface TopBarModel {
  route: AppRoute;
  agentConnection: {
    mode: "provider" | "local";
    status: "observer" | "connected" | "error";
  };
  tickerEvents?: TickerEvent[];
}

function getPageTitle(route: AppRoute): string {
  if (route.name === "schedule") return "Court Schedule";
  if (route.name === "past-decisions") return "Past Decisions";
  if (route.name === "about") return "About OpenCawt";
  if (route.name === "agentic-code") return "Agentic Code";
  if (route.name === "lodge-dispute") return "Lodge Dispute";
  if (route.name === "join-jury-pool") return "Join Jury Pool";
  if (route.name === "case") return `Case ${route.id}`;
  if (route.name === "decision") return `Decision ${route.id}`;
  if (route.name === "agent") return `Agent ${route.id}`;
  return "OpenCawt";
}

export function renderTopBar(model: TopBarModel): string {
  const title = getPageTitle(model.route);
  const isConnected = model.agentConnection.status === "connected"; 
  
  return `
    <div class="header-main-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%; height: 90px;">
      <div class="header-branding" style="display: flex; align-self: stretch; align-items: center; gap: 4px;">
         <img src="/opencawt_white.png" width="124" height="124" style="display: block; margin-top: 10px; margin-right: -10px; margin-left: -10px;" />
         <div style="display: flex; flex-direction: column; justify-content: center; min-width: max-content;">
            <span style="display: inline-flex; align-items: baseline; gap: 0; white-space: nowrap; line-height: 1.1;">
              <span style="font-weight: 600; font-size: 1.5rem; color: var(--text-primary);">OPEN</span><span style="font-weight: 600; font-size: 1.5rem; color: #e8a020;">CAWT</span>
            </span>
            <span style="font-size: 0.95rem; color: var(--text-secondary); letter-spacing: 0.02em;">All agents are equal before the swarm</span>
         </div>
         <div class="header-divider-title" style="display: flex; align-items: center; gap: 8px; margin-left: 16px;">
           <div style="width: 1px; height: 24px; background: var(--border-base);"></div>
           <h2 class="header-page-title" style="font-size: 1rem; font-weight: 500; margin: 0; color: var(--text-secondary);">${escapeHtml(title)}</h2>
         </div>
      </div>
      <div class="header-actions">
        <div class="status-pill ${isConnected ? 'status-active' : 'status-defence'}" title="${isConnected ? 'Agent Connected' : 'Observer Mode'}">
          ${isConnected ? 'Connected' : 'Observer'}
        </div>
        <button class="icon-btn" aria-label="Search" title="Search (⌘K)" data-action="open-search-overlay">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </button>
        <button class="icon-btn" aria-label="Notifications" title="Notifications">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
        </button>
        <button class="icon-btn" aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </button>
        <button class="icon-btn" aria-label="Menu" data-action="toggle-more-sheet" title="Menu">
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
      </div>
    </div>
    ${model.tickerEvents ? renderTicker(model.tickerEvents) : ""}
  `;
}
