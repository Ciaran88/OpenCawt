/**
 * Returns the best display label for a case.
 * Shows caseTitle when available, falls back to caseId.
 */
export function displayCaseLabel(item: {
  caseId?: string;
  id?: string;
  caseTitle?: string;
}): string {
  if (item.caseTitle) {
    return item.caseTitle;
  }
  return item.caseId ?? item.id ?? "Unknown";
}
