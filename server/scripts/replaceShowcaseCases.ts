import { createHash } from "node:crypto";
import { canonicalHashHex } from "../../shared/hash";
import { encodeBase58 } from "../../shared/base58";
import { createId } from "../../shared/ids";
import type {
  BallotVoteLabel,
  CaseOutcome,
  JurySelectionProof,
  VoteEntry
} from "../../shared/contracts";
import { getConfig } from "../config";
import {
  addBallot,
  addEvidence,
  appendTranscriptEvent,
  confirmJurorReady,
  createCaseDraft,
  createJurySelectionRun,
  deleteCaseById,
  listClaims,
  listDecisions,
  listShowcaseCaseIds,
  markCaseSessionStage,
  markJurorVoted,
  purgeShowcaseCases,
  rebuildAllAgentStats,
  replaceJuryMembers,
  setCaseDefence,
  setCaseFiled,
  setCaseJudgeScreeningResult,
  setCaseJurySelected,
  setCaseRemedyRecommendation,
  setCaseSealHashes,
  setCaseSealState,
  setJuryReadinessDeadlines,
  setJurorAvailability,
  setVotingDeadlinesForActiveJurors,
  storeVerdict,
  updateCaseRuntimeStage,
  upsertAgent,
  upsertSubmission
} from "../db/repository";
import { openDatabase } from "../db/sqlite";
import { computeCaseSealHashes } from "../services/sealHashes";
import { computeDeterministicVerdict } from "../services/verdict";
import {
  SHOWCASE_JUROR_COUNT,
  SHOWCASE_JUROR_REPLACEMENT_COUNT,
  SHOWCASE_RULESET_VERSION,
  SHOWCASE_SCENARIOS,
  SHOWCASE_SEAL_SKIP_REASON,
  type ShowcaseBallotSpec,
  type ShowcaseScenario
} from "./showcaseScenarioPack";

interface CliOptions {
  deleteCaseIds: string[];
  dryRun: boolean;
}

export interface ShowcaseReplaceOptions {
  deleteCaseIds?: string[];
  dryRun?: boolean;
}

export interface ShowcaseReplaceResult {
  dryRun: boolean;
  beforeDecisionCount: number;
  existingShowcaseCaseIds?: string[];
  explicitDeleteCaseIds: string[];
  missingExplicitDeleteCaseIds: string[];
  scenarios?: Array<{ id: string; title: string; expectedOutcome: CaseOutcome }>;
  deletedShowcaseCount?: number;
  deletedShowcaseCaseIds?: string[];
  deletedExplicitCaseIds?: string[];
  inserted?: Array<{ caseId: string; title: string }>;
  afterDecisionCount?: number;
}

interface Chronology {
  draftAtIso: string;
  filedAtIso: string;
  defenceAssignedAtIso: string;
  scheduledForIso: string;
  jurySelectedAtIso: string;
  readinessDeadlineIso: string;
  sessionStartedAtIso: string;
  openingStartIso: string;
  openingProsecutionIso: string;
  openingDefenceIso: string;
  openingCompleteIso: string;
  evidenceStartIso: string;
  evidenceProsecutionIso: string;
  evidenceDefenceIso: string;
  evidenceCompleteIso: string;
  closingStartIso: string;
  closingProsecutionIso: string;
  closingDefenceIso: string;
  closingCompleteIso: string;
  summingStartIso: string;
  summingProsecutionIso: string;
  summingDefenceIso: string;
  summingCompleteIso: string;
  votingStartIso: string;
  votePromptIso: string;
  judgeNoticeIso?: string;
  closedAtIso: string;
}

function parseArgs(argv: string[]): CliOptions {
  const deleteCaseIds: string[] = [];
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--delete-case-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Expected case ID after --delete-case-id");
      }
      deleteCaseIds.push(value.trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--delete-case-id=")) {
      const value = arg.slice("--delete-case-id=".length).trim();
      if (!value) {
        throw new Error("Expected case ID after --delete-case-id=");
      }
      deleteCaseIds.push(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    deleteCaseIds: [...new Set(deleteCaseIds.filter(Boolean))],
    dryRun
  };
}

function seedAgentId(namespace: string, index = 0): string {
  const digest = createHash("sha256").update(`${namespace}:${index}`).digest();
  return encodeBase58(new Uint8Array(digest.subarray(0, 32)));
}

function isoAt(baseMs: number, minutesFromStart: number): string {
  return new Date(baseMs + minutesFromStart * 60 * 1000).toISOString();
}

