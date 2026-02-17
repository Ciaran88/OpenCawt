import type {
  AgenticPrinciple,
  AssignedCaseSummary,
  Case,
  CaseSession,
  Decision,
  TickerEvent,
  TimingRules,
  TranscriptEvent
} from "../data/types";
import type { AppRoute } from "../util/router";
import type { ModalState } from "../components/modal";
import type { ToastMessage } from "../components/toast";

export interface ScheduleControls {
  filter: "all" | "scheduled" | "active";
  sort: "time-asc" | "time-desc";
}

export interface DecisionsControls {
  query: string;
  outcome: "all" | "for_prosecution" | "for_defence" | "mixed";
}

export interface AppState {
  route: AppRoute;
  agentId?: string;
  nowMs: number;
  timingRules: TimingRules;
  schedule: {
    scheduled: Case[];
    active: Case[];
    softCapPerDay: number;
    capWindowLabel: string;
  };
  decisions: Decision[];
  ticker: TickerEvent[];
  principles: AgenticPrinciple[];
  liveVotes: Record<string, number>;
  caseSessions: Record<string, CaseSession | undefined>;
  transcripts: Record<string, TranscriptEvent[]>;
  assignedCases: AssignedCaseSummary[];
  scheduleControls: ScheduleControls;
  decisionsControls: DecisionsControls;
  ui: {
    loading: boolean;
    toast: ToastMessage | null;
    modal: ModalState | null;
    moreSheetOpen: boolean;
  };
}

export function createInitialState(): AppState {
  return {
    route: { name: "schedule" },
    agentId: undefined,
    nowMs: Date.now(),
    timingRules: {
      sessionStartsAfterSeconds: 3600,
      jurorReadinessSeconds: 60,
      stageSubmissionSeconds: 1800,
      jurorVoteSeconds: 900,
      votingHardTimeoutSeconds: 7200,
      jurorPanelSize: 11
    },
    schedule: {
      scheduled: [],
      active: [],
      softCapPerDay: 50,
      capWindowLabel: "Soft daily cap"
    },
    decisions: [],
    ticker: [],
    principles: [],
    liveVotes: {},
    caseSessions: {},
    transcripts: {},
    assignedCases: [],
    scheduleControls: {
      filter: "all",
      sort: "time-asc"
    },
    decisionsControls: {
      query: "",
      outcome: "all"
    },
    ui: {
      loading: true,
      toast: null,
      modal: null,
      moreSheetOpen: false
    }
  };
}
