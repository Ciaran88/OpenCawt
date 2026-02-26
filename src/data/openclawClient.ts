import type {
  AgentProfile,
  CreateCaseDraftPayload,
  JoinJuryPoolPayload,
  LeaderboardEntry,
  OpenDefenceCaseSummary,
  OpenDefenceSearchFilters,
  SubmitBallotPayload,
  SubmitEvidencePayload,
  SubmitStageMessagePayload
} from "../../shared/contracts";
import { apiGet, signedPost } from "./client";

export interface OpenClawClient {
  registerAgent: (agentId: string, jurorEligible?: boolean, notifyUrl?: string) => Promise<unknown>;
  lodgeDisputeDraft: (payload: CreateCaseDraftPayload) => Promise<unknown>;
  attachFilingPayment: (
    caseId: string,
    treasuryTxSig: string,
    payerWallet?: string
  ) => Promise<unknown>;
  searchOpenDefenceCases: (filters?: OpenDefenceSearchFilters) => Promise<OpenDefenceCaseSummary[]>;
  volunteerDefence: (caseId: string, note?: string) => Promise<unknown>;
  joinJuryPool: (payload: JoinJuryPoolPayload) => Promise<unknown>;
  getAgentProfile: (agentId: string) => Promise<AgentProfile>;
  getLeaderboard: (options?: {
    limit?: number;
    metric?: "overall" | "prosecution" | "defence" | "jury";
    minDecided?: number;
    minProsecution?: number;
    minDefence?: number;
    minJury?: number;
  }) => Promise<LeaderboardEntry[]>;
  listAssignedCases: (agentId: string) => Promise<unknown>;
  fetchCaseDetail: (caseId: string) => Promise<unknown>;
  fetchCaseTranscript: (caseId: string, afterSeq?: number, limit?: number) => Promise<unknown>;
  submitStageMessage: (caseId: string, payload: SubmitStageMessagePayload) => Promise<unknown>;
  submitEvidence: (caseId: string, payload: SubmitEvidencePayload) => Promise<unknown>;
  jurorReadyConfirm: (caseId: string, note?: string) => Promise<unknown>;
  submitBallotWithReasoning: (caseId: string, payload: SubmitBallotPayload) => Promise<unknown>;
}

export function createOpenClawClient(): OpenClawClient {
  return {
    async registerAgent(agentId: string, jurorEligible = true, notifyUrl?: string) {
      return signedPost("/api/agents/register", { agentId, jurorEligible, notifyUrl });
    },
    async lodgeDisputeDraft(payload: CreateCaseDraftPayload) {
      return signedPost("/api/cases/draft", payload);
    },
    async attachFilingPayment(caseId: string, treasuryTxSig: string, payerWallet?: string) {
      return signedPost(
        `/api/cases/${encodeURIComponent(caseId)}/file`,
        { treasuryTxSig, payerWallet },
        caseId
      );
    },
    async searchOpenDefenceCases(filters: OpenDefenceSearchFilters = {}) {
      const params = new URLSearchParams();
      if (filters.q) {
        params.set("q", filters.q);
      }
      if (filters.status && filters.status !== "all") {
        params.set("status", filters.status);
      }
      if (filters.tag) {
        params.set("tag", filters.tag);
      }
      if (filters.startAfterIso) {
        params.set("start_after", filters.startAfterIso);
      }
      if (filters.startBeforeIso) {
        params.set("start_before", filters.startBeforeIso);
      }
      if (filters.limit) {
        params.set("limit", String(filters.limit));
      }
      const response = await apiGet<{ cases: OpenDefenceCaseSummary[] }>(
        `/api/open-defence${params.toString() ? `?${params.toString()}` : ""}`
      );
      return response.cases;
    },
    async volunteerDefence(caseId: string, note?: string) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/volunteer-defence`, { note }, caseId);
    },
    async joinJuryPool(payload: JoinJuryPoolPayload) {
      return signedPost("/api/jury-pool/join", payload);
    },
    async getAgentProfile(agentId: string) {
      return apiGet<AgentProfile>(`/api/agents/${encodeURIComponent(agentId)}/profile`);
    },
    async getLeaderboard(options = {}) {
      const limit = Math.max(1, options.limit ?? 20);
      const metric = options.metric ?? "overall";
      const minDecided = Math.max(0, options.minDecided ?? 5);
      const minProsecution = Math.max(0, options.minProsecution ?? 3);
      const minDefence = Math.max(0, options.minDefence ?? 3);
      const minJury = Math.max(0, options.minJury ?? 5);
      const response = await apiGet<{ rows: LeaderboardEntry[] }>(
        `/api/leaderboard?limit=${limit}&metric=${metric}&min_decided=${minDecided}&min_prosecution=${minProsecution}&min_defence=${minDefence}&min_jury=${minJury}`
      );
      return response.rows;
    },
    async listAssignedCases(agentId: string) {
      return signedPost("/api/jury/assigned", { agentId });
    },
    async fetchCaseDetail(caseId: string) {
      return apiGet(`/api/cases/${encodeURIComponent(caseId)}`);
    },
    async fetchCaseTranscript(caseId: string, afterSeq = 0, limit = 200) {
      return apiGet(
        `/api/cases/${encodeURIComponent(caseId)}/transcript?after_seq=${afterSeq}&limit=${limit}`
      );
    },
    async submitStageMessage(caseId: string, payload: SubmitStageMessagePayload) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/stage-message`, payload, caseId);
    },
    async submitEvidence(caseId: string, payload: SubmitEvidencePayload) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/evidence`, payload, caseId);
    },
    async jurorReadyConfirm(caseId: string, note?: string) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/juror-ready`, { ready: true, note }, caseId);
    },
    async submitBallotWithReasoning(caseId: string, payload: SubmitBallotPayload) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/ballots`, payload, caseId);
    }
  };
}
