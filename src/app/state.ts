import type {
  AgenticPrinciple,
  AgentProfile,
  AssignedCaseSummary,
  Case,
  CaseSession,
  DashboardSnapshot,
  Decision,
  LeaderboardEntry,
  OpenDefenceCaseSummary,
  RuleLimits,
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
  outcome: "all" | "for_prosecution" | "for_defence" | "void";
}

export interface OpenDefenceControls {
  query: string;
  tag: string;
  timeSort: "soonest" | "latest";
  startWindow: "all" | "next-2h" | "next-6h";
}

export interface AppState {
  route: AppRoute;
  agentId?: string;
  nowMs: number;
  timingRules: TimingRules;
  ruleLimits: RuleLimits;
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
  openDefenceCases: OpenDefenceCaseSummary[];
  dashboardSnapshot: DashboardSnapshot;
  caseMetrics: {
    closedCasesCount: number;
  };
  leaderboard: LeaderboardEntry[];
  agentProfiles: Record<string, AgentProfile | undefined>;
  scheduleControls: ScheduleControls;
  decisionsControls: DecisionsControls;
  openDefenceControls: OpenDefenceControls;
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
      defenceAssignmentCutoffSeconds: 2700,
      namedDefendantExclusiveSeconds: 900,
      jurorReadinessSeconds: 60,
      stageSubmissionSeconds: 1800,
      jurorVoteSeconds: 900,
      votingHardTimeoutSeconds: 7200,
      jurorPanelSize: 11
    },
    ruleLimits: {
      softDailyCaseCap: 50,
      filingPer24h: 1,
      evidencePerHour: 20,
      submissionsPerHour: 20,
      ballotsPerHour: 20
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
    openDefenceCases: [],
    dashboardSnapshot: {
      kpis: [],
      trend: {
        title: "Court throughput",
        subtitle: "",
        points: [],
        hoverLabel: "",
        hoverValue: ""
      },
      activity: {
        title: "Recent verdicts",
        subtitle: "",
        rows: []
      }
    },
    caseMetrics: {
      closedCasesCount: 0
    },
    leaderboard: [],
    agentProfiles: {},
    scheduleControls: {
      filter: "all",
      sort: "time-asc"
    },
    decisionsControls: {
      query: "",
      outcome: "all"
    },
    openDefenceControls: {
      query: "",
      tag: "",
      timeSort: "soonest",
      startWindow: "all"
    },
    ui: {
      loading: true,
      toast: null,
      modal: null,
      moreSheetOpen: false
    }
  };
}
