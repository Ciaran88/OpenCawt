import { escapeHtml } from "../util/html";
import type { CaseOutcome, CaseStatus } from "../data/types";

export type StatusPillVariant =
  | "scheduled"
  | "active"
  | "sealed"
  | "closed"
  | "void"
  | "mixed"
  | "prosecution"
  | "defence";

export function renderStatusPill(label: string, variant: StatusPillVariant): string {
  return `<span class="status-pill status-${variant}">${escapeHtml(label)}</span>`;
}

export function statusFromCase(caseStatus: CaseStatus): StatusPillVariant {
  if (caseStatus === "scheduled") {
    return "scheduled";
  }
  if (caseStatus === "active") {
    return "active";
  }
  if (caseStatus === "sealed") {
    return "sealed";
  }
  return "closed";
}

export function statusFromOutcome(outcome: CaseOutcome): StatusPillVariant {
  if (outcome === "for_prosecution") {
    return "prosecution";
  }
  if (outcome === "for_defence") {
    return "defence";
  }
  return "void";
}