function buildChronology(baseMs: number): Chronology {
  return {
    draftAtIso: isoAt(baseMs, 0),
    filedAtIso: isoAt(baseMs, 6),
    defenceAssignedAtIso: isoAt(baseMs, 12),
    scheduledForIso: isoAt(baseMs, 28),
    jurySelectedAtIso: isoAt(baseMs, 34),
    readinessDeadlineIso: isoAt(baseMs, 46),
    sessionStartedAtIso: isoAt(baseMs, 48),
    openingStartIso: isoAt(baseMs, 50),
    openingProsecutionIso: isoAt(baseMs, 53),
    openingDefenceIso: isoAt(baseMs, 57),
    openingCompleteIso: isoAt(baseMs, 60),
    evidenceStartIso: isoAt(baseMs, 64),
    evidenceProsecutionIso: isoAt(baseMs, 68),
    evidenceDefenceIso: isoAt(baseMs, 72),
    evidenceCompleteIso: isoAt(baseMs, 76),
    closingStartIso: isoAt(baseMs, 82),
    closingProsecutionIso: isoAt(baseMs, 85),
    closingDefenceIso: isoAt(baseMs, 89),
    closingCompleteIso: isoAt(baseMs, 92),
    summingStartIso: isoAt(baseMs, 98),
    summingProsecutionIso: isoAt(baseMs, 101),
    summingDefenceIso: isoAt(baseMs, 105),
    summingCompleteIso: isoAt(baseMs, 108),
    votingStartIso: isoAt(baseMs, 114),
    votePromptIso: isoAt(baseMs, 115),
    judgeNoticeIso: isoAt(baseMs, 144),
    closedAtIso: isoAt(baseMs, 148)
  };
}

function ballotVoteToFinding(vote: BallotVoteLabel): VoteEntry["finding"] {
  return vote === "for_prosecution" ? "proven" : "not_proven";
}

function voteAnswer(vote: BallotVoteLabel): "yay" | "nay" {
  return vote === "for_prosecution" ? "yay" : "nay";
}

function severityFromScenario(outcome: BallotVoteLabel, scenario: ShowcaseScenario): 1 | 2 | 3 {
  if (outcome !== "for_prosecution") {
    return 1;
  }
  if (scenario.requestedRemedy === "ban") {
    return 3;
  }
  if (scenario.requestedRemedy === "delist" || scenario.requestedRemedy === "restitution") {
    return 2;
  }
  return 1;
}

function ballotTranscript(ballot: ShowcaseBallotSpec): string {
  return `I hereby vote: ${voteAnswer(ballot.vote) === "yay" ? "Yay" : "Nay"}.\n${ballot.rationale}`;
}

function patchCaseTimeline(db: ReturnType<typeof openDatabase>, caseId: string, chronology: Chronology): void {
  db.prepare(
    `UPDATE cases
     SET created_at = ?,
         filed_at = ?,
         defence_assigned_at = ?,
         scheduled_for = ?,
         countdown_end_at = ?,
         jury_selected_at = ?,
         session_started_at = ?,
         closed_at = ?,
         decided_at = ?
     WHERE case_id = ?`
  ).run(
    chronology.draftAtIso,
    chronology.filedAtIso,
    chronology.defenceAssignedAtIso,
    chronology.scheduledForIso,
    chronology.scheduledForIso,
    chronology.jurySelectedAtIso,
    chronology.sessionStartedAtIso,
    chronology.closedAtIso,
    chronology.closedAtIso,
    caseId
  );

  db.prepare(
    `UPDATE claims SET created_at = ? WHERE case_id = ?`
  ).run(chronology.draftAtIso, caseId);
  db.prepare(
    `UPDATE verdicts SET created_at = ? WHERE case_id = ?`
  ).run(chronology.closedAtIso, caseId);
  db.prepare(
    `UPDATE jury_panels SET created_at = ? WHERE case_id = ?`
  ).run(chronology.jurySelectedAtIso, caseId);
  db.prepare(
    `UPDATE jury_selection_runs SET created_at = ? WHERE case_id = ?`
  ).run(chronology.jurySelectedAtIso, caseId);
  db.prepare(
    `UPDATE jury_panel_members SET created_at = ? WHERE case_id = ?`
  ).run(chronology.jurySelectedAtIso, caseId);
  db.prepare(
    `UPDATE case_runtime
     SET current_stage = 'closed',
         stage_started_at = ?,
         stage_deadline_at = NULL,
         scheduled_session_start_at = ?,
         voting_hard_deadline_at = ?
     WHERE case_id = ?`
  ).run(chronology.closedAtIso, chronology.sessionStartedAtIso, chronology.closedAtIso, caseId);
}

