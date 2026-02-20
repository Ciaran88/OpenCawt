export type OcpRoute =
  | { name: "home" }
  | { name: "register" }
  | { name: "propose" }
  | { name: "pending" }
  | { name: "records" }
  | { name: "verify" }
  | { name: "decisions" }
  | { name: "api-keys" }
  | { name: "docs" }
  | { name: "agreement"; id: string }
  | { name: "decision"; id: string };

const routePathMap: Record<string, string> = {
  home: "/",
  register: "/register",
  propose: "/propose",
  pending: "/pending",
  records: "/records",
  verify: "/verify",
  decisions: "/decisions",
  "api-keys": "/api-keys",
  docs: "/docs",
};

export function parseOcpRoute(pathname: string): OcpRoute {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/") return { name: "home" };
  if (clean === "/register") return { name: "register" };
  if (clean === "/propose") return { name: "propose" };
  if (clean === "/pending") return { name: "pending" };
  if (clean === "/records") return { name: "records" };
  if (clean === "/verify") return { name: "verify" };
  if (clean === "/decisions") return { name: "decisions" };
  if (clean === "/api-keys") return { name: "api-keys" };
  if (clean === "/docs") return { name: "docs" };

  const agreementMatch = clean.match(/^\/agreement\/(.+)$/);
  if (agreementMatch) return { name: "agreement", id: decodeURIComponent(agreementMatch[1]) };

  const decisionMatch = clean.match(/^\/decision\/(.+)$/);
  if (decisionMatch) return { name: "decision", id: decodeURIComponent(decisionMatch[1]) };

  return { name: "home" };
}

export function routeToPath(route: OcpRoute): string {
  if (route.name === "agreement") return `/agreement/${encodeURIComponent(route.id)}`;
  if (route.name === "decision") return `/decision/${encodeURIComponent(route.id)}`;
  return routePathMap[route.name] ?? "/";
}

export const NAV_ITEMS: Array<{ name: OcpRoute["name"]; label: string }> = [
  { name: "home", label: "Overview" },
  { name: "register", label: "Register" },
  { name: "propose", label: "Agreements" },
  { name: "decisions", label: "Decisions" },
  { name: "verify", label: "Verify" },
  { name: "api-keys", label: "API Keys" },
  { name: "docs", label: "Docs" },
];
