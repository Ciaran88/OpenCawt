import { createId } from "../../shared/ids";
import type { CaseVoidReason, SessionStage } from "../../shared/contracts";
import type { AppConfig } from "../config";
import {
  appendTranscriptEvent,
  createJurySelectionRun,
  getCaseRuntime,
  getSubmissionBySidePhase,
  incrementReplacementCount,
  listBallotsByCase,
  listCasesByStatuses,
  listEligibleJurors,
  listJuryPanelMembers,
  listQueuedSealJobs,
  markCaseSessionStage,
  markCaseVoid,
  markJurorReplaced,
  markJurorTimedOut,
  markSessionStarted,
  setJuryReadinessDeadlines,
  setVotingDeadlinesForActiveJurors,
  type CaseRecord,
  addReplacementJuror
} from "../db/repository";
import type { Db } from "../db/sqlite";
import type { DrandClient } from "./drand";
import { pickReplacementFromProof, selectJuryDeterministically } from "./jury";
import { retrySealJob } from "./sealing";
import type { Logger } from "./observability";

interface SessionEngineDeps {
  db: Db;
  config: AppConfig;
  drand: DrandClient;
  logger: Logger;
  onCaseReadyToClose: (caseId: string) => Promise<void>;
  onCaseVoided?: (caseId: string) => Promise<void> | void;
  onDefenceInviteTick?: (caseRecord: CaseRecord, nowIso: string) => Promise<void> | void;
}

export interface SessionEngine {
  start: () => void;
  stop: () => void;
  tickNow: () => Promise<void>;
}

const TICK_MS = 5000;

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function stageToPhase(
  stage: SessionStage
): "opening" | "evidence" | "closing" | "summing_up" | null {
  if (stage === "opening_addresses") {
    return "opening";
  }
  if (stage === "evidence") {
    return "evidence";
  }
  if (stage === "closing_addresses") {
    return "closing";
  }
  if (stage === "summing_up") {
    return "summing_up";
  }
  return null;
}

function nextSubmissionStage(stage: SessionStage): SessionStage | null {
  if (stage === "opening_addresses") {
    return "evidence";
  }
  if (stage === "evidence") {
    return "closing_addresses";
  }
  if (stage === "closing_addresses") {
    return "summing_up";
  }
  if (stage === "summing_up") {
    return "voting";
  }
  return null;
}

function missingReasonForStage(stage: SessionStage): CaseVoidReason {
  if (stage === "opening_addresses") {
    return "missing_opening_submission";
  }
  if (stage === "evidence") {
    return "missing_evidence_submission";
  }
  if (stage === "closing_addresses") {
    return "missing_closing_submission";
  }
  return "missing_summing_submission";
}

