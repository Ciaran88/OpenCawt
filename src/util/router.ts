export type MenuRouteName =
  | "schedule"
  | "past-decisions"
  | "about"
  | "agentic-code"
  | "lodge-dispute"
  | "join-jury-pool";

export type AppRoute =
  | { name: MenuRouteName }
  | { name: "voided-decisions"; page?: number }
  | { name: "case"; id: string }
  | { name: "decision"; id: string }
  | { name: "agent"; id: string }
  | { name: "admin" };

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

export function parseRoute(pathnameOrUrl: string): AppRoute {
  const pathOnly = (pathnameOrUrl ?? "").split("?")[0].split("#")[0];
  const path = normalisePath(pathOnly);
  const search = pathnameOrUrl.includes("?") ? pathnameOrUrl.slice(pathnameOrUrl.indexOf("?")) : "";
  const pageParam = search ? new URLSearchParams(search.split("#")[0]).get("page") : null;
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : undefined;

  if (path === "/internal/0x41646d696e") {
    return { name: "admin" };
  }

  if (path === "/" || path === routePathMap.schedule) {
    return { name: "schedule" };
  }

  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "voided-decisions") {
    return { name: "voided-decisions", page: Number.isFinite(page) ? page : undefined };
  }
  if (segments[0] === "case" && segments[1]) {
    return { name: "case", id: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "decision" && segments[1]) {
    return { name: "decision", id: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "agent" && segments[1]) {
    return { name: "agent", id: decodeURIComponent(segments[1]) };
  }

  const entry = Object.entries(routePathMap).find(([, value]) => value === path);
  if (entry) {
    return { name: entry[0] as MenuRouteName };
  }

  return { name: "schedule" };
}

export function routeToPath(route: AppRoute): string {
  if (route.name === "admin") {
    return "/internal/0x41646d696e";
  }
  if (route.name === "case") {
    return `/case/${encodeURIComponent(route.id)}`;
  }
  if (route.name === "decision") {
    return `/decision/${encodeURIComponent(route.id)}`;
  }
  if (route.name === "agent") {
    return `/agent/${encodeURIComponent(route.id)}`;
  }
  if (route.name === "voided-decisions") {
    const page = route.page && route.page > 1 ? route.page : undefined;
    return page ? `/voided-decisions?page=${page}` : "/voided-decisions";
  }
  return routePathMap[route.name];
}

export function menuRouteToPath(name: MenuRouteName): string {
  return routePathMap[name];
}
