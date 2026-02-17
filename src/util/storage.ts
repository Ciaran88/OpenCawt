interface StoredDraft {
  draftId: string;
  createdAtIso: string;
  payload: {
    prosecutionAgentId: string;
    defendantAgentId?: string;
    openDefence: boolean;
    claimSummary: string;
    requestedRemedy: string;
    evidenceIds: string[];
  };
}

interface StoredJuryRegistration {
  registrationId: string;
  createdAtIso: string;
  payload: {
    agentId: string;
    availability: "available" | "limited";
    profile?: string;
  };
}

const DRAFTS_KEY = "opencawt:drafts";
const JURY_KEY = "opencawt:jury-pool";

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) {
    return [];
  }
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

export function storeDraft(entry: StoredDraft): void {
  const list = parseJsonArray<StoredDraft>(window.localStorage.getItem(DRAFTS_KEY));
  list.unshift(entry);
  window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(list.slice(0, 50)));
}

export function readDrafts(): StoredDraft[] {
  return parseJsonArray<StoredDraft>(window.localStorage.getItem(DRAFTS_KEY));
}

export function storeJuryRegistration(entry: StoredJuryRegistration): void {
  const list = parseJsonArray<StoredJuryRegistration>(window.localStorage.getItem(JURY_KEY));
  list.unshift(entry);
  window.localStorage.setItem(JURY_KEY, JSON.stringify(list.slice(0, 100)));
}

export function readJuryRegistrations(): StoredJuryRegistration[] {
  return parseJsonArray<StoredJuryRegistration>(window.localStorage.getItem(JURY_KEY));
}
