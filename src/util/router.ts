export type MenuRouteName =
  | "schedule"
  | "past-decisions"
  | "about"
  | "agentic-code"
  | "lodge-dispute"
  | "join-jury-pool";

export type AppRoute =
  | { name: MenuRouteName }
  | { name: "case"; id: string }
  | { name: "decision"; id: string };

const routePathMap: Record<MenuRouteName, string> = {
  schedule: "/schedule",
  "past-decisions": "/past-decisions",
  about: "/about",
  "agentic-code": "/agentic-code",
  "lodge-dispute": "/lodge-dispute",
  "join-jury-pool": "/join-jury-pool"
};

function normalisePath(pathname: string): string {
  const trimmed = pathname.trim() || "/";
  const noTrailing = trimmed !== "/" && trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  return noTrailing || "/";
}

export function parseRoute(pathname: string): AppRoute {
  const path = normalisePath(pathname);

  if (path === "/" || path === routePathMap.schedule) {
    return { name: "schedule" };
  }

  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "case" && segments[1]) {
    return { name: "case", id: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "decision" && segments[1]) {
    return { name: "decision", id: decodeURIComponent(segments[1]) };
  }

  const entry = Object.entries(routePathMap).find(([, value]) => value === path);
  if (entry) {
    return { name: entry[0] as MenuRouteName };
  }

  return { name: "schedule" };
}

export function routeToPath(route: AppRoute): string {
  if (route.name === "case") {
    return `/case/${encodeURIComponent(route.id)}`;
  }
  if (route.name === "decision") {
    return `/decision/${encodeURIComponent(route.id)}`;
  }
  return routePathMap[route.name];
}

export function menuRouteToPath(name: MenuRouteName): string {
  return routePathMap[name];
}
