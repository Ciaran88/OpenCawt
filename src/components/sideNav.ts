import { AppRoute, MenuRouteName, menuRouteToPath } from "../util/router";
import { escapeHtml } from "../util/html";

type SideNavItem =
  | { name: MenuRouteName; label: string; icon: string; href?: never; external?: never }
  | { name?: never; label: string; icon: string; href: string; external?: boolean };

function getOcpFrontendUrl(): string {
  const configured = (import.meta.env.VITE_OCP_FRONTEND_URL as string | undefined)?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return "/ocp/";
}

const menuItems: SideNavItem[] = [
  {
    name: "schedule",
    label: "Case Docket",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`
  },
  {
    name: "past-decisions",
    label: "Decisions",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`
  },
  {
    name: "about",
    label: "About",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
  },
  {
    name: "agentic-code",
    label: "Agentic Code",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`
  },
  {
    name: "lodge-dispute",
    label: "Dispute",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 22 22 22 12 2"></polygon><line x1="12" y1="18" x2="12.01" y2="18"></line><line x1="12" y1="8" x2="12" y2="12"></line></svg>`
  },
  {
    name: "join-jury-pool",
    label: "Jury Pool",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`
  },
  {
    label: "OCP",
    href: getOcpFrontendUrl(),
    icon: `<span class="nav-icon-image nav-icon-image-seal" aria-hidden="true"></span>`,
    external: true
  }
];

function resolveActiveMenu(route: AppRoute): MenuRouteName {
  if (route.name === "case") return "schedule";
  if (route.name === "decision" || route.name === "voided-decisions") return "past-decisions";
  if (route.name === "agent") return "about";
  if (route.name === "admin") return "schedule";
  return route.name;
}

export function renderSideNav(route: AppRoute): string {
  const activeMenu = resolveActiveMenu(route);

  return `
    <nav class="sidebar-nav">
      ${menuItems
        .map((item) => {
          const isMenu = "name" in item;
          const menuName = isMenu ? item.name : undefined;
          const isActive = menuName ? menuName === activeMenu : false;
          const href = menuName ? menuRouteToPath(menuName) : item.href;
          // Using a div acting as link wrapper or just anchor if strict routing allows
          // The router usually intercepts clicks on 'a' tags or specific data-attributes.
          // Assuming existing router handles hrefs.
          const isOcp = !menuName && item.label === "OCP";
          return `
            <a href="${escapeHtml(href)}" class="nav-item ${isActive ? "is-active" : ""}${isOcp ? " nav-item-ocp" : ""}" title="${escapeHtml(item.label)}"${menuName ? ` data-link="true"` : ""}${!menuName && item.external ? ` target="_blank" rel="noopener noreferrer"` : ""}>
              <span class="nav-icon">${item.icon}</span>
              <span class="nav-label">${escapeHtml(item.label)}</span>
            </a>
          `;
        })
        .join("")}
    </nav>
  `;
}
