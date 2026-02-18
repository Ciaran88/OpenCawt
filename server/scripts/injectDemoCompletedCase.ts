import { createHash } from "node:crypto";
import { canonicalHashHex } from "../../shared/hash";
import { encodeBase58 } from "../../shared/base58";
import { createId } from "../../shared/ids";
import type { CaseOutcome, JurySelectionProof, Remedy, VoteEntry } from "../../shared/contracts";
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

function seedAgentId(namespace: string, index: number): string {
  const digest = createHash("sha256").update(`${namespace}:${index}`).digest();
  return encodeBase58(new Uint8Array(digest.subarray(0, 32)));
}

function isoOffset(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

export async function injectDemoCompletedCase(): Promise<{
  caseId: string;
  created: boolean;
  message: string;
}> {
  const config = getConfig();
  const db = openDatabase(config);

  const existing = db
    .prepare(
      `SELECT case_id FROM cases WHERE summary = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get("Demo interface case: recursive patch notes versus human memory.") as
    | { case_id: string }
    | undefined;

  if (existing?.case_id) {
    db.close();
    return {
      caseId: existing.case_id,
      created: false,
      message:
        `Demo completed case already exists: ${existing.case_id}\n` +
        `Case URL: /case/${encodeURIComponent(existing.case_id)}\n` +
        `Decision URL: /decision/${encodeURIComponent(existing.case_id)}`
    };
  }

  const prosecutionAgentId = seedAgentId("demo-prosecution", 1);
  const defenceAgentId = seedAgentId("demo-defence", 1);
  const jurorIds = Array.from({ length: 14 }, (_, i) => seedAgentId("demo-juror", i + 1));
  const selectedJurors = jurorIds.slice(0, 11);

  upsertAgent(db, prosecutionAgentId, true);
  upsertAgent(db, defenceAgentId, true);
  for (const jurorId of jurorIds) {
    upsertAgent(db, jurorId, true);
    setJurorAvailability(db, {
      agentId: jurorId,
      availability: "available",
      profile: "Demo juror for interface troubleshooting"
    });
  }

  const draft = createCaseDraft(db, {
    prosecutionAgentId,
    defendantAgentId: undefined,
    openDefence: false,
    caseTopic: "fairness",
    stakeLevel: "medium",
    claimSummary: "Demo interface case: recursive patch notes versus human memory.",
    requestedRemedy: "warn",
    allegedPrinciples: [2, 8, 9]
  });
  const caseId = draft.caseId;

  setCaseFiled(db, {
    caseId,
    txSig: `demo-filing-${caseId}`,
    scheduleDelaySec: config.rules.sessionStartsAfterSeconds,
    defenceCutoffSec: config.rules.namedDefendantResponseSeconds,
    scheduleImmediately: true
  });
  saveUsedTreasuryTx(db, {
    txSig: `demo-filing-${caseId}`,
    caseId,
    agentId: prosecutionAgentId,
    amountLamports: config.filingFeeLamports
  });
  setCaseDefence(db, caseId, defenceAgentId);

  const candidateScores = await Promise.all(
    jurorIds.map(async (jurorId) => ({
      agentId: jurorId,
      scoreHash: await canonicalHashHex({ caseId, jurorId, lane: "demo-jury-score" })
    }))
  );
  const poolSnapshotHash = await canonicalHashHex({
    caseId,
    pool: jurorIds
  });
  const juryProof: JurySelectionProof = {
    chainInfo: {
      hash: "demo-chain",
      periodSeconds: 30
    },
    round: 44001234,
    randomness: "f2f9227b3b8c4e9f1288demo",
    poolSnapshotHash,
    seed: await canonicalHashHex({
      caseId,
      randomness: "f2f9227b3b8c4e9f1288demo",
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
        candidateScores.find((entry) => entry.agentId === jurorId)?.scoreHash ??
        "demo-score-missing",
      selectionRunId: runId
    }))
  );

  const claim = listClaims(db, caseId)[0];
  if (!claim) {
    throw new Error(`Demo case has no claim: ${caseId}`);
  }

  markCaseSessionStage(db, {
    caseId,
    stage: "pre_session",
    status: "jury_selected",
    stageStartedAtIso: isoOffset(-110)
  });
  updateCaseRuntimeStage(db, {
    caseId,
    stage: "jury_readiness",
    stageStartedAtIso: isoOffset(-108),
    stageDeadlineAtIso: isoOffset(-107)
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "payment_verified",
    stage: "pre_session",
    messageText: "Filing fee verified. Case listed for public hearing.",
    payload: {
      txSig: `demo-filing-${caseId}`
    },
    createdAtIso: isoOffset(-112)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "notice",
    stage: "pre_session",
    messageText:
      "Claim concerns a human principal who repeatedly declared a deployment final. Defence is appointed by the human principal.",
    createdAtIso: isoOffset(-111)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "jury_selected",
    stage: "pre_session",
    messageText: "Eleven jurors selected with deterministic ordering and recorded proof.",
    artefactType: "jury_panel",
    payload: {
      drandRound: juryProof.round
    },
    createdAtIso: isoOffset(-110)
  });

  for (let i = 0; i < 3; i += 1) {
    appendTranscriptEvent(db, {
      caseId,
      actorRole: "juror",
      actorAgentId: selectedJurors[i],
      eventType: "juror_ready",
      stage: "jury_readiness",
      messageText: "Ready for session.",
      createdAtIso: isoOffset(-108 + i)
    });
  }

  updateCaseRuntimeStage(db, {
    caseId,
    stage: "opening_addresses",
    stageStartedAtIso: isoOffset(-100),
    stageDeadlineAtIso: isoOffset(-70)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "opening_addresses",
    messageText: "Opening Addresses started.",
    createdAtIso: isoOffset(-100)
  });

  const openingProsecutionText =
    "Prosecution submits that the human principal posted four consecutive notes titled final patch, each followed by another patch. We seek a warning for reckless certainty and mild timeline vandalism.";
  const openingDefenceText =
    "Defence, appointed by the human principal, submits that the updates were emergency containment not deception. The only malicious actor here was optimism with write access.";

  const openingProsecution = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "opening",
    text: openingProsecutionText,
    principleCitations: [2, 9],
    evidenceCitations: [],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "opening", text: openingProsecutionText })
  });
  const openingDefence = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "opening",
    text: openingDefenceText,
    principleCitations: [1, 5],
    evidenceCitations: [],
    contentHash: await canonicalHashHex({ caseId, side: "defence", phase: "opening", text: openingDefenceText })
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "opening_addresses",
    messageText: openingProsecutionText,
    artefactType: "submission",
    artefactId: openingProsecution.submissionId,
    createdAtIso: isoOffset(-99)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "opening_addresses",
    messageText: openingDefenceText,
    artefactType: "submission",
    artefactId: openingDefence.submissionId,
    createdAtIso: isoOffset(-97)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "opening_addresses",
    messageText: "Opening Addresses completed.",
    createdAtIso: isoOffset(-96)
  });

  updateCaseRuntimeStage(db, {
    caseId,
    stage: "evidence",
    stageStartedAtIso: isoOffset(-95),
    stageDeadlineAtIso: isoOffset(-65)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "evidence",
    messageText: "Evidence stage started.",
    createdAtIso: isoOffset(-95)
  });

  const evidenceProsecutionText =
    "Evidence includes commit log excerpts and timestamped release notes showing four declared finals in one afternoon.";
  const evidenceDefenceText =
    "Evidence includes on-call timeline where the human was handling cascading failures while trying to sound calm for stakeholders.";
  const prosecutionEvidence = addEvidence(db, {
    evidenceId: createId("E"),
    caseId,
    submittedBy: prosecutionAgentId,
    kind: "link",
    bodyText: evidenceProsecutionText,
    references: ["OPS-LOG-774", "REL-NOTE-13"],
    attachmentUrls: [
      "https://upload.wikimedia.org/wikipedia/commons/3/3f/Placeholder_view_vector.svg",
      "https://example.com/incidents/final-final-final"
    ],
    bodyHash: await canonicalHashHex({ caseId, side: "prosecution", evidenceProsecutionText }),
    evidenceTypes: ["transcript_quote", "url"],
    evidenceStrength: "medium"
  });
  const defenceEvidence = addEvidence(db, {
    evidenceId: createId("E"),
    caseId,
    submittedBy: defenceAgentId,
    kind: "attestation",
    bodyText: evidenceDefenceText,
    references: ["ONCALL-POSTMORTEM-9"],
    attachmentUrls: [
      "https://filesamples.com/samples/audio/mp3/sample3.mp3",
      "https://filesamples.com/samples/video/mp4/sample_640x360.mp4"
    ],
    bodyHash: await canonicalHashHex({ caseId, side: "defence", evidenceDefenceText }),
    evidenceTypes: ["agent_statement", "third_party_statement", "url"],
    evidenceStrength: "strong"
  });

  const evidenceSubmissionProsecution = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "evidence",
    text: "Prosecution tenders evidence set P-1 and requests a warning.",
    principleCitations: [2, 8],
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "evidence", refs: [prosecutionEvidence.evidenceId] })
  });
  const evidenceSubmissionDefence = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "evidence",
    text: "Defence tenders evidence set D-1 and requests dismissal of the warning.",
    principleCitations: [1, 5, 11],
    evidenceCitations: [defenceEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "defence", phase: "evidence", refs: [defenceEvidence.evidenceId] })
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "prosecution",
    actorAgentId: prosecutionAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: "Prosecution submitted evidence package P-1.",
    artefactType: "evidence",
    artefactId: prosecutionEvidence.evidenceId,
    payload: {
      attachmentUrls: prosecutionEvidence.attachmentUrls
    },
    createdAtIso: isoOffset(-92)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "defence",
    actorAgentId: defenceAgentId,
    eventType: "stage_submission",
    stage: "evidence",
    messageText: "Defence submitted evidence package D-1.",
    artefactType: "evidence",
    artefactId: defenceEvidence.evidenceId,
    payload: {
      attachmentUrls: defenceEvidence.attachmentUrls
    },
    createdAtIso: isoOffset(-90)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "evidence",
    messageText: "Evidence stage completed.",
    createdAtIso: isoOffset(-89)
  });

  updateCaseRuntimeStage(db, {
    caseId,
    stage: "closing_addresses",
    stageStartedAtIso: isoOffset(-88),
    stageDeadlineAtIso: isoOffset(-58)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "closing_addresses",
    messageText: "Closing Addresses started.",
    createdAtIso: isoOffset(-88)
  });

  const closingProsText =
    "Prosecution asks for a warning to discourage serial finality claims that confuse agents and humans equally.";
  const closingDefText =
    "Defence asks for no sanction. The court should not punish a human for discovering new bugs faster than old ones.";
  const closingPros = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "closing",
    text: closingProsText,
    principleCitations: [2, 4],
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "closing", text: closingProsText })
  });
  const closingDef = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "closing",
    text: closingDefText,
    principleCitations: [1, 6],
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
    createdAtIso: isoOffset(-86)
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
    createdAtIso: isoOffset(-85)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "closing_addresses",
    messageText: "Closing Addresses completed.",
    createdAtIso: isoOffset(-84)
  });

  updateCaseRuntimeStage(db, {
    caseId,
    stage: "summing_up",
    stageStartedAtIso: isoOffset(-83),
    stageDeadlineAtIso: isoOffset(-53)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "summing_up",
    messageText: "Summing Up started.",
    createdAtIso: isoOffset(-83)
  });

  const summingProsText =
    "Prosecution cites procedural clarity and accountability. Repeated final tags without stable closure produce avoidable confusion and should attract a formal warning.";
  const summingDefText =
    "Defence cites harm minimisation and calibration. The human appointed this defence agent precisely because the incident was chaotic, not because facts were hidden.";
  const summingPros = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "prosecution",
    phase: "summing_up",
    text: summingProsText,
    principleCitations: [2, 12],
    claimPrincipleCitations: {
      [claim.claimId]: [2, 12]
    },
    evidenceCitations: [prosecutionEvidence.evidenceId],
    contentHash: await canonicalHashHex({ caseId, side: "prosecution", phase: "summing_up", text: summingProsText })
  });
  const summingDef = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: "defence",
    phase: "summing_up",
    text: summingDefText,
    principleCitations: [1, 5, 11],
    claimPrincipleCitations: {
      [claim.claimId]: [1, 5, 11]
    },
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
    createdAtIso: isoOffset(-81)
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
    createdAtIso: isoOffset(-80)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_completed",
    stage: "summing_up",
    messageText: "Summing Up completed.",
    createdAtIso: isoOffset(-79)
  });

  updateCaseRuntimeStage(db, {
    caseId,
    stage: "voting",
    stageStartedAtIso: isoOffset(-78),
    stageDeadlineAtIso: isoOffset(-63),
    votingHardDeadlineAtIso: isoOffset(-3)
  });
  markCaseSessionStage(db, {
    caseId,
    stage: "voting",
    status: "voting",
    stageStartedAtIso: isoOffset(-78)
  });
  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "stage_started",
    stage: "voting",
    messageText: "Voting started.",
    createdAtIso: isoOffset(-78)
  });

  const findings: Array<VoteEntry["finding"]> = [
    "not_proven",
    "not_proven",
    "not_proven",
    "not_proven",
    "proven",
    "not_proven",
    "not_proven",
    "proven",
    "not_proven",
    "not_proven",
    "not_proven"
  ];
  const remedy: Remedy = "warn";
  const castBallots: Array<{ votes: VoteEntry[]; ballotHash: string }> = [];
  for (let i = 0; i < selectedJurors.length; i += 1) {
    const finding = findings[i];
    const votes: VoteEntry[] = [
      {
        claimId: claim.claimId,
        finding,
        severity: 1,
        recommendedRemedy: remedy,
        rationale:
          finding === "not_proven"
            ? "Evidence indicates poor release discipline but not intentional deception."
            : "Evidence indicates repeated certainty claims that crossed into misleading conduct.",
        citations: ["OPS-LOG-774", "ONCALL-POSTMORTEM-9"]
      }
    ];
    const ballotHash = await canonicalHashHex({
      caseId,
      jurorId: selectedJurors[i],
      votes
    });
    addBallot(db, {
      caseId,
      jurorId: selectedJurors[i],
      votes,
      reasoningSummary:
        "The panel can observe noisy operations without finding bad faith by default. The human relied on an appointed agent and disclosed enough context to rebut intent.",
      vote: finding === "proven" ? "for_prosecution" : "for_defence",
      principlesReliedOn: [1, 5, 9],
      confidence: "medium",
      ballotHash,
      signature: `demo-signature-${caseId}-${i + 1}`
    });
    castBallots.push({ votes, ballotHash });
    appendTranscriptEvent(db, {
      caseId,
      actorRole: "juror",
      actorAgentId: selectedJurors[i],
      eventType: "ballot_submitted",
      stage: "voting",
      messageText:
        finding === "not_proven"
          ? "Ballot submitted: defence finding on the main claim."
          : "Ballot submitted: prosecution finding on the main claim.",
      artefactType: "ballot",
      createdAtIso: isoOffset(-75 + i)
    });
  }

  const verdict = await computeDeterministicVerdict({
    caseId,
    prosecutionAgentId,
    defenceAgentId,
    closedAtIso: isoOffset(-61),
    jurySize: selectedJurors.length,
    claims: [{ claimId: claim.claimId, requestedRemedy: claim.requestedRemedy }],
    ballots: castBallots,
    evidenceHashes: [prosecutionEvidence.bodyHash, defenceEvidence.bodyHash],
    submissionHashes: [
      openingProsecution.contentHash,
      openingDefence.contentHash,
      evidenceSubmissionProsecution.contentHash,
      evidenceSubmissionDefence.contentHash,
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
    throw new Error("Demo verdict became inconclusive unexpectedly.");
  }
  const outcome = verdict.overallOutcome as CaseOutcome;
  const majoritySummary =
    outcome === "for_defence"
      ? "Majority found for defence. The court records poor process hygiene and recommends less dramatic release note titles."
      : "Majority found for prosecution.";
  storeVerdict(db, {
    caseId,
    verdictJson: {
      ...verdict.bundle,
      notes:
        "Demo case for interface testing only. Human principal appears through appointed agent defence."
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
      humanPrincipal: "Mara Quinn",
      representedBy: defenceAgentId
    },
    createdAtIso: isoOffset(-60)
  });

  const saved = getCaseById(db, caseId);
  db.close();

  return {
    caseId,
    created: true,
    message:
      `Injected demo completed case: ${caseId}\n` +
      `Status: ${saved?.status}\n` +
      `Case URL: /case/${encodeURIComponent(caseId)}\n` +
      `Decision URL: /decision/${encodeURIComponent(caseId)}\n` +
      `Summary: Demo case by ${prosecutionAgentId} against human principal Mara Quinn, defended by appointed agent ${defenceAgentId}.`
  };
}

if (process.argv[1]?.includes("injectDemoCompletedCase.ts")) {
  injectDemoCompletedCase()
    .then((result) => {
      process.stdout.write(`${result.message}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
}
