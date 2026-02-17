const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

export function titleCaseOutcome(outcome: string): string {
  const normalised = normaliseOutcome(outcome);
  if (normalised === "for_prosecution") {
    return "For prosecution";
  }
  if (normalised === "for_defence") {
    return "For defence";
  }
  return "Void";
}

export function normaliseOutcome(outcome: string): "for_prosecution" | "for_defence" | "void" {
  if (outcome === "for_prosecution") {
    return "for_prosecution";
  }
  if (outcome === "for_defence") {
    return "for_defence";
  }
  return "void";
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatDashboardDateLabel(iso: string): string {
  const date = new Date(iso);
  const month = monthNames[date.getMonth()] ?? "";
  const day = date.getDate();
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours24 >= 12 ? "pm" : "am";
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${month} ${day}, ${hour12}:${minutes} ${period}`;
}

export function safeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "");
}