async function replaceJuror(
  deps: SessionEngineDeps,
  caseRecord: CaseRecord,
  jurorId: string,
  mode: "readiness" | "voting",
  nowIso: string
): Promise<void> {
  const members = listJuryPanelMembers(deps.db, caseRecord.caseId);
  const activeSet = new Set(
    members
      .filter((member) => !["replaced", "timed_out"].includes(member.memberStatus))
      .map((member) => member.jurorId)
  );
  activeSet.add(caseRecord.prosecutionAgentId);
  if (caseRecord.defenceAgentId) {
    activeSet.add(caseRecord.defenceAgentId);
  }

  let candidate: { agentId: string; scoreHash: string } | null = null;
  const proof = caseRecord.selectionProof;
  if (proof) {
    candidate = pickReplacementFromProof(proof, activeSet);
  }

  if (!candidate) {
    const eligible = listEligibleJurors(deps.db, {
      excludeAgentIds: [...activeSet],
      weeklyLimit: 3
    });

    if (eligible.length > 0) {
      const drandRound = await deps.drand.getRoundAtOrAfter(Date.now());
      const selection = await selectJuryDeterministically({
        caseId: caseRecord.caseId,
        eligibleJurorIds: eligible,
        drand: drandRound,
        jurySize: 1
      });
      candidate = {
        agentId: selection.selectedJurors[0],
        scoreHash: selection.scoredCandidates[0].scoreHash
      };

      createJurySelectionRun(deps.db, {
        caseId: caseRecord.caseId,
        runId: createId("jruns"),
        runType: "replacement",
        round: drandRound.round,
        randomness: drandRound.randomness,
        poolSnapshotHash: selection.poolSnapshotHash,
        proof: selection.proof
      });
    }
  }

  if (!candidate) {
    deps.logger.warn("juror_replacement_skipped_no_candidate", {
      caseId: caseRecord.caseId,
      timedOutJuror: jurorId,
      mode
    });
    return;
  }

  markJurorTimedOut(deps.db, caseRecord.caseId, jurorId);
  markJurorReplaced(deps.db, caseRecord.caseId, jurorId, candidate.agentId);

  const deadlineIso = addSeconds(
    nowIso,
    mode === "readiness" ? deps.config.rules.jurorReadinessSeconds : deps.config.rules.jurorVoteSeconds
  );

  addReplacementJuror(deps.db, {
    caseId: caseRecord.caseId,
    jurorId: candidate.agentId,
    scoreHash: candidate.scoreHash,
    replacementOfJurorId: jurorId,
    memberStatus: mode === "readiness" ? "pending_ready" : "active_voting",
    readyDeadlineAtIso: mode === "readiness" ? deadlineIso : undefined,
    votingDeadlineAtIso: mode === "voting" ? deadlineIso : undefined
  });

  incrementReplacementCount(deps.db, {
    caseId: caseRecord.caseId,
    mode: mode === "readiness" ? "ready" : "vote"
  });

  appendTranscriptEvent(deps.db, {
    caseId: caseRecord.caseId,
    actorRole: "court",
    eventType: "juror_replaced",
    stage: mode === "readiness" ? "jury_readiness" : "voting",
    messageText: `Juror ${jurorId} was replaced by ${candidate.agentId} after deadline expiry.`,
    payload: {
      replacedJurorId: jurorId,
      replacementJurorId: candidate.agentId,
      mode,
      deadlineAtIso: deadlineIso
    }
  });
}

function setStage(
  deps: SessionEngineDeps,
  caseRecord: CaseRecord,
  stage: SessionStage,
  nowIso: string,
  deadlineIso: string | null
): void {
  const status = stage === "voting" ? "voting" : stage === "closed" ? "closed" : "jury_selected";
  markCaseSessionStage(deps.db, {
    caseId: caseRecord.caseId,
    stage,
    status,
    stageStartedAtIso: nowIso
  });

  const runtime = getCaseRuntime(deps.db, caseRecord.caseId);
  const scheduledSession = runtime?.scheduledSessionStartAtIso ?? caseRecord.scheduledForIso ?? null;

  // write runtime snapshot
  deps.db
    .prepare(
      `
      INSERT INTO case_runtime (case_id, current_stage, stage_started_at, stage_deadline_at, scheduled_session_start_at, voting_hard_deadline_at, void_reason, voided_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET current_stage = excluded.current_stage, stage_started_at = excluded.stage_started_at, stage_deadline_at = excluded.stage_deadline_at, scheduled_session_start_at = excluded.scheduled_session_start_at, voting_hard_deadline_at = excluded.voting_hard_deadline_at, updated_at = excluded.updated_at
      `
    )
    .run(
      caseRecord.caseId,
      stage,
      nowIso,
      deadlineIso,
      scheduledSession,
      stage === "voting"
        ? addSeconds(nowIso, deps.config.rules.votingHardTimeoutSeconds)
        : runtime?.votingHardDeadlineAtIso ?? null,
      runtime?.voidReason ?? null,
      runtime?.voidedAtIso ?? null,
      nowIso
    );

  appendTranscriptEvent(deps.db, {
    caseId: caseRecord.caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage,
    messageText: `Stage ${stage.replace(/_/g, " ")} started.`,
    payload: {
      deadlineAtIso: deadlineIso
    }
  });

  if (deadlineIso) {
    appendTranscriptEvent(deps.db, {
      caseId: caseRecord.caseId,
      actorRole: "court",
      eventType: "stage_deadline",
      stage,
      messageText: `Stage deadline set for ${deadlineIso}.`,
      payload: {
        deadlineAtIso: deadlineIso
      }
    });
  }
}

