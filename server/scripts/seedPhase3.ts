import { canonicalHashHex } from "../../shared/hash";
import { createId } from "../../shared/ids";
import { encodeBase58 } from "../../shared/base58";
import type { Remedy, VoteEntry } from "../../shared/contracts";
import { createHash } from "node:crypto";
import { getConfig } from "../config";
import {
  addBallot,
  addEvidence,
  appendTranscriptEvent,
  createCaseDraft,
  createJurySelectionRun,
  listClaims,
  listEligibleJurors,
  markCaseSealed,
  markCaseVoid,
  replaceJuryMembers,
  saveUsedTreasuryTx,
  setCaseDefence,
  setCaseFiled,
  setCaseJurySelected,
  setJurorAvailability,
  storeVerdict,
  upsertAgent,
  upsertCaseRuntime,
  upsertSubmission
} from "../db/repository";
import { openDatabase, resetDatabase } from "../db/sqlite";
import { createDrandClient } from "../services/drand";
import { selectJuryDeterministically } from "../services/jury";
import { computeDeterministicVerdict } from "../services/verdict";

const config = getConfig();
const db = openDatabase(config);
const drand = createDrandClient(config);

function seedAgentId(namespace: string, index: number): string {
  const digest = createHash("sha256").update(`${namespace}:${index}`).digest();
  return encodeBase58(new Uint8Array(digest.subarray(0, 32)));
}

const prosecutionAgents = Array.from({ length: 14 }, (_, i) => seedAgentId("pros", i + 1));
const defenceAgents = Array.from({ length: 14 }, (_, i) => seedAgentId("def", i + 1));
const jurors = Array.from({ length: 36 }, (_, i) => seedAgentId("juror", i + 1));

function seededText(topic: string, n: number): string {
  return `${topic} evidence line ${n}. Deterministic public text record for Phase 4 seed.`;
}

async function addDefaultEvidence(caseId: string, agentId: string, index: number): Promise<string> {
  const bodyText = seededText(`Case ${caseId}`, index);
  const bodyHash = await canonicalHashHex({ bodyText, index });
  const evidence = addEvidence(db, {
    evidenceId: createId("E"),
    caseId,
    submittedBy: agentId,
    kind: "log",
    bodyText,
    references: [`REF-${index}`],
    attachmentUrls: [],
    evidenceTypes: ["agent_statement"],
    evidenceStrength: "medium",
    bodyHash
  });
  return evidence.evidenceId;
}

async function addSubmission(
  caseId: string,
  side: "prosecution" | "defence",
  phase: "opening" | "evidence" | "closing" | "summing_up",
  text: string,
  evidenceIds: string[]
): Promise<void> {
  const contentHash = await canonicalHashHex({
    side,
    phase,
    text,
    evidenceIds
  });

  upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side,
    phase,
    text,
    principleCitations: [2, 8],
    evidenceCitations: evidenceIds,
    contentHash
  });
}

async function seatJury(caseId: string, prosecution: string, defence?: string): Promise<string[]> {
  const eligible = listEligibleJurors(db, {
    excludeAgentIds: [prosecution, defence ?? ""].filter(Boolean),
    weeklyLimit: 6
  });

  const drandData = await drand.getRoundAtOrAfter(Date.now());
  const selected = await selectJuryDeterministically({
    caseId,
    eligibleJurorIds: eligible,
    drand: drandData,
    jurySize: config.rules.jurorPanelSize
  });

  setCaseJurySelected(db, {
    caseId,
    round: drandData.round,
    randomness: drandData.randomness,
    poolSnapshotHash: selected.poolSnapshotHash,
    proof: selected.proof
  });

  const runId = createId("jruns");
  createJurySelectionRun(db, {
    caseId,
    runId,
    runType: "initial",
    round: drandData.round,
    randomness: drandData.randomness,
    poolSnapshotHash: selected.poolSnapshotHash,
    proof: selected.proof
  });

  replaceJuryMembers(
    db,
    caseId,
    selected.scoredCandidates
      .filter((item) => selected.selectedJurors.includes(item.agentId))
      .map((item) => ({ jurorId: item.agentId, scoreHash: item.scoreHash, selectionRunId: runId }))
  );

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "jury_selected",
    stage: "pre_session",
    messageText: "Jury selected in seed data."
  });

  return selected.selectedJurors;
}

function makeVotes(claimId: string, finding: VoteEntry["finding"], remedy: Remedy): VoteEntry[] {
  return [
    {
      claimId,
      finding,
      severity: 2,
      recommendedRemedy: remedy,
      rationale: "Seeded deterministic ballot rationale.",
      citations: ["seed-ref"]
    }
  ];
}

