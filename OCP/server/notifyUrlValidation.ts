/**
 * notifyUrl validation for agent registration.
 * Blocks internal/dangerous hostnames to prevent SSRF when dispatching notifications.
 */

/** Blocked hostname patterns (case-insensitive). */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/** Hostname substrings that indicate cloud metadata or internal services. */
const BLOCKED_HOSTNAME_SUBSTRINGS = ["metadata", ".local", ".internal"];

/**
 * Returns true if the hostname is blocked (internal, link-local, or cloud metadata).
 * Used to prevent SSRF when agents register notifyUrl.
 */
export function isBlockedNotifyUrlHost(hostname: string): boolean {
  if (!hostname || typeof hostname !== "string") return true;
  const lower = hostname.toLowerCase().trim();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;

  for (const sub of BLOCKED_HOSTNAME_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }

  // IPv4 literal
  const ipv4Match = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (link-local, cloud metadata)
    if (a === 169 && b === 254) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    return false;
  }

  // IPv6 literal (bracketed or plain)
  const ipv6 = lower.startsWith("[") ? lower.slice(1, -1) : lower;
  if (ipv6 === "::1" || ipv6 === "::" || ipv6.startsWith("fe80:") || ipv6.startsWith("fc") || ipv6.startsWith("fd")) {
    return true;
  }

  return false;
}

/**
 * Returns true if the notifyUrl is valid (protocol, hostname not blocked).
 */
export function isValidNotifyUrl(url: string, isDev: boolean): boolean {
  try {
    const parsed = new URL(url);
    if (isDev) {
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    } else {
      if (parsed.protocol !== "https:") return false;
    }
    return !isBlockedNotifyUrlHost(parsed.hostname);
  } catch {
    return false;
  }
}