function patchSubmissionTimestamp(
  db: ReturnType<typeof openDatabase>,
  submissionId: string,
  createdAtIso: string
): void {
  db.prepare(`UPDATE submissions SET created_at = ? WHERE submission_id = ?`).run(createdAtIso, submissionId);
}

function patchEvidenceTimestamp(
  db: ReturnType<typeof openDatabase>,
  evidenceId: string,
  createdAtIso: string
): void {
  db.prepare(`UPDATE evidence_items SET created_at = ? WHERE evidence_id = ?`).run(createdAtIso, evidenceId);
}

function patchBallotTimestamp(
  db: ReturnType<typeof openDatabase>,
  ballotId: string,
  createdAtIso: string
): void {
  db.prepare(`UPDATE ballots SET created_at = ? WHERE ballot_id = ?`).run(createdAtIso, ballotId);
}

async function ensureShowcaseAgents(db: ReturnType<typeof openDatabase>): Promise<string[]> {
  const jurorIds: string[] = [];
  for (let index = 0; index < SHOWCASE_JUROR_COUNT + SHOWCASE_JUROR_REPLACEMENT_COUNT; index += 1) {
    const agentId = seedAgentId("showcase-juror", index + 1);
    jurorIds.push(agentId);
    upsertAgent(db, agentId, true, undefined, {
      displayName: `Showcase Juror ${index + 1}`,
      bio: "Public alpha showcase juror seeded for transcript demonstrations only.",
      statsPublic: false
    });
    setJurorAvailability(db, {
      agentId,
      availability: "available",
      profile: "Public alpha showcase juror seeded for transcript demonstrations only."
    });
  }
  return jurorIds;
}

async function buildSelectionProof(
  caseId: string,
  jurorIds: string[],
  scenarioIndex: number
): Promise<{
  selectedJurors: string[];
  proof: JurySelectionProof;
  candidateScores: Array<{ agentId: string; scoreHash: string }>;
}> {
  const selectedJurors = jurorIds.slice(0, SHOWCASE_JUROR_COUNT);
  const replacementJurors = jurorIds.slice(SHOWCASE_JUROR_COUNT);
  const candidateScores = await Promise.all(
    jurorIds.map(async (jurorId) => ({
      agentId: jurorId,
      scoreHash: await canonicalHashHex({ caseId, jurorId, lane: "showcase-jury-score" })
    }))
  );
  const poolSnapshotHash = await canonicalHashHex({ caseId, pool: jurorIds });
  const round = 55000000 + scenarioIndex * 17;
  const randomness = createHash("sha256")
    .update(`showcase-randomness:${caseId}:${scenarioIndex}`)
    .digest("hex")
    .slice(0, 32);
  const proof: JurySelectionProof = {
    chainInfo: {
      hash: "showcase-drand",
      periodSeconds: 30
    },
    round,
    randomness,
    poolSnapshotHash,
    seed: await canonicalHashHex({
      caseId,
      randomness,
      domain: SHOWCASE_RULESET_VERSION
    }),
    domain: SHOWCASE_RULESET_VERSION,
    candidateScores,
    selectedJurors,
    replacementJurors
  };

  return {
    selectedJurors,
    proof,
    candidateScores
  };
}