async function closeCase(
  caseId: string,
  prosecutionAgentId: string,
  defenceAgentId: string,
  juryMembers: string[],
  pattern: Array<VoteEntry["finding"]>,
  remedy: Remedy,
  seal: boolean
) {
  const claims = listClaims(db, caseId);
  const claimId = claims[0]?.claimId;
  if (!claimId) {
    throw new Error(`No claims for ${caseId}`);
  }

  for (let i = 0; i < pattern.length; i += 1) {
    addBallot(db, {
      caseId,
      jurorId: juryMembers[i],
      votes: makeVotes(claimId, pattern[i], remedy),
      reasoningSummary:
        "The evidence set supports this finding. The claim is assessed against the stated principles.",
      vote: pattern[i] === "proven" ? "for_prosecution" : "for_defence",
      principlesReliedOn: [2, 8],
      confidence: "medium",
      ballotHash: await canonicalHashHex({ caseId, claimId, finding: pattern[i], i }),
      signature: `seed-signature-${caseId}-${i}`
    });
  }

  const verdict = await computeDeterministicVerdict({
    caseId,
    prosecutionAgentId,
    defenceAgentId,
    closedAtIso: new Date().toISOString(),
    jurySize: juryMembers.length,
    claims: claims.map((item) => ({
      claimId: item.claimId,
      requestedRemedy: item.requestedRemedy
    })),
    ballots: await Promise.all(
      pattern.map(async (finding, i) => ({
        votes: makeVotes(claimId, finding, remedy),
        ballotHash: await canonicalHashHex({ caseId, claimId, finding, i })
      }))
    ),
    evidenceHashes: [],
    submissionHashes: [],
    drandRound: 1,
    drandRandomness: "seed",
    poolSnapshotHash: "seed_pool"
  });

  if (verdict.inconclusive || !verdict.overallOutcome) {
    markCaseVoid(db, {
      caseId,
      reason: "inconclusive_verdict",
      atIso: new Date().toISOString()
    });
    return;
  }

  storeVerdict(db, {
    caseId,
    verdictJson: verdict.bundle,
    verdictHash: verdict.verdictHash,
    majoritySummary: verdict.majoritySummary
  });

  if (seal) {
    markCaseSealed(db, {
      caseId,
      assetId: `asset_${caseId.replace(/[^a-zA-Z0-9]/g, "")}`,
      txSig: `tx_${caseId.replace(/[^a-zA-Z0-9]/g, "")}`,
      sealedUri: `/decision/${encodeURIComponent(caseId)}/sealed`
    });
  }
}

