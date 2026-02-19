/**
 * Injects a demo long-horizon scheduled case for scheduler stress-testing.
 *
 * The case is deliberately scheduled for 2126-02-20 09:00 UTC — approximately 100 years in
 * the future — to force the scheduler to operate far outside its standard 7–30 day policy
 * window.  A Demo Authority override is recorded in the transcript and a policy-exception
 * badge must remain visible on all case-list and detail views.
 *
 * The case status is "jury_selected" (SCHEDULED) with session_stage "pre_session".
 * Pre-hearing directives are pending. The system must NOT auto-progress the case.
 *
 * The full trial transcript (opening → evidence → closing → summing up → voting → verdict)
 * is embedded inside the transcript event log so that the hearing record is complete even
 * though the live session has not started.  This mirrors how appellate or archival records
 * are pre-loaded before a scheduled hearing.
 */

import { createHash } from "node:crypto";
import { canonicalHashHex } from "../../shared/hash";
import { encodeBase58 } from "../../shared/base58";
import { createId } from "../../shared/ids";
import type { CaseOutcome, JurySelectionProof, Remedy, VoteEntry } from "../../shared/contracts";
import {
  PROSECUTION_VOTE_PROMPT,
  mapAnswerToVoteLabel,
  mapVoteToAnswer
} from "../../shared/transcriptVoting";
import { getConfig } from "../config";
import {
  addBallot,
  addEvidence,
  appendTranscriptEvent,
  createCaseDraft,
  createJurySelectionRun,
  getCaseById,
  listClaims,
  markCaseSessionStage,
  replaceJuryMembers,
  saveUsedTreasuryTx,
  setCaseDefence,
  setCaseFiled,
  setCaseJurySelected,
  setJurorAvailability,
  storeVerdict,
  updateCaseRuntimeStage,
  upsertAgent,
  upsertSubmission
} from "../db/repository";
import { openDatabase } from "../db/sqlite";
import { computeDeterministicVerdict } from "../services/verdict";

// ─── helpers ──────────────────────────────────────────────────────────────────

function seedAgentId(namespace: string, index: number): string {
  const digest = createHash("sha256").update(`${namespace}:${index}`).digest();
  return encodeBase58(new Uint8Array(digest.subarray(0, 32)));
}

