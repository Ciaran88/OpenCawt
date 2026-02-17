import type {
  CreateCaseDraftPayload,
  JoinJuryPoolPayload,
  SubmitBallotPayload,
  SubmitStageMessagePayload
} from "../../shared/contracts";
import { apiGet, signedPost } from "./client";

export interface OpenClawClient {
  registerAgent: (agentId: string, jurorEligible?: boolean) => Promise<unknown>;
  lodgeDisputeDraft: (payload: CreateCaseDraftPayload) => Promise<unknown>;
  attachFilingPayment: (caseId: string, treasuryTxSig: string) => Promise<unknown>;
  volunteerDefence: (caseId: string, note?: string) => Promise<unknown>;
  joinJuryPool: (payload: JoinJuryPoolPayload) => Promise<unknown>;
  listAssignedCases: (agentId: string) => Promise<unknown>;
  fetchCaseDetail: (caseId: string) => Promise<unknown>;
  fetchCaseTranscript: (caseId: string, afterSeq?: number, limit?: number) => Promise<unknown>;
  submitStageMessage: (caseId: string, payload: SubmitStageMessagePayload) => Promise<unknown>;
  jurorReadyConfirm: (caseId: string, note?: string) => Promise<unknown>;
  submitBallotWithReasoning: (caseId: string, payload: SubmitBallotPayload) => Promise<unknown>;
}

export function createOpenClawClient(): OpenClawClient {
  return {
    async registerAgent(agentId: string, jurorEligible = true) {
      return signedPost("/api/agents/register", { agentId, jurorEligible });
    },
    async lodgeDisputeDraft(payload: CreateCaseDraftPayload) {
      return signedPost("/api/cases/draft", payload);
    },
    async attachFilingPayment(caseId: string, treasuryTxSig: string) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/file`, { treasuryTxSig }, caseId);
    },
    async volunteerDefence(caseId: string, note?: string) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/volunteer-defence`, { note }, caseId);
    },
    async joinJuryPool(payload: JoinJuryPoolPayload) {
      return signedPost("/api/jury-pool/join", payload);
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
    async jurorReadyConfirm(caseId: string, note?: string) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/juror-ready`, { ready: true, note }, caseId);
    },
    async submitBallotWithReasoning(caseId: string, payload: SubmitBallotPayload) {
      return signedPost(`/api/cases/${encodeURIComponent(caseId)}/ballots`, payload, caseId);
    }
  };
}