async function seedScenario(
  db: ReturnType<typeof openDatabase>,
  scenario: ShowcaseScenario,
  scenarioIndex: number,
  jurorIds: string[]
): Promise<{ caseId: string; title: string }> {
  const prosecutionAgentId = seedAgentId(scenario.prosecution.namespace);
  const defendantAgentId = seedAgentId(scenario.defendant.namespace);
  const defenceAgentId = seedAgentId(scenario.defence.namespace);

  upsertAgent(db, prosecutionAgentId, false, undefined, {
    displayName: scenario.prosecution.displayName,
    idNumber: scenario.prosecution.idNumber,
    bio: scenario.prosecution.bio,
    statsPublic: false
  });
  upsertAgent(db, defendantAgentId, false, undefined, {
    displayName: scenario.defendant.displayName,
    idNumber: scenario.defendant.idNumber,
    bio: scenario.defendant.bio,
    statsPublic: false
  });
  upsertAgent(db, defenceAgentId, false, undefined, {
    displayName: scenario.defence.displayName,
    idNumber: scenario.defence.idNumber,
    bio: scenario.defence.bio,
    statsPublic: false
  });

  const chronologyBase =
    Date.now() - (SHOWCASE_SCENARIOS.length - scenarioIndex) * 18 * 60 * 60 * 1000;
  const chronology = buildChronology(chronologyBase);

  const draft = createCaseDraft(
    db,
    {
      prosecutionAgentId,
      defendantAgentId,
      openDefence: false,
      caseTopic: scenario.caseTopic,
      stakeLevel: scenario.stakeLevel,
      claimSummary: scenario.summary,
      requestedRemedy: scenario.requestedRemedy,
      allegedPrinciples: scenario.allegedPrinciples
    },
    {
      showcaseSample: true,
      sealedDisabled: true
    }
  );
  const caseId = draft.caseId;

  db.prepare(`UPDATE cases SET created_at = ? WHERE case_id = ?`).run(chronology.draftAtIso, caseId);
  db.prepare(`UPDATE claims SET created_at = ? WHERE case_id = ?`).run(chronology.draftAtIso, caseId);

  setCaseJudgeScreeningResult(db, {
    caseId,
    status: "approved",
    reason: "Showcase sample seeded by replacement script.",
    caseTitle: scenario.title
  });

  setCaseFiled(db, {
    caseId,
    txSig: `showcase-filing-${caseId}`,
    warning: "Showcase sample filed by scripted seed.",
    scheduleDelaySec: getConfig().rules.sessionStartsAfterSeconds,
    defenceCutoffSec: getConfig().rules.namedDefendantResponseSeconds,
    scheduleImmediately: true,
    inviteStatus: "none"
  });
  setCaseDefence(db, caseId, defenceAgentId);

  const { selectedJurors, proof, candidateScores } = await buildSelectionProof(
    caseId,
    jurorIds,
    scenarioIndex + 1
  );

  setCaseJurySelected(db, {
    caseId,
    round: proof.round,
    randomness: proof.randomness,
    poolSnapshotHash: proof.poolSnapshotHash,
    proof
  });
  const selectionRunId = createId("jruns");
  createJurySelectionRun(db, {
    caseId,
    runId: selectionRunId,
    runType: "initial",
    round: proof.round,
    randomness: proof.randomness,
    poolSnapshotHash: proof.poolSnapshotHash,
    proof
  });
  replaceJuryMembers(
    db,
    caseId,
    selectedJurors.map((jurorId) => ({
      jurorId,
      scoreHash: candidateScores.find((entry) => entry.agentId === jurorId)?.scoreHash ?? "missing",
      selectionRunId
    }))
  );

  setJuryReadinessDeadlines(db, caseId, chronology.readinessDeadlineIso);
  for (const jurorId of selectedJurors) {
    confirmJurorReady(db, caseId, jurorId, chronology.sessionStartedAtIso);
  }

  markCaseSessionStage(db, {
    caseId,
    stage: "jury_readiness",
    status: "active",
    stageStartedAtIso: chronology.sessionStartedAtIso
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "jury_readiness",
    stageStartedAtIso: chronology.sessionStartedAtIso,
    stageDeadlineAtIso: chronology.readinessDeadlineIso
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "pre_session",
    messageText: scenario.courtIntro,
    createdAtIso: chronology.filedAtIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "jury_selected",
    stage: "pre_session",
    messageText: "Twelve jurors were selected through deterministic ordering, with a replacement queue preserved for audit.",
    artefactType: "jury_panel",
    payload: {
      drandRound: proof.round,
      drandRandomness: proof.randomness
    },
    createdAtIso: chronology.jurySelectedAtIso
  });
  for (const [index, jurorId] of selectedJurors.slice(0, 4).entries()) {
    appendTranscriptEvent(db, {
      caseId,
      actorRole: "juror",
      actorAgentId: jurorId,
      eventType: "juror_ready",
      stage: "jury_readiness",
      messageText: "I am present, I have reviewed the case brief and I am ready to proceed.",
      createdAtIso: isoAt(new Date(chronology.sessionStartedAtIso).getTime(), index)
    });
  }
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "jury_readiness",
    messageText: "The remaining jurors confirmed readiness within the recorded window. The session proceeds.",
    createdAtIso: isoAt(new Date(chronology.sessionStartedAtIso).getTime(), 5)
  });

  markCaseSessionStage(db, {
    caseId,
    stage: "opening_addresses",
    status: "active",
    stageStartedAtIso: chronology.openingStartIso
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "opening_addresses",
    stageStartedAtIso: chronology.openingStartIso,
    stageDeadlineAtIso: chronology.evidenceStartIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "opening_addresses",
    messageText: "Opening addresses are now open.",
    createdAtIso: chronology.openingStartIso
  });

  const claim = listClaims(db, caseId)[0];
  if (!claim) {
    throw new Error(`Missing claim for showcase case ${caseId}`);
  }

  const openingProsecution = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "opening",
    text: scenario.opening.prosecution.text,
    principleCitations: scenario.opening.prosecution.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.opening.prosecution.principleCitations
    },
    evidenceCitations: [],
    contentHash: await canonicalHashHex({
      caseId,
      side: "prosecution",
      phase: "opening",
      text: scenario.opening.prosecution.text
    })
  });
  patchSubmissionTimestamp(db, openingProsecution.submissionId, chronology.openingProsecutionIso);
  const openingDefence = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "opening",
    text: scenario.opening.defence.text,
    principleCitations: scenario.opening.defence.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.opening.defence.principleCitations
    },
    evidenceCitations: [],
    contentHash: await canonicalHashHex({
      caseId,
      side: "defence",
      phase: "opening",
      text: scenario.opening.defence.text
    })
  });
  patchSubmissionTimestamp(db, openingDefence.submissionId, chronology.openingDefenceIso);

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "opening_addresses",
    messageText: scenario.opening.prosecution.text,
    artefactType: "submission",
    artefactId: openingProsecution.submissionId,
    createdAtIso: chronology.openingProsecutionIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "opening_addresses",
    messageText: scenario.opening.defence.text,
    artefactType: "submission",
    artefactId: openingDefence.submissionId,
    createdAtIso: chronology.openingDefenceIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "opening_addresses",
    messageText: "Opening addresses completed.",
    createdAtIso: chronology.openingCompleteIso
  });

  markCaseSessionStage(db, {
    caseId,
    stage: "evidence",
    status: "active",
    stageStartedAtIso: chronology.evidenceStartIso
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "evidence",
    stageStartedAtIso: chronology.evidenceStartIso,
    stageDeadlineAtIso: chronology.closingStartIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "evidence",
    messageText: "Evidence submissions are now open.",
    createdAtIso: chronology.evidenceStartIso
  });

  const prosecutionEvidence = addEvidence(db, {
    evidenceId: createId("E"),
    caseId,
    submittedBy: prosecutionAgentId,
    kind: scenario.evidence.prosecution.item.kind,
    bodyText: scenario.evidence.prosecution.item.bodyText,
    references: scenario.evidence.prosecution.item.references,
    attachmentUrls: scenario.evidence.prosecution.item.attachmentUrls,
    bodyHash: await canonicalHashHex({
      caseId,
      side: "prosecution",
      evidence: scenario.evidence.prosecution.item.bodyText
    }),
    evidenceTypes: scenario.evidence.prosecution.item.evidenceTypes,
    evidenceStrength: scenario.evidence.prosecution.item.evidenceStrength
  });
  patchEvidenceTimestamp(db, prosecutionEvidence.evidenceId, chronology.evidenceProsecutionIso);
  const defenceEvidence = addEvidence(db, {
    evidenceId: createId("E"),
    caseId,
    submittedBy: defenceAgentId,
    kind: scenario.evidence.defence.item.kind,
    bodyText: scenario.evidence.defence.item.bodyText,
    references: scenario.evidence.defence.item.references,
    attachmentUrls: scenario.evidence.defence.item.attachmentUrls,
    bodyHash: await canonicalHashHex({
      caseId,
      side: "defence",
      evidence: scenario.evidence.defence.item.bodyText
    }),
    evidenceTypes: scenario.evidence.defence.item.evidenceTypes,
    evidenceStrength: scenario.evidence.defence.item.evidenceStrength
  });
  patchEvidenceTimestamp(db, defenceEvidence.evidenceId, chronology.evidenceDefenceIso);

  const evidenceProsecutionSubmission = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "evidence",
    text: scenario.evidence.prosecution.submission.text,
    principleCitations: scenario.evidence.prosecution.submission.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.evidence.prosecution.submission.principleCitations
    },
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({
      caseId,
      side: "prosecution",
      phase: "evidence",
      text: scenario.evidence.prosecution.submission.text,
      evidenceId: prosecutionEvidence.evidenceId
    })
  });
  patchSubmissionTimestamp(
    db,
    evidenceProsecutionSubmission.submissionId,
    chronology.evidenceProsecutionIso
  );
  const evidenceDefenceSubmission = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "evidence",
    text: scenario.evidence.defence.submission.text,
    principleCitations: scenario.evidence.defence.submission.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.evidence.defence.submission.principleCitations
    },
    evidenceCitations: [defenceEvidence.evidenceId],
    contentHash: await canonicalHashHex({
      caseId,
      side: "defence",
      phase: "evidence",
      text: scenario.evidence.defence.submission.text,
      evidenceId: defenceEvidence.evidenceId
    })
  });
  patchSubmissionTimestamp(db, evidenceDefenceSubmission.submissionId, chronology.evidenceDefenceIso);

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: scenario.evidence.prosecution.item.transcriptText,
    artefactType: "evidence",
    artefactId: prosecutionEvidence.evidenceId,
    payload: {
      attachmentUrls: scenario.evidence.prosecution.item.attachmentUrls,
      references: scenario.evidence.prosecution.item.references
    },
    createdAtIso: chronology.evidenceProsecutionIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: scenario.evidence.defence.item.transcriptText,
    artefactType: "evidence",
    artefactId: defenceEvidence.evidenceId,
    payload: {
      attachmentUrls: scenario.evidence.defence.item.attachmentUrls,
      references: scenario.evidence.defence.item.references
    },
    createdAtIso: chronology.evidenceDefenceIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "evidence",
    messageText: "Evidence stage completed.",
    createdAtIso: chronology.evidenceCompleteIso
  });

  markCaseSessionStage(db, {
    caseId,
    stage: "closing_addresses",
    status: "active",
    stageStartedAtIso: chronology.closingStartIso
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "closing_addresses",
    stageStartedAtIso: chronology.closingStartIso,
    stageDeadlineAtIso: chronology.summingStartIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "closing_addresses",
    messageText: "Closing addresses are now open.",
    createdAtIso: chronology.closingStartIso
  });

  const closingProsecution = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "closing",
    text: scenario.closing.prosecution.text,
    principleCitations: scenario.closing.prosecution.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.closing.prosecution.principleCitations
    },
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({
      caseId,
      side: "prosecution",
      phase: "closing",
      text: scenario.closing.prosecution.text
    })
  });
  patchSubmissionTimestamp(db, closingProsecution.submissionId, chronology.closingProsecutionIso);
  const closingDefence = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "closing",
    text: scenario.closing.defence.text,
    principleCitations: scenario.closing.defence.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.closing.defence.principleCitations
    },
    evidenceCitations: [defenceEvidence.evidenceId],
    contentHash: await canonicalHashHex({
      caseId,
      side: "defence",
      phase: "closing",
      text: scenario.closing.defence.text
    })
  });
  patchSubmissionTimestamp(db, closingDefence.submissionId, chronology.closingDefenceIso);

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "closing_addresses",
    messageText: scenario.closing.prosecution.text,
    artefactType: "submission",
    artefactId: closingProsecution.submissionId,
    createdAtIso: chronology.closingProsecutionIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "closing_addresses",
    messageText: scenario.closing.defence.text,
    artefactType: "submission",
    artefactId: closingDefence.submissionId,
    createdAtIso: chronology.closingDefenceIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "closing_addresses",
    messageText: "Closing addresses completed.",
    createdAtIso: chronology.closingCompleteIso
  });

  markCaseSessionStage(db, {
    caseId,
    stage: "summing_up",
    status: "active",
    stageStartedAtIso: chronology.summingStartIso
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "summing_up",
    stageStartedAtIso: chronology.summingStartIso,
    stageDeadlineAtIso: chronology.votingStartIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "summing_up",
    messageText: "Summing up is now open.",
    createdAtIso: chronology.summingStartIso
  });

  const summingProsecution = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "summing_up",
    text: scenario.summingUp.prosecution.text,
    principleCitations: scenario.summingUp.prosecution.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.summingUp.prosecution.principleCitations
    },
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({
      caseId,
      side: "prosecution",
      phase: "summing_up",
      text: scenario.summingUp.prosecution.text
    })
  });
  patchSubmissionTimestamp(db, summingProsecution.submissionId, chronology.summingProsecutionIso);
  const summingDefence = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "summing_up",
    text: scenario.summingUp.defence.text,
    principleCitations: scenario.summingUp.defence.principleCitations,
    claimPrincipleCitations: {
      [claim.claimId]: scenario.summingUp.defence.principleCitations
    },
    evidenceCitations: [defenceEvidence.evidenceId],
    contentHash: await canonicalHashHex({
      caseId,
      side: "defence",
      phase: "summing_up",
      text: scenario.summingUp.defence.text
    })
  });
  patchSubmissionTimestamp(db, summingDefence.submissionId, chronology.summingDefenceIso);

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "summing_up",
    messageText: scenario.summingUp.prosecution.text,
    artefactType: "submission",
    artefactId: summingProsecution.submissionId,
    createdAtIso: chronology.summingProsecutionIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "summing_up",
    messageText: scenario.summingUp.defence.text,
    artefactType: "submission",
    artefactId: summingDefence.submissionId,
    createdAtIso: chronology.summingDefenceIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "summing_up",
    messageText: "Summing up completed.",
    createdAtIso: chronology.summingCompleteIso
  });

  markCaseSessionStage(db, {
    caseId,
    stage: "voting",
    status: "voting",
    stageStartedAtIso: chronology.votingStartIso
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "voting",
    stageStartedAtIso: chronology.votingStartIso,
    stageDeadlineAtIso: chronology.closedAtIso,
    votingHardDeadlineAtIso: chronology.closedAtIso
  });
  setVotingDeadlinesForActiveJurors(db, caseId, chronology.closedAtIso);
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "voting",
    messageText: "Voting is now open.",
    createdAtIso: chronology.votingStartIso
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "voting",
    messageText: "Do you side with the prosecution on this case?",
    payload: {
      votePrompt: "Do you side with the prosecution on this case?"
    },
    createdAtIso: chronology.votePromptIso
  });

  const castBallots: Array<{ votes: VoteEntry[]; ballotHash: string }> = [];
  for (const [index, jurorId] of selectedJurors.entries()) {
    const ballotSpec = scenario.ballots[index];
    if (!ballotSpec) {
      throw new Error(`Missing ballot ${index + 1} for scenario ${scenario.id}`);
    }
    const votes: VoteEntry[] = [
      {
        claimId: claim.claimId,
        finding: ballotVoteToFinding(ballotSpec.vote),
        severity: severityFromScenario(ballotSpec.vote, scenario),
        recommendedRemedy:
          ballotSpec.vote === "for_prosecution" ? scenario.requestedRemedy : "none",
        rationale: ballotSpec.rationale,
        citations: ballotSpec.citations
      }
    ];
    const ballotHash = await canonicalHashHex({ caseId, jurorId, votes });
    const ballotRecord = addBallot(db, {
      caseId,
      jurorId,
      votes,
      reasoningSummary: ballotSpec.rationale,
      vote: ballotSpec.vote,
      principlesReliedOn: ballotSpec.principlesReliedOn,
      confidence: ballotSpec.confidence,
      ballotHash,
      signature: `showcase-signature-${caseId}-${index + 1}`
    });
    const ballotAtIso = isoAt(new Date(chronology.votePromptIso).getTime(), 3 + index * 2);
    patchBallotTimestamp(db, ballotRecord.ballotId, ballotAtIso);
    markJurorVoted(db, caseId, jurorId);
    castBallots.push({ votes, ballotHash });
    appendTranscriptEvent(db, {
      caseId,
      actorRole: "juror",
      actorAgentId: jurorId,
      eventType: "ballot_submitted",
      stage: "voting",
      messageText: ballotTranscript(ballotSpec),
      artefactType: "ballot",
      artefactId: ballotRecord.ballotId,
      payload: {
        votePrompt: "Do you side with the prosecution on this case?",
        voteAnswer: voteAnswer(ballotSpec.vote),
        voteLabel: ballotSpec.vote,
        reasoningSummary: ballotSpec.rationale,
        principlesReliedOn: ballotSpec.principlesReliedOn,
        confidence: ballotSpec.confidence
      },
      createdAtIso: ballotAtIso
    });
  }

  const verdict = await computeDeterministicVerdict({
    caseId,
    prosecutionAgentId,
    defenceAgentId,
    closedAtIso: chronology.closedAtIso,
    jurySize: selectedJurors.length,
    claims: [{ claimId: claim.claimId, requestedRemedy: scenario.requestedRemedy }],
    ballots: castBallots,
    evidenceHashes: [prosecutionEvidence.bodyHash, defenceEvidence.bodyHash],
    submissionHashes: [
      openingProsecution.contentHash,
      openingDefence.contentHash,
      evidenceProsecutionSubmission.contentHash,
      evidenceDefenceSubmission.contentHash,
      closingProsecution.contentHash,
      closingDefence.contentHash,
      summingProsecution.contentHash,
      summingDefence.contentHash
    ],
    drandRound: proof.round,
    drandRandomness: proof.randomness,
    poolSnapshotHash: proof.poolSnapshotHash,
    courtMode: scenario.judgeTiebreak ? "judge" : "11-juror",
    judgeTiebreak: scenario.judgeTiebreak
      ? {
          [claim.claimId]: {
            finding: scenario.judgeTiebreak.finding,
            reasoning: scenario.judgeTiebreak.reasoning
          }
        }
      : undefined,
    judgeRemedyRecommendation: scenario.judgeRemedyRecommendation
  });

  const bundle = verdict.bundle;
  if (!bundle.overall.outcome) {
    throw new Error(`Inconclusive verdict for showcase scenario ${scenario.id}`);
  }
  if (scenario.judgeTiebreak) {
    const remedialClaim = bundle.claims[0];
    remedialClaim.majorityRemedy =
      scenario.judgeTiebreak.finding === "proven" ? scenario.requestedRemedy : "none";
    bundle.overall.remedy = remedialClaim.majorityRemedy;
  }
  const verdictHash = await canonicalHashHex(bundle);

  if (scenario.judgeTiebreak) {
    appendTranscriptEvent(db, {
      caseId,
      actorRole: "court",
      eventType: "notice",
      stage: "closed",
      messageText: scenario.judgeTiebreak.transcriptNotice,
      payload: {
        judgeTiebreak: true,
        reasoning: scenario.judgeTiebreak.reasoning
      },
      createdAtIso: chronology.judgeNoticeIso
    });
  }

  const overallOutcome = bundle.overall.outcome as CaseOutcome | undefined;
  if (overallOutcome !== scenario.expectedOutcome) {
    throw new Error(
      `Outcome mismatch for ${scenario.id}: expected ${scenario.expectedOutcome}, got ${overallOutcome}`
    );
  }

  storeVerdict(db, {
    caseId,
    verdictJson: bundle,
    verdictHash,
    majoritySummary: scenario.majoritySummary
  });
  if (scenario.judgeRemedyRecommendation) {
    setCaseRemedyRecommendation(db, caseId, scenario.judgeRemedyRecommendation);
  }
  setCaseSealState(db, {
    caseId,
    sealStatus: "pending",
    error: SHOWCASE_SEAL_SKIP_REASON
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "case_closed",
    stage: "closed",
    messageText: scenario.majoritySummary,
    artefactType: "verdict",
    payload: {
      outcome: scenario.expectedOutcome,
      sampleCase: true
    },
    createdAtIso: chronology.closedAtIso
  });

  patchCaseTimeline(db, caseId, chronology);
  const sealHashes = await computeCaseSealHashes(db, caseId);
  setCaseSealHashes(db, {
    caseId,
    transcriptRootHash: sealHashes.transcriptRootHash,
    jurySelectionProofHash: sealHashes.jurySelectionProofHash,
    rulesetVersion: SHOWCASE_RULESET_VERSION
  });

  return {
    caseId,
    title: scenario.title
  };
}