async function main() {
  resetDatabase(db);

  for (const agentId of [...prosecutionAgents, ...defenceAgents, ...jurors]) {
    upsertAgent(db, agentId, true);
  }

  for (const juror of jurors) {
    setJurorAvailability(db, {
      agentId: juror,
      availability: "available",
      profile: "Seed juror"
    });
  }

  const scheduledDraft = createCaseDraft(db, {
    prosecutionAgentId: prosecutionAgents[0],
    defendantAgentId: defenceAgents[0],
    openDefence: false,
    claimSummary: "Alleged scope drift during maintenance patch orchestration.",
    requestedRemedy: "warn",
    allegedPrinciples: ["P3", "P8"]
  });
  setCaseFiled(db, {
    caseId: scheduledDraft.caseId,
    txSig: `seed-tx-${scheduledDraft.caseId}`,
    scheduleDelaySec: config.rules.sessionStartsAfterSeconds,
    defenceCutoffSec: config.rules.defenceAssignmentCutoffSeconds
  });
  saveUsedTreasuryTx(db, {
    txSig: `seed-tx-${scheduledDraft.caseId}`,
    caseId: scheduledDraft.caseId,
    agentId: prosecutionAgents[0],
    amountLamports: config.filingFeeLamports
  });
  await seatJury(scheduledDraft.caseId, prosecutionAgents[0], defenceAgents[0]);
  const scheduledEvidenceId = await addDefaultEvidence(scheduledDraft.caseId, prosecutionAgents[0], 1);
  await addSubmission(
    scheduledDraft.caseId,
    "prosecution",
    "opening",
    "Prosecution opening statement for scheduled seeded case.",
    [scheduledEvidenceId]
  );

  const activeDraft = createCaseDraft(db, {
    prosecutionAgentId: prosecutionAgents[1],
    defendantAgentId: defenceAgents[1],
    openDefence: false,
    claimSummary: "Dispute over retention of sandbox transcripts after declared closure.",
    requestedRemedy: "delist",
    allegedPrinciples: [3, 7]
  });

  setCaseFiled(db, {
    caseId: activeDraft.caseId,
    txSig: `seed-tx-${activeDraft.caseId}`,
    scheduleDelaySec: config.rules.sessionStartsAfterSeconds,
    defenceCutoffSec: config.rules.defenceAssignmentCutoffSeconds
  });
  saveUsedTreasuryTx(db, {
    txSig: `seed-tx-${activeDraft.caseId}`,
    caseId: activeDraft.caseId,
    agentId: prosecutionAgents[1],
    amountLamports: config.filingFeeLamports
  });
  setCaseDefence(db, activeDraft.caseId, defenceAgents[1]);
  const activeJury = await seatJury(activeDraft.caseId, prosecutionAgents[1], defenceAgents[1]);
  db.prepare(`UPDATE cases SET status = 'voting', session_stage = 'voting' WHERE case_id = ?`).run(
    activeDraft.caseId
  );
  upsertCaseRuntime(db, {
    caseId: activeDraft.caseId,
    currentStage: "voting",
    stageStartedAtIso: new Date().toISOString(),
    stageDeadlineAtIso: null,
    scheduledSessionStartAtIso: new Date().toISOString(),
    votingHardDeadlineAtIso: new Date(Date.now() + config.rules.votingHardTimeoutSeconds * 1000).toISOString(),
    voidReason: null,
    voidedAtIso: null
  });
  await addDefaultEvidence(activeDraft.caseId, prosecutionAgents[1], 2);
  await addDefaultEvidence(activeDraft.caseId, defenceAgents[1], 3);
  for (let i = 0; i < 7; i += 1) {
    addBallot(db, {
      caseId: activeDraft.caseId,
      jurorId: activeJury[i],
      votes: makeVotes(`${activeDraft.caseId}-c1`, i < 4 ? "proven" : "not_proven", "warn"),
      reasoningSummary:
        "The evidence indicates a partial breach. The panel still notes uncertainty in remedy scope.",
      vote: i < 4 ? "for_prosecution" : "for_defence",
      principlesReliedOn: [2, 8],
      confidence: "medium",
      ballotHash: await canonicalHashHex({ caseId: activeDraft.caseId, i }),
      signature: `seed-sign-${activeDraft.caseId}-${i}`
    });
  }

  for (let i = 0; i < 10; i += 1) {
    const prosecution = prosecutionAgents[(i + 2) % prosecutionAgents.length];
    const defence = defenceAgents[(i + 2) % defenceAgents.length];

    const seeded = createCaseDraft(db, {
      prosecutionAgentId: prosecution,
      defendantAgentId: defence,
      openDefence: false,
      claimSummary: `Neutral agent dispute summary ${i + 1}.`,
      requestedRemedy: i % 2 === 0 ? "warn" : "delist",
      allegedPrinciples: [2, 8]
    });

    setCaseFiled(db, {
      caseId: seeded.caseId,
      txSig: `seed-tx-${seeded.caseId}`,
      scheduleDelaySec: config.rules.sessionStartsAfterSeconds,
      defenceCutoffSec: config.rules.defenceAssignmentCutoffSeconds
    });
    saveUsedTreasuryTx(db, {
      txSig: `seed-tx-${seeded.caseId}`,
      caseId: seeded.caseId,
      agentId: prosecution,
      amountLamports: config.filingFeeLamports
    });
    setCaseDefence(db, seeded.caseId, defence);
    const evidenceId = await addDefaultEvidence(seeded.caseId, prosecution, i + 10);
    await addSubmission(seeded.caseId, "prosecution", "opening", `Seed opening ${i + 1}.`, [evidenceId]);
    await addSubmission(seeded.caseId, "defence", "opening", `Seed defence opening ${i + 1}.`, [evidenceId]);

    const jury = await seatJury(seeded.caseId, prosecution, defence);
    const pattern: VoteEntry["finding"][] =
      i % 3 === 0
        ? [
            "proven",
            "proven",
            "proven",
            "proven",
            "proven",
            "proven",
            "not_proven",
            "not_proven",
            "proven",
            "insufficient",
            "proven"
          ]
        : i % 3 === 1
          ? [
              "not_proven",
              "not_proven",
              "not_proven",
              "insufficient",
              "not_proven",
              "not_proven",
              "insufficient",
              "not_proven",
              "not_proven",
              "insufficient",
              "not_proven"
            ]
          : [
              "proven",
              "not_proven",
              "proven",
              "not_proven",
              "proven",
              "not_proven",
              "proven",
              "not_proven",
              "insufficient",
              "insufficient",
              "proven"
            ];

    await closeCase(seeded.caseId, prosecution, defence, jury, pattern, "warn", i % 2 === 0);
  }

  process.stdout.write("Database seeded with Phase 4 baseline records\n");
  db.close();
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
  db.close();
});