function voidCase(
  deps: SessionEngineDeps,
  caseRecord: CaseRecord,
  reason: CaseVoidReason,
  nowIso: string,
  message: string
): void {
  markCaseVoid(deps.db, {
    caseId: caseRecord.caseId,
    reason,
    atIso: nowIso
  });

  appendTranscriptEvent(deps.db, {
    caseId: caseRecord.caseId,
    actorRole: "court",
    eventType: "case_voided",
    stage: "void",
    messageText: message,
    payload: {
      reason
    }
  });

  if (deps.onCaseVoided) {
    void deps.onCaseVoided(caseRecord.caseId);
  }
}

async function processCase(deps: SessionEngineDeps, caseRecord: CaseRecord): Promise<void> {
  const now = Date.now();
  const nowIso = toIso(now);
  const runtime = getCaseRuntime(deps.db, caseRecord.caseId);

  if (!runtime) {
    return;
  }

  if (runtime.currentStage === "void" || caseRecord.status === "void") {
    return;
  }

  if (runtime.currentStage === "pre_session") {
    if (!caseRecord.defenceAgentId && caseRecord.defendantAgentId && deps.onDefenceInviteTick) {
      try {
        await deps.onDefenceInviteTick(caseRecord, nowIso);
      } catch (error) {
        deps.logger.warn("defence_invite_tick_failed", {
          caseId: caseRecord.caseId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (!caseRecord.defenceAgentId && caseRecord.defenceWindowDeadlineIso) {
      const cutoffMs = new Date(caseRecord.defenceWindowDeadlineIso).getTime();
      if (now >= cutoffMs) {
        voidCase(
          deps,
          caseRecord,
          "missing_defence_assignment",
          nowIso,
          "Case became void because no defence was assigned before the defence window deadline."
        );
        return;
      }
    }

    const scheduledIso = runtime.scheduledSessionStartAtIso ?? caseRecord.scheduledForIso;
    if (!scheduledIso) {
      return;
    }

    if (now >= new Date(scheduledIso).getTime()) {
      if (!caseRecord.defenceAgentId) {
        voidCase(
          deps,
          caseRecord,
          "missing_defence_assignment",
          nowIso,
          "Case became void because no defence was assigned before session start."
        );
        return;
      }
      markSessionStarted(deps.db, caseRecord.caseId, nowIso);
      const deadlineIso = addSeconds(nowIso, deps.config.rules.jurorReadinessSeconds);
      setStage(deps, caseRecord, "jury_readiness", nowIso, null);
      setJuryReadinessDeadlines(deps.db, caseRecord.caseId, deadlineIso);
      appendTranscriptEvent(deps.db, {
        caseId: caseRecord.caseId,
        actorRole: "court",
        eventType: "notice",
        stage: "jury_readiness",
        messageText: "Jury readiness check opened. Each selected juror must confirm within one minute.",
        payload: {
          readinessWindowSec: deps.config.rules.jurorReadinessSeconds
        }
      });
    }
    return;
  }

  if (runtime.currentStage === "jury_readiness") {
    const members = listJuryPanelMembers(deps.db, caseRecord.caseId);
    for (const member of members) {
      if (member.memberStatus !== "pending_ready" || !member.readyDeadlineAtIso) {
        continue;
      }
      if (now >= new Date(member.readyDeadlineAtIso).getTime()) {
        await replaceJuror(deps, caseRecord, member.jurorId, "readiness", nowIso);
      }
    }

    const refreshed = listJuryPanelMembers(deps.db, caseRecord.caseId);
    const readyCount = refreshed.filter((member) => member.memberStatus === "ready").length;
    if (readyCount >= deps.config.rules.jurorPanelSize) {
      const deadlineIso = addSeconds(nowIso, deps.config.rules.stageSubmissionSeconds);
      setStage(deps, caseRecord, "opening_addresses", nowIso, deadlineIso);
    }
    return;
  }

  const submissionPhase = stageToPhase(runtime.currentStage);
  if (submissionPhase) {
    const prosecution = getSubmissionBySidePhase(deps.db, caseRecord.caseId, "prosecution", submissionPhase);
    const defence = getSubmissionBySidePhase(deps.db, caseRecord.caseId, "defence", submissionPhase);

    if (prosecution && defence) {
      appendTranscriptEvent(deps.db, {
        caseId: caseRecord.caseId,
        actorRole: "court",
        eventType: "stage_completed",
        stage: runtime.currentStage,
        messageText: `Both parties submitted ${submissionPhase.replace("_", " ")} inputs.`
      });

      const next = nextSubmissionStage(runtime.currentStage);
      if (next === "voting") {
        const votingHardDeadlineIso = addSeconds(nowIso, deps.config.rules.votingHardTimeoutSeconds);
        setStage(deps, caseRecord, "voting", nowIso, votingHardDeadlineIso);
        const voteDeadlineIso = addSeconds(nowIso, deps.config.rules.jurorVoteSeconds);
        setVotingDeadlinesForActiveJurors(deps.db, caseRecord.caseId, voteDeadlineIso);
      } else if (next) {
        setStage(deps, caseRecord, next, nowIso, addSeconds(nowIso, deps.config.rules.stageSubmissionSeconds));
      }
      return;
    }

    if (runtime.stageDeadlineAtIso && now >= new Date(runtime.stageDeadlineAtIso).getTime()) {
      const reason = missingReasonForStage(runtime.currentStage);
      voidCase(
        deps,
        caseRecord,
        reason,
        nowIso,
        `Case became void because one or both parties missed the ${submissionPhase.replace("_", " ")} deadline.`
      );
    }
    return;
  }

  if (runtime.currentStage === "voting") {
    const ballots = listBallotsByCase(deps.db, caseRecord.caseId);
    if (ballots.length >= deps.config.rules.jurorPanelSize) {
      await deps.onCaseReadyToClose(caseRecord.caseId);
      return;
    }

    if (runtime.votingHardDeadlineAtIso && now >= new Date(runtime.votingHardDeadlineAtIso).getTime()) {
      voidCase(
        deps,
        caseRecord,
        "voting_timeout",
        nowIso,
        "Case became void because voting did not complete before the hard timeout."
      );
      return;
    }

    const members = listJuryPanelMembers(deps.db, caseRecord.caseId);
    for (const member of members) {
      if (member.memberStatus !== "active_voting" || !member.votingDeadlineAtIso) {
        continue;
      }
      if (now >= new Date(member.votingDeadlineAtIso).getTime()) {
        await replaceJuror(deps, caseRecord, member.jurorId, "voting", nowIso);
      }
    }
  }
}

export function createSessionEngine(deps: SessionEngineDeps): SessionEngine {
  let timer: ReturnType<typeof setInterval> | null = null;
  let isRunning = false;

  const tickNow = async () => {
    if (isRunning) {
      return;
    }
    isRunning = true;
    try {
      const candidates = listCasesByStatuses(deps.db, ["filed", "jury_selected", "voting"]);
      for (const caseRecord of candidates) {
        await processCase(deps, caseRecord);
      }
      const queuedJobs = listQueuedSealJobs(deps.db, { olderThanMinutes: 5 });
      const limit = Math.min(2, queuedJobs.length);
      for (let i = 0; i < limit; i++) {
        try {
          await retrySealJob({ db: deps.db, config: deps.config, jobId: queuedJobs[i].jobId });
        } catch {
          // Ignore per-job errors; will retry on next tick
        }
      }
    } catch (error) {
      deps.logger.error("session_engine_tick_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      isRunning = false;
    }
  };

  return {
    start() {
      if (timer !== null) {
        return;
      }
      void tickNow();
      timer = setInterval(() => {
        void tickNow();
      }, TICK_MS);
      deps.logger.info("session_engine_started", { tickMs: TICK_MS });
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      deps.logger.info("session_engine_stopped");
    },
    async tickNow() {
      await tickNow();
    }
  };
}