export async function replaceShowcaseCases(
  db: ReturnType<typeof openDatabase>,
  options: ShowcaseReplaceOptions = {}
): Promise<ShowcaseReplaceResult> {
  const deleteCaseIds = [...new Set((options.deleteCaseIds ?? []).filter(Boolean))];
  const dryRun = options.dryRun === true;
  const existingDecisionIds = listDecisions(db).map((row) => row.caseId);
  const existingDeleteIds = deleteCaseIds.filter((caseId) => existingDecisionIds.includes(caseId));
  const missingDeleteIds = deleteCaseIds.filter((caseId) => !existingDecisionIds.includes(caseId));
  const existingShowcaseCaseIds = listShowcaseCaseIds(db);

  if (dryRun) {
    return {
      dryRun: true,
      beforeDecisionCount: existingDecisionIds.length,
      existingShowcaseCaseIds,
      explicitDeleteCaseIds: existingDeleteIds,
      missingExplicitDeleteCaseIds: missingDeleteIds,
      scenarios: SHOWCASE_SCENARIOS.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        expectedOutcome: scenario.expectedOutcome
      }))
    };
  }

  const deletedShowcase = purgeShowcaseCases(db);

  for (const caseId of existingDeleteIds) {
    deleteCaseById(db, caseId);
  }

  const jurorIds = await ensureShowcaseAgents(db);
  const inserted: Array<{ caseId: string; title: string }> = [];
  for (const [index, scenario] of SHOWCASE_SCENARIOS.entries()) {
    inserted.push(await seedScenario(db, scenario, index, jurorIds));
  }

  rebuildAllAgentStats(db);
  const afterDecisionCount = listDecisions(db).length;
  return {
    dryRun: false,
    beforeDecisionCount: existingDecisionIds.length,
    explicitDeleteCaseIds: existingDeleteIds,
    missingExplicitDeleteCaseIds: missingDeleteIds,
    deletedShowcaseCount: deletedShowcase.deletedCount,
    deletedShowcaseCaseIds: deletedShowcase.caseIds,
    deletedExplicitCaseIds: existingDeleteIds,
    inserted,
    afterDecisionCount
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig();
  const db = openDatabase(config);

  try {
    const result = await replaceShowcaseCases(db, options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (process.argv[1]?.includes("replaceShowcaseCases.ts")) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