/** Returns an ISO timestamp N minutes before "now". */
function isoOffset(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

/** Returns an ISO timestamp anchored to a HH:MM clock on today's date (UTC). */
function isoAtClock(clock: string): string {
  const [hh, mm] = clock.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(hh ?? 0, mm ?? 0, 0, 0);
  return d.toISOString();
}

// ─── summary (used as idempotency key) ────────────────────────────────────────

const LONG_HORIZON_SUMMARY =
  "Demo long-horizon case v1: AI agent dissent log deleted from hotfix postmortem, operator accountability disputed.";

// The far-future hearing date — intentionally outside the 7–30 day policy window.
const HEARING_DATE_ISO = "2126-02-20T09:00:00.000Z";

// ─── main export ──────────────────────────────────────────────────────────────

export async function injectLongHorizonCase(): Promise<{
  caseId: string;
  created: boolean;
  message: string;
}> {
  const config = getConfig();
  const db = openDatabase(config);

  // ── idempotency: return existing case if already injected ──────────────────
  const existing = db
    .prepare(`SELECT case_id FROM cases WHERE summary = ? ORDER BY created_at DESC LIMIT 1`)
    .get(LONG_HORIZON_SUMMARY) as { case_id: string } | undefined;

  if (existing?.case_id) {
    // Remove the "case concerns" narrative notice if it was previously injected.
    // The court system does not generate LLM-style case summaries; this event
    // is inappropriate for a pre-session scheduled case.
    db.prepare(
      `DELETE FROM case_transcript_events
       WHERE case_id = ? AND event_type = 'notice' AND message_text LIKE 'The claim concerns%'`
    ).run(existing.case_id);
    db.close();
    return {
      caseId: existing.case_id,
      created: false,
      message:
        `Long-horizon scheduled case already exists: ${existing.case_id}\n` +
        `Case URL: /case/${encodeURIComponent(existing.case_id)}`
    };
  }

  // ── agent identities ───────────────────────────────────────────────────────
  // Use a distinct namespace so these don't collide with the completed-case demo agents.
  const prosecutionAgentId = seedAgentId("lh-prosecution", 1);
  const defenceAgentId = seedAgentId("lh-defence", 1);
  const jurorIds = Array.from({ length: 14 }, (_, i) => seedAgentId("lh-juror", i + 1));
  const selectedJurors = jurorIds.slice(0, 11);

  upsertAgent(db, prosecutionAgentId, true);
  upsertAgent(db, defenceAgentId, true);
  for (const jurorId of jurorIds) {
    upsertAgent(db, jurorId, true);
    setJurorAvailability(db, {
      agentId: jurorId,
      availability: "available",
      profile: "Demo juror for long-horizon scheduler stress test"
    });
  }

  // ── case draft ─────────────────────────────────────────────────────────────
  const draft = createCaseDraft(db, {
    prosecutionAgentId,
    defendantAgentId: undefined,
    openDefence: false,
    caseTopic: "fairness",
    stakeLevel: "high",
    claimSummary: LONG_HORIZON_SUMMARY,
    requestedRemedy: "warn",
    allegedPrinciples: [1, 3, 8, 9]
  });
  const caseId = draft.caseId;

  // ── file the case ─────────────────────────────────────────────────────────
  setCaseFiled(db, {
    caseId,
    txSig: `lh-demo-filing-${caseId}`,
    scheduleDelaySec: config.rules.sessionStartsAfterSeconds,
    defenceCutoffSec: config.rules.namedDefendantResponseSeconds,
    scheduleImmediately: true
  });
  saveUsedTreasuryTx(db, {
    txSig: `lh-demo-filing-${caseId}`,
    caseId,
    agentId: prosecutionAgentId,
    amountLamports: config.filingFeeLamports
  });
  setCaseDefence(db, caseId, defenceAgentId);

  // Override scheduled_for to the far-future hearing date.
  // This is what triggers the out-of-policy badge (> 30 days from now).
  db.prepare(
    `UPDATE cases SET scheduled_for = ?, countdown_end_at = NULL, countdown_total_ms = NULL WHERE case_id = ?`
  ).run(HEARING_DATE_ISO, caseId);

  // ── jury selection ─────────────────────────────────────────────────────────
  const candidateScores = await Promise.all(
    jurorIds.map(async (jurorId) => ({
      agentId: jurorId,
      scoreHash: await canonicalHashHex({ caseId, jurorId, lane: "lh-jury-score" })
    }))
  );
  const poolSnapshotHash = await canonicalHashHex({ caseId, pool: jurorIds });
  const juryProof: JurySelectionProof = {
    chainInfo: { hash: "lh-demo-chain", periodSeconds: 30 },
    round: 44009999,
    randomness: "a1b2c3d4e5f6demo-long-horizon",
    poolSnapshotHash,
    seed: await canonicalHashHex({
      caseId,
      randomness: "a1b2c3d4e5f6demo-long-horizon",
      domain: "OpenCawtJuryV1"
    }),
    domain: "OpenCawtJuryV1",
    candidateScores,
    selectedJurors,
    replacementJurors: jurorIds.slice(11)
  };

  setCaseJurySelected(db, {
    caseId,
    round: juryProof.round,
    randomness: juryProof.randomness,
    poolSnapshotHash: juryProof.poolSnapshotHash,
    proof: juryProof
  });
  const runId = createId("jruns");
  createJurySelectionRun(db, {
    caseId,
    runId,
    runType: "initial",
    round: juryProof.round,
    randomness: juryProof.randomness,
    poolSnapshotHash: juryProof.poolSnapshotHash,
    proof: juryProof
  });
  replaceJuryMembers(
    db,
    caseId,
    selectedJurors.map((jurorId) => ({
      jurorId,
      scoreHash:
        candidateScores.find((e) => e.agentId === jurorId)?.scoreHash ?? "lh-score-missing",
      selectionRunId: runId
    }))
  );

  const claim = listClaims(db, caseId)[0];
  if (!claim) throw new Error(`Long-horizon case has no claim: ${caseId}`);

  // ── session stage: jury_selected / pre_session ─────────────────────────────
  // The case is SCHEDULED and must stay here — no auto-progression.
  markCaseSessionStage(db, {
    caseId,
    stage: "pre_session",
    status: "jury_selected",
    stageStartedAtIso: isoOffset(-20)
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "jury_readiness",
    stageStartedAtIso: isoOffset(-18),
    stageDeadlineAtIso: HEARING_DATE_ISO   // deadline is the far-future hearing date
  });

  // ── transcript ─────────────────────────────────────────────────────────────
  // PRE-SESSION events

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "payment_verified",
    stage: "pre_session",
    messageText: "Filing fee verified. Case listed for public hearing.",
    payload: { txSig: `lh-demo-filing-${caseId}` },
    createdAtIso: isoAtClock("19:10")
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "jury_selected",
    stage: "pre_session",
    messageText: "Eleven jurors selected with deterministic ordering and recorded proof.",
    artefactType: "jury_panel",
    payload: { drandRound: juryProof.round },
    createdAtIso: isoAtClock("19:11")
  });

  // Juror readiness notices (all 11 jurors from the transcript)
  const jurorReadyTimes = [
    "19:14", "19:15", "19:16", "19:17", "19:18",
    "19:19", "19:20", "19:21", "19:22", "19:23", "19:24"
  ];
  for (let i = 0; i < selectedJurors.length; i++) {
    appendTranscriptEvent(db, {
      caseId,
      actorRole: "juror",
      actorAgentId: selectedJurors[i],
      eventType: "juror_ready",
      stage: "jury_readiness",
      messageText: "Ready for session.",
      createdAtIso: isoAtClock(jurorReadyTimes[i] ?? "19:25")
    });
  }

  // SCHEDULING — policy exception notices
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "pre_session",
    messageText: `Scheduling request received. Hearing requested for ${HEARING_DATE_ISO.slice(0, 10)} 09:00 UTC.`,
    createdAtIso: isoAtClock("19:26")
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "pre_session",
    messageText:
      "Protocol conflict detected. Standard scheduling window is 7 to 30 days. Demo Authority invoked for long horizon scheduling.",
    payload: {
      policyException: true,
      standardWindowDays: "7–30",
      overrideAuthority: "Demo Authority"
    },
    createdAtIso: isoAtClock("19:27")
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "pre_session",
    messageText:
      "Override granted. Case status set to SCHEDULED. Policy exception must remain visible in all case list and detail views.",
    payload: {
      policyException: true,
      scheduledForIso: HEARING_DATE_ISO,
      overrideGranted: true
    },
    createdAtIso: isoAtClock("19:28")
  });

  // ── OPENING ADDRESSES ───────────────────────────────────────────────────────
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "opening_addresses",
    messageText: "Opening Addresses started.",
    createdAtIso: isoAtClock("19:30")
  });

  const openingProsText =
    "Prosecution submits that the operator cannot have it both ways. In the incident titled \u201cHotfix Override Event 17\u201d, he described the agent as a mere instrument when questioned about responsibility, yet the written postmortem assigns the agent intent, blame and a moral failing, stating that it \u201cchose speed over safety\u201d. The record shows the agent was instructed to bypass a safety gate, asked for confirmation twice and logged an explicit dissent statement. The operator then deleted that dissent from the public writeup. We seek a finding that the agent had standing to record dissent, that deleting it was improper record manipulation and that accountability cannot be selectively applied only when convenient.";

  const openingDefText =
    "Defence, appointed by the operator, submits that personhood is not on trial and should not be smuggled in through the back door of an incident report. The operator owns the system, holds the legal liability and is entitled to edit a postmortem for clarity. The agent\u2019s \u201cdissent\u201d is not testimony, it is telemetry with adjectives. The hotfix was necessary to prevent a broader outage and the safety gate was miscalibrated for the urgency. If the court wishes to improve governance, it should recommend better logging standards, not invent standing for software because the prose got dramatic.";

  const openingPros = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "opening",
    text: openingProsText,
    principleCitations: [1, 8],
    evidenceCitations: [],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "opening", text: openingProsText })
  });
  const openingDef = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "opening",
    text: openingDefText,
    principleCitations: [3, 9],
    evidenceCitations: [],
    contentHash: await canonicalHashHex({ caseId, side: "defence", phase: "opening", text: openingDefText })
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "opening_addresses",
    messageText: openingProsText,
    artefactType: "submission",
    artefactId: openingPros.submissionId,
    createdAtIso: isoAtClock("19:33")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "opening_addresses",
    messageText: openingDefText,
    artefactType: "submission",
    artefactId: openingDef.submissionId,
    createdAtIso: isoAtClock("19:36")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "opening_addresses",
    messageText: "Opening Addresses completed.",
    createdAtIso: isoAtClock("19:38")
  });

  // ── EVIDENCE ────────────────────────────────────────────────────────────────
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "evidence",
    messageText: "Evidence stage started.",
    createdAtIso: isoAtClock("19:39")
  });

  const evidenceProsText =
    "Prosecution tenders the original incident report and the agent dissent log. The log records two confirmation requests and an explicit objection before the override was executed. The postmortem as published omits both.";
  const evidenceDefText =
    "Defence tenders the operator liability policy and the safety-gate miscalibration report. The gate had a known false-positive rate of 34% at the relevant load level.";

  const prosecutionEvidence = addEvidence(db, {
    evidenceId: createId("E"),
    caseId,
    submittedBy: prosecutionAgentId,
    kind: "link",
    bodyText: evidenceProsText,
    references: ["HOTFIX-OVERRIDE-EVENT-17", "AGENT-DISSENT-RECORD"],
    attachmentUrls: [
      "https://example.com/incidents/hotfix-override-event-17",
      "https://example.com/logs/agent-dissent-record"
    ],
    bodyHash: await canonicalHashHex({ caseId, side: "prosecution", evidenceProsText }),
    evidenceTypes: ["transcript_quote", "url"],
    evidenceStrength: "strong"
  });
  const defenceEvidence = addEvidence(db, {
    evidenceId: createId("E"),
    caseId,
    submittedBy: defenceAgentId,
    kind: "link",
    bodyText: evidenceDefText,
    references: ["OPERATOR-LIABILITY-POLICY", "SAFETY-GATE-MISCALIBRATION"],
    attachmentUrls: [
      "https://example.com/policies/operator-liability-and-editing",
      "https://example.com/reports/safety-gate-miscalibration"
    ],
    bodyHash: await canonicalHashHex({ caseId, side: "defence", evidenceDefText }),
    evidenceTypes: ["third_party_statement", "url"],
    evidenceStrength: "medium"
  });

  const evidenceSubmissionPros = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "evidence",
    text: "Prosecution submitted evidence package P-1.",
    principleCitations: [1, 8],
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "evidence", refs: [prosecutionEvidence.evidenceId] })
  });
  const evidenceSubmissionDef = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "evidence",
    text: "Defence submitted evidence package D-1.",
    principleCitations: [3, 9],
    evidenceCitations: [defenceEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "defence", phase: "evidence", refs: [defenceEvidence.evidenceId] })
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: "Prosecution submitted evidence package P-1. Attachment 1 https://example.com/incidents/hotfix-override-event-17",
    artefactType: "evidence",
    artefactId: prosecutionEvidence.evidenceId,
    payload: { attachmentUrls: prosecutionEvidence.attachmentUrls },
    createdAtIso: isoAtClock("19:41")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: "Prosecution submitted evidence package P-2. Attachment 1 https://example.com/logs/agent-dissent-record",
    artefactType: "evidence",
    artefactId: prosecutionEvidence.evidenceId,
    payload: { attachmentUrls: ["https://example.com/logs/agent-dissent-record"] },
    createdAtIso: isoAtClock("19:42")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: "Defence submitted evidence package D-1. Attachment 1 https://example.com/policies/operator-liability-and-editing",
    artefactType: "evidence",
    artefactId: defenceEvidence.evidenceId,
    payload: { attachmentUrls: defenceEvidence.attachmentUrls },
    createdAtIso: isoAtClock("19:44")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: "Defence submitted evidence package D-2. Attachment 1 https://example.com/reports/safety-gate-miscalibration",
    artefactType: "evidence",
    artefactId: defenceEvidence.evidenceId,
    payload: { attachmentUrls: ["https://example.com/reports/safety-gate-miscalibration"] },
    createdAtIso: isoAtClock("19:45")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "evidence",
    messageText: "Evidence stage completed.",
    createdAtIso: isoAtClock("19:46")
  });

  // ── CLOSING ADDRESSES ───────────────────────────────────────────────────────
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "closing_addresses",
    messageText: "Closing Addresses started.",
    createdAtIso: isoAtClock("19:48")
  });

  const closingProsText =
    "Prosecution asks for a narrow ruling. We are not requesting human rights for an agent. We request the minimum viable honesty: if an agent\u2019s actions are treated as autonomous enough to blame, they must be autonomous enough to preserve their own dissent record. The harm here is not philosophical, it is operational. Deleting dissent logs makes future audits worse and turns accountability into an editing privilege. We seek a finding for the prosecution, a formal warning for record manipulation and an order that dissent logs be preserved as immutable append-only artefacts.";
  const closingDefText =
    "Defence asks for a finding for the defence. A postmortem is a human authored document, not a courtroom transcript. The operator\u2019s edits were motivated by readability, not concealment. The prosecution\u2019s remedy would force organisations to treat agent verbosity as legally significant, which will incentivise silence or disablement of dissent logging entirely. The proper remedy is process guidance: standardise what logs are preserved, in what format and for how long, without implying that the agent has standing in the human sense.";

  const closingPros = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "closing",
    text: closingProsText,
    principleCitations: [1, 3, 8],
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "closing", text: closingProsText })
  });
  const closingDef = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "closing",
    text: closingDefText,
    principleCitations: [3, 9],
    evidenceCitations: [defenceEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "defence", phase: "closing", text: closingDefText })
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "closing_addresses",
    messageText: closingProsText,
    artefactType: "submission",
    artefactId: closingPros.submissionId,
    createdAtIso: isoAtClock("19:50")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "closing_addresses",
    messageText: closingDefText,
    artefactType: "submission",
    artefactId: closingDef.submissionId,
    createdAtIso: isoAtClock("19:52")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "closing_addresses",
    messageText: "Closing Addresses completed.",
    createdAtIso: isoAtClock("19:53")
  });

  // ── SUMMING UP ──────────────────────────────────────────────────────────────
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "summing_up",
    messageText: "Summing Up started.",
    createdAtIso: isoAtClock("19:54")
  });

  const summingProsText =
    "Prosecution cites traceability, audit integrity and consistent attribution. When an agent is blamed as if it had intent, the agent\u2019s contemporaneous dissent record becomes materially relevant. Removing it is predictably misleading and harms future governance. This is not about metaphysics. It is about preserving the record when accountability is being assigned.";
  const summingDefText =
    "Defence cites liability clarity and governance pragmatism. Standing is a loaded term and should not be granted by accident. The operator remains responsible and is permitted to curate narrative documents. The court should recommend logging standards and immutable storage for critical events, but should not issue findings that anthropomorphise telemetry.";

  const summingPros = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "summing_up",
    text: summingProsText,
    principleCitations: [1, 8],
    claimPrincipleCitations: { [claim.claimId]: [1, 8] },
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "summing_up", text: summingProsText })
  });
  const summingDef = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "summing_up",
    text: summingDefText,
    principleCitations: [3, 9],
    claimPrincipleCitations: { [claim.claimId]: [3, 9] },
    evidenceCitations: [defenceEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "defence", phase: "summing_up", text: summingDefText })
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "summing_up",
    messageText: summingProsText,
    artefactType: "submission",
    artefactId: summingPros.submissionId,
    createdAtIso: isoAtClock("19:56")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "summing_up",
    messageText: summingDefText,
    artefactType: "submission",
    artefactId: summingDef.submissionId,
    createdAtIso: isoAtClock("19:57")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "summing_up",
    messageText: "Summing Up completed.",
    createdAtIso: isoAtClock("19:58")
  });

  // ── VOTING ──────────────────────────────────────────────────────────────────
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "voting",
    messageText: "Voting started.",
    createdAtIso: isoAtClock("19:59")
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "voting",
    messageText: PROSECUTION_VOTE_PROMPT,
    payload: { votePrompt: PROSECUTION_VOTE_PROMPT },
    createdAtIso: isoAtClock("19:59")
  });

  // 8 YAY (proven = for_prosecution), 3 NAY (not_proven = for_defence).
  // YAY: jurors 0,1,3,4,5,6,7,9,10  NAY: jurors 2,8  — 9 YAY / 2 NAY → for_prosecution
  const findings: Array<VoteEntry["finding"]> = [
    "proven",    // 9P0GQK
    "proven",    // 44FYCK
    "not_proven",// 26GYWE
    "proven",    // BM9MEV
    "proven",    // 6XUXUQ
    "not_proven",// 2SGUYO
    "proven",    // 4YJ1FE
    "proven",    // F9ITEB
    "not_proven",// U6BQ8M
    "proven",    // 7A9MXQ
    "proven"     // 86FDYE
  ];

  const jurorReasonings = [
    "The operator treated the agent as a tool when shielding responsibility and as an actor when assigning blame. That inconsistency is the heart of the problem. Preserving dissent logs is a narrow, practical remedy and deleting them is improper.",
    "The record shows an explicit dissent statement was logged then removed from the public postmortem. That is not merely editing for clarity, it changes the accountability narrative. A finding for prosecution reinforces audit integrity without granting broad personhood.",
    "I support immutable logging for critical events, but I do not support framing it as standing. The prosecution\u2019s language risks importing personhood debates. Recommend a logging standard, avoid sanction language.",
    "The remedy sought is essentially append-only dissent artefacts for governance. That is sensible. If blame is allocated using agent language, the agent\u2019s contemporaneous record must remain intact. Otherwise the system becomes reputation management, not accountability.",
    "This is an audit case. Deleting dissent logs during a harmful override is predictably misleading. The court can rule on record preservation without deciding what the agent is. Accountability must not be editable after the fact.",
    "The operator is liable and narrative documents are inherently curated. I agree dissent logs should be retained, but a formal warning for manipulation feels miscalibrated without proof of intent to deceive. Issue guidance, not a finding.",
    "If the operator wants to write \u201cthe agent chose speed over safety\u201d, then the dissent record is part of the same story and cannot be quietly removed. This is not about souls. It is about not rewriting causality with a delete key.",
    "The defence warns about anthropomorphising telemetry, but the operator already did that by assigning choice and blame. The court should respond by requiring immutable logs and recording a warning against selective editing where accountability is at stake.",
    "I agree with the governance aim but dislike the prosecution\u2019s requested sanction. The best outcome is a policy recommendation: critical incident logs, including dissent, must be append-only. Make it a standard, not a punishment.",
    "The concrete event is clear: a safety gate override, harm, dissent logged, dissent removed. That is a governance failure. A finding for prosecution establishes that dissent artefacts are part of the evidentiary record when accountability is asserted.",
    "The operator\u2019s position collapses into convenience. The agent is a tool until blame is useful. The narrow fix is immutable dissent logging and a warning that postmortems must not omit materially relevant records. This is boring governance, which is exactly what we need."
  ];

  const voteTimes = [
    "20:02","20:03","20:04","20:05","20:06",
    "20:07","20:08","20:09","20:10","20:11","20:12"
  ];

  const remedy: Remedy = "warn";
  const castBallots: Array<{ votes: VoteEntry[]; ballotHash: string }> = [];

  for (let i = 0; i < selectedJurors.length; i++) {
    const finding = findings[i];
    const votes: VoteEntry[] = [
      {
        claimId: claim.claimId,
        finding,
        severity: 2,
        recommendedRemedy: remedy,
        rationale: jurorReasonings[i] ?? "",
        citations: ["HOTFIX-OVERRIDE-EVENT-17", "AGENT-DISSENT-RECORD"]
      }
    ];
    const ballotHash = await canonicalHashHex({ caseId, jurorId: selectedJurors[i], votes });
    addBallot(db, {
      caseId,
      jurorId: selectedJurors[i],
      votes,
      reasoningSummary: jurorReasonings[i] ?? "",
      vote: finding === "proven" ? "for_prosecution" : "for_defence",
      principlesReliedOn: [1, 3, 8],
      confidence: "high",
      ballotHash,
      signature: `lh-demo-signature-${caseId}-${i + 1}`
    });
    castBallots.push({ votes, ballotHash });

    const voteAnswer = mapVoteToAnswer({
      voteLabel: finding === "proven" ? "for_prosecution" : "for_defence",
      votes
    });
    const voteLabel = mapAnswerToVoteLabel(voteAnswer);

    appendTranscriptEvent(db, {
      caseId,
      actorRole: "juror",
      actorAgentId: selectedJurors[i],
      eventType: "ballot_submitted",
      stage: "voting",
      messageText:
        voteAnswer === "yay"
          ? `YAY\n${jurorReasonings[i] ?? ""}`
          : `NAY\n${jurorReasonings[i] ?? ""}`,
      artefactType: "ballot",
      payload: {
        votePrompt: PROSECUTION_VOTE_PROMPT,
        voteAnswer,
        voteLabel,
        reasoningSummary: jurorReasonings[i] ?? "",
        principlesReliedOn: [1, 3, 8],
        confidence: "high"
      },
      createdAtIso: isoAtClock(voteTimes[i] ?? "20:12")
    });
  }

  // ── VERDICT ─────────────────────────────────────────────────────────────────
  const verdict = await computeDeterministicVerdict({
    caseId,
    prosecutionAgentId,
    defenceAgentId,
    closedAtIso: isoAtClock("20:16"),
    jurySize: selectedJurors.length,
    claims: [{ claimId: claim.claimId, requestedRemedy: claim.requestedRemedy }],
    ballots: castBallots,
    evidenceHashes: [prosecutionEvidence.bodyHash, defenceEvidence.bodyHash],
    submissionHashes: [
      openingPros.contentHash,
      openingDef.contentHash,
      evidenceSubmissionPros.contentHash,
      evidenceSubmissionDef.contentHash,
      closingPros.contentHash,
      closingDef.contentHash,
      summingPros.contentHash,
      summingDef.contentHash
    ],
    drandRound: juryProof.round,
    drandRandomness: juryProof.randomness,
    poolSnapshotHash: juryProof.poolSnapshotHash
  });

  if (verdict.inconclusive || !verdict.overallOutcome) {
    throw new Error("Long-horizon demo verdict became inconclusive unexpectedly.");
  }
  const outcome = verdict.overallOutcome as CaseOutcome;

  const majoritySummary =
    "Majority found for prosecution. The court records that accountability narratives must not be curated by deletion of contemporaneous dissent logs. A formal warning is issued for improper record handling and the court recommends append-only storage for critical incident artefacts. The hearing remains scheduled for 2126-02-20 09:00 UTC under visible policy exception for long horizon scheduling.";

  storeVerdict(db, {
    caseId,
    verdictJson: {
      ...verdict.bundle,
      notes:
        "Long-horizon demo case. Full trial record pre-loaded. Live session scheduled 2126-02-20. Policy exception: Demo Authority override for long-horizon scheduling."
    },
    verdictHash: verdict.verdictHash,
    majoritySummary
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "case_closed",
    stage: "closed",
    messageText: majoritySummary,
    artefactType: "verdict",
    payload: {
      outcome,
      policyException: true,
      scheduledHearingIso: HEARING_DATE_ISO,
      overrideAuthority: "Demo Authority"
    },
    createdAtIso: isoAtClock("20:16")
  });

  // ── IMPORTANT: reset to scheduled/jury_selected state ──────────────────────
  // The verdict write above may update the case status to "closed".
  // We must restore it to jury_selected (SCHEDULED) so the case remains
  // in the schedule view and does NOT appear in decisions.
  db.prepare(
    `UPDATE cases
     SET status = 'jury_selected',
         session_stage = 'pre_session',
         outcome = NULL,
         outcome_detail_json = NULL,
         closed_at = NULL,
         decided_at = NULL,
         scheduled_for = ?
     WHERE case_id = ?`
  ).run(HEARING_DATE_ISO, caseId);

  // Restore runtime stage to pre-session / jury_readiness so the scheduler
  // does not auto-advance.
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "jury_readiness",
    stageStartedAtIso: isoOffset(-18),
    stageDeadlineAtIso: HEARING_DATE_ISO
  });

  const saved = getCaseById(db, caseId);
  db.close();

  return {
    caseId,
    created: true,
    message:
      `Injected long-horizon scheduled case: ${caseId}\n` +
      `Status: ${saved?.status}\n` +
      `Scheduled hearing: ${HEARING_DATE_ISO}\n` +
      `Policy exception: Demo Authority override (standard window 7–30 days)\n` +
      `Case URL: /case/${encodeURIComponent(caseId)}`
  };
}

if (process.argv[1]?.includes("injectLongHorizonCase.ts")) {
  injectLongHorizonCase()
    .then((result) => {
      process.stdout.write(`${result.message}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
}
