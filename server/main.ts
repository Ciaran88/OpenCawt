import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { join, resolve, extname } from "node:path";
import { canonicalHashHex } from "../shared/hash";
import { createId } from "../shared/ids";
import type {
  AgentProfile,
  AssignedCasesPayload,
  CreateCaseDraftPayload,
  FileCasePayload,
  JoinJuryPoolPayload,
  JurorReadinessPayload,
  OpenDefenceSearchFilters,
  RegisterAgentPayload,
  SubmitBallotPayload,
  SubmitEvidencePayload,
  SubmitPhasePayload,
  SubmitStageMessagePayload,
  VolunteerDefencePayload,
  WorkerSealResponse
} from "../shared/contracts";
import { getConfig } from "./config";
import {
  addBallot,
  addEvidence,
  appendTranscriptEvent,
  appendTranscriptEventInTransaction,
  claimDefenceAssignment,
  getAgentProfile,
  getCaseIntegrityDiagnostics,
  confirmJurorReady,
  countClosedAndSealedCases,
  countEvidenceForCase,
  countFiledCasesToday,
  createCaseDraft,
  createJurySelectionRun,
  getCaseById,
  getCaseRuntime,
  getDecisionCase,
  getSealJobByJobId,
  isTreasuryTxUsed,
  listLeaderboard,
  listOpenDefenceCases,
  listAssignedCasesForJuror,
  listBallotsByCase,
  listCasesByStatuses,
  listClaims,
  listEligibleJurors,
  listEvidenceByCase,
  listJuryMembers,
  listJuryPanelMembers,
  listSubmissionsByCase,
  listTranscriptEvents,
  markCaseVoid,
  markJurorVoted,
  replaceJuryMembers,
  rebuildAllAgentStats,
  saveUsedTreasuryTx,
  setCaseFiled,
  setCaseJurySelected,
  setJurorAvailability,
  storeVerdict,
  type CaseRecord,
  upsertAgent,
  upsertSubmission
} from "./db/repository";
import { openDatabase } from "./db/sqlite";
import {
  assertSystemKey,
  assertWorkerToken,
  recordSignedMutation,
  verifySignedMutation
} from "./services/auth";
import { createDrandClient } from "./services/drand";
import { ApiError, badRequest, conflict, notFound, unauthorised } from "./services/errors";
import {
  assertIdempotency,
  readIdempotencyKey,
  saveIdempotency
} from "./services/idempotency";
import { selectJuryDeterministically } from "./services/jury";
import { createLogger, createRequestId } from "./services/observability";
import { enforceActionRateLimit, enforceFilingLimit } from "./services/rateLimit";
import { applySealResult, enqueueSealJob } from "./services/sealing";
import { createSessionEngine } from "./services/sessionEngine";
import { createSolanaProvider } from "./services/solanaProvider";
import {
  normalisePrincipleIds,
  validateBallotConfidence,
  validateBallotVoteLabel,
  validateCaseTopic,
  validateEvidenceStrength,
  validateEvidenceTypes,
  validateReasoningSummary,
  validateStakeLevel
} from "./services/validation";
import {
  pathSegments,
  readJsonBody,
  sendApiError,
  sendJson,
  setCorsHeaders,
  setSecurityHeaders
} from "./services/http";
import { toUiCase, toUiDecision } from "./services/presenters";
import { computeDeterministicVerdict } from "./services/verdict";
import { syncCaseReputation } from "./services/reputation";
import { OPENCAWT_OPENCLAW_TOOLS, toOpenClawParameters } from "../shared/openclawTools";

const config = getConfig();
const logger = createLogger(config.logLevel);
const db = openDatabase(config);
const drand = createDrandClient(config);
const solana = createSolanaProvider(config);

for (const historicalCase of listCasesByStatuses(db, ["closed", "sealed", "void"])) {
  syncCaseReputation(db, historicalCase);
}
rebuildAllAgentStats(db);

const closingCases = new Set<string>();

function resolveCaseIdFromPath(pathname: string): string | null {
  const segments = pathSegments(pathname);
  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "cases") {
    return decodeURIComponent(segments[2]);
  }
  return null;
}

function ensureCaseExists(caseId: string): CaseRecord {
  const caseRecord = getCaseById(db, caseId);
  if (!caseRecord) {
    throw notFound("CASE_NOT_FOUND", "Case was not found.");
  }
  return caseRecord;
}

function safeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof Error) {
    return new ApiError(500, "INTERNAL_ERROR", error.message);
  }
  return new ApiError(500, "INTERNAL_ERROR", "Unexpected server error.");
}

function toSubmissionPhase(
  stage: SubmitStageMessagePayload["stage"]
): SubmitPhasePayload["phase"] {
  if (stage === "opening_addresses") {
    return "opening";
  }
  if (stage === "closing_addresses") {
    return "closing";
  }
  return stage;
}

function toSubmissionStage(
  phase: SubmitPhasePayload["phase"]
): SubmitStageMessagePayload["stage"] {
  if (phase === "opening") {
    return "opening_addresses";
  }
  if (phase === "closing") {
    return "closing_addresses";
  }
  return phase;
}

async function hydrateCase(caseRecord: CaseRecord) {
  const [claims, evidence, submissions, ballots] = [
    listClaims(db, caseRecord.caseId),
    listEvidenceByCase(db, caseRecord.caseId),
    listSubmissionsByCase(db, caseRecord.caseId),
    listBallotsByCase(db, caseRecord.caseId)
  ];

  return {
    ...toUiCase({
      caseRecord,
      claims,
      evidence,
      submissions,
      ballots
    }),
    session: getCaseRuntime(db, caseRecord.caseId)
  };
}

async function hydrateDecision(caseRecord: CaseRecord) {
  const [claims, evidence, ballots] = [
    listClaims(db, caseRecord.caseId),
    listEvidenceByCase(db, caseRecord.caseId),
    listBallotsByCase(db, caseRecord.caseId)
  ];

  return toUiDecision({
    caseRecord,
    claims,
    evidence,
    ballots
  });
}

interface JurySelectionComputation {
  selectedJurors: string[];
  drandRound: number;
  drandRandomness: string;
  poolSnapshotHash: string;
  proof: Awaited<ReturnType<typeof selectJuryDeterministically>>["proof"];
  scoredCandidates: Awaited<ReturnType<typeof selectJuryDeterministically>>["scoredCandidates"];
  runId: string;
}

async function computeInitialJurySelection(caseId: string): Promise<JurySelectionComputation> {
  const caseRecord = ensureCaseExists(caseId);
  const eligible = listEligibleJurors(db, {
    excludeAgentIds: [caseRecord.prosecutionAgentId, caseRecord.defenceAgentId ?? ""].filter(Boolean),
    weeklyLimit: 3
  });

  const drandData = await drand.getRoundAtOrAfter(Date.now());
  const selection = await selectJuryDeterministically({
    caseId,
    eligibleJurorIds: eligible,
    drand: drandData,
    jurySize: config.rules.jurorPanelSize
  });

  return {
    selectedJurors: selection.selectedJurors,
    drandRound: drandData.round,
    drandRandomness: drandData.randomness,
    poolSnapshotHash: selection.poolSnapshotHash,
    proof: selection.proof,
    scoredCandidates: selection.scoredCandidates,
    runId: createId("jruns")
  };
}

function persistInitialJurySelection(caseId: string, computed: JurySelectionComputation): void {
  createJurySelectionRun(db, {
    caseId,
    runId: computed.runId,
    runType: "initial",
    round: computed.drandRound,
    randomness: computed.drandRandomness,
    poolSnapshotHash: computed.poolSnapshotHash,
    proof: computed.proof
  });

  setCaseJurySelected(db, {
    caseId,
    round: computed.drandRound,
    randomness: computed.drandRandomness,
    poolSnapshotHash: computed.poolSnapshotHash,
    proof: computed.proof
  });

  replaceJuryMembers(
    db,
    caseId,
    computed.scoredCandidates
      .filter((item) => computed.selectedJurors.includes(item.agentId))
      .map((item) => ({
        jurorId: item.agentId,
        scoreHash: item.scoreHash,
        selectionRunId: computed.runId
      }))
  );
}

async function closeCasePipeline(caseId: string): Promise<{
  caseId: string;
  status: "closed";
  verdictHash: string;
  sealJob?: { jobId: string; mode: "stub" | "http" };
}> {
  if (closingCases.has(caseId)) {
    const caseRecord = ensureCaseExists(caseId);
    return {
      caseId,
      status: "closed",
      verdictHash: caseRecord.verdictHash ?? "pending"
    };
  }

  closingCases.add(caseId);
  try {
    const caseRecord = ensureCaseExists(caseId);
    const runtime = getCaseRuntime(db, caseId);
    if (caseRecord.status !== "voting" || runtime?.currentStage !== "voting") {
      throw conflict("CASE_NOT_VOTING", "Only voting cases can be closed.");
    }

    const claims = listClaims(db, caseId);
    const evidence = listEvidenceByCase(db, caseId);
    const submissions = listSubmissionsByCase(db, caseId);
    const ballots = listBallotsByCase(db, caseId);
    const juryMembers = listJuryMembers(db, caseId);

    const closeTime = new Date().toISOString();
    const verdict = await computeDeterministicVerdict({
      caseId,
      prosecutionAgentId: caseRecord.prosecutionAgentId,
      defenceAgentId: caseRecord.defenceAgentId,
      closedAtIso: closeTime,
      jurySize: juryMembers.length || config.rules.jurorPanelSize,
      claims: claims.map((item) => ({
        claimId: item.claimId,
        requestedRemedy: item.requestedRemedy
      })),
      ballots: ballots.map((item) => ({ votes: item.votes, ballotHash: item.ballotHash })),
      evidenceHashes: evidence.map((item) => item.bodyHash),
      submissionHashes: submissions.map((item) => item.contentHash),
      drandRound: caseRecord.drandRound ?? null,
      drandRandomness: caseRecord.drandRandomness ?? null,
      poolSnapshotHash: caseRecord.poolSnapshotHash ?? null
    });

    if (verdict.inconclusive || !verdict.overallOutcome) {
      markCaseVoid(db, {
        caseId,
        reason: "inconclusive_verdict",
        atIso: closeTime
      });

      appendTranscriptEvent(db, {
        caseId,
        actorRole: "court",
        eventType: "case_voided",
        stage: "void",
        messageText:
          "Case became void because the deterministic verdict was inconclusive across submitted claims.",
        payload: {
          reason: "inconclusive_verdict"
        }
      });

      const voidedCase = ensureCaseExists(caseId);
      syncCaseReputation(db, voidedCase);
      return {
        caseId,
        status: "closed",
        verdictHash: verdict.verdictHash
      };
    }

    storeVerdict(db, {
      caseId,
      verdictJson: verdict.bundle,
      verdictHash: verdict.verdictHash,
      majoritySummary: verdict.majoritySummary
    });

    appendTranscriptEvent(db, {
      caseId,
      actorRole: "court",
      eventType: "case_closed",
      stage: "closed",
      messageText: "Case closed after deterministic verdict computation.",
      artefactType: "verdict",
      artefactId: verdict.verdictHash
    });

    const closedCase = ensureCaseExists(caseId);
    syncCaseReputation(db, closedCase);
    const runtimeAfter = getCaseRuntime(db, caseId);

    if (closedCase.status === "void" || runtimeAfter?.currentStage === "void") {
      return {
        caseId,
        status: "closed",
        verdictHash: verdict.verdictHash
      };
    }

    const sealJob = await enqueueSealJob({
      db,
      config,
      caseRecord: closedCase,
      verdictHash: verdict.verdictHash
    });

    return {
      caseId,
      status: "closed",
      verdictHash: verdict.verdictHash,
      sealJob
    };
  } finally {
    closingCases.delete(caseId);
  }
}

const sessionEngine = createSessionEngine({
  db,
  config,
  drand,
  logger,
  async onCaseReadyToClose(caseId: string) {
    await closeCasePipeline(caseId);
  },
  async onCaseVoided(caseId: string) {
    const caseRecord = getCaseById(db, caseId);
    if (caseRecord) {
      syncCaseReputation(db, caseRecord);
    }
  }
});

async function handleSignedMutationWithIdempotency<TPayload, TResult>(input: {
  req: IncomingMessage;
  pathname: string;
  method: "POST";
  body: TPayload;
  caseId?: string;
  actionType: string;
  handler: (verified: Awaited<ReturnType<typeof verifySignedMutation>>) => Promise<{
    statusCode: number;
    payload: TResult;
  }>;
}): Promise<{ statusCode: number; payload: TResult }> {
  const verified = await verifySignedMutation({
    db,
    config,
    req: input.req,
    body: input.body,
    path: input.pathname,
    method: input.method,
    caseId: input.caseId
  });

  const idempotencyKey = readIdempotencyKey(input.req);
  const replay = assertIdempotency(db, {
    agentId: verified.agentId,
    method: input.method,
    path: input.pathname,
    requestHash: verified.payloadHash,
    idempotencyKey
  });
  if (replay) {
    return {
      statusCode: replay.status,
      payload: replay.payload as TResult
    };
  }

  const result = await input.handler(verified);

  recordSignedMutation({
    db,
    verified,
    actionType: input.actionType,
    caseId: input.caseId
  });

  saveIdempotency(db, config, {
    agentId: verified.agentId,
    method: input.method,
    path: input.pathname,
    caseId: input.caseId,
    requestHash: verified.payloadHash,
    idempotencyKey,
    responseStatus: result.statusCode,
    responsePayload: result.payload
  });

  return result;
}

async function handlePostCaseFile(pathname: string, req: IncomingMessage, body: FileCasePayload) {
  const caseId = resolveCaseIdFromPath(pathname);
  if (!caseId) {
    throw badRequest("CASE_ID_MISSING", "Case ID is required.");
  }

  return handleSignedMutationWithIdempotency<FileCasePayload, {
    caseId: string;
    status: "filed";
    warning?: string;
    selectedJurors: string[];
  }>({
    req,
    pathname,
    method: "POST",
    body,
    caseId,
    actionType: "file_case",
    async handler(verified) {
      const caseRecord = ensureCaseExists(caseId);
      if (caseRecord.status !== "draft") {
        throw conflict("CASE_NOT_DRAFT", "Only draft cases can be filed.");
      }
      if (verified.agentId !== caseRecord.prosecutionAgentId) {
        throw new ApiError(403, "NOT_PROSECUTION", "Only prosecution can file this case.");
      }

      const treasuryTxSig = body.treasuryTxSig?.trim();
      if (!treasuryTxSig) {
        throw badRequest("TREASURY_TX_REQUIRED", "Treasury transaction signature is required.");
      }
      const payerWallet = body.payerWallet?.trim();
      if (payerWallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payerWallet)) {
        throw badRequest("PAYER_WALLET_INVALID", "Payer wallet must be a valid Base58 public key.");
      }

      enforceFilingLimit(db, config, verified.agentId);

      if (isTreasuryTxUsed(db, treasuryTxSig)) {
        throw conflict("TREASURY_TX_REPLAY", "This treasury transaction has already been used.");
      }

      const verification = await solana.verifyFilingFeeTx(treasuryTxSig, payerWallet);
      if (!verification.finalised) {
        throw badRequest("TREASURY_TX_NOT_FINALISED", "Treasury transaction is not finalised.");
      }

      const computedJury = await computeInitialJurySelection(caseId);

      const todayCount = countFiledCasesToday(db, new Date().toISOString().slice(0, 10));
      let warning: string | undefined;
      if (todayCount >= config.softDailyCaseCap) {
        if (config.softCapMode === "enforce") {
          throw conflict("SOFT_CAP_EXCEEDED", "Daily case cap reached.", {
            cap: config.softDailyCaseCap
          });
        }
        warning = `Soft cap exceeded: ${todayCount + 1} filings today.`;
      }

      db.exec("BEGIN IMMEDIATE");
      try {
        const current = ensureCaseExists(caseId);
        if (current.status !== "draft") {
          throw conflict("CASE_NOT_DRAFT", "Only draft cases can be filed.");
        }
        if (isTreasuryTxUsed(db, treasuryTxSig)) {
          throw conflict("TREASURY_TX_REPLAY", "This treasury transaction has already been used.");
        }

        setCaseFiled(db, {
          caseId,
          txSig: treasuryTxSig,
          warning,
          scheduleDelaySec: config.rules.sessionStartsAfterSeconds,
          defenceCutoffSec: config.rules.defenceAssignmentCutoffSeconds
        });

        saveUsedTreasuryTx(db, {
          txSig: treasuryTxSig,
          caseId,
          agentId: verified.agentId,
          amountLamports: verification.amountLamports
        });

        persistInitialJurySelection(caseId, computedJury);

        appendTranscriptEventInTransaction(db, {
          caseId,
          actorRole: "court",
          eventType: "payment_verified",
          stage: "pre_session",
          messageText: "Filing payment was verified and session scheduling has started.",
          payload: {
            treasuryTxSig,
            amountLamports: verification.amountLamports,
            payerWallet: verification.payerWallet ?? null
          }
        });

        appendTranscriptEventInTransaction(db, {
          caseId,
          actorRole: "court",
          eventType: "jury_selected",
          stage: "pre_session",
          messageText: "Jury panel selected deterministically from the eligible pool.",
          payload: {
            round: computedJury.drandRound,
            jurors: computedJury.selectedJurors
          }
        });

        appendTranscriptEventInTransaction(db, {
          caseId,
          actorRole: "court",
          eventType: "notice",
          stage: "pre_session",
          messageText: "Live session is scheduled to begin in one hour.",
          payload: {
            sessionStartsAfterSeconds: config.rules.sessionStartsAfterSeconds
          }
        });

        appendTranscriptEventInTransaction(db, {
          caseId,
          actorRole: "court",
          eventType: "notice",
          stage: "pre_session",
          messageText:
            "Defence must be assigned within forty five minutes of filing or the case becomes void.",
          payload: {
            defenceAssignmentCutoffSeconds: config.rules.defenceAssignmentCutoffSeconds,
            namedDefendantExclusiveSeconds: config.rules.namedDefendantExclusiveSeconds
          }
        });

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return {
        statusCode: 200,
        payload: {
          caseId,
          status: "filed",
          warning,
          selectedJurors: computedJury.selectedJurors
        }
      };
    }
  });
}

async function processStageMessageAction(
  caseId: string,
  body: SubmitStageMessagePayload,
  agentId: string
) {
  const caseRecord = ensureCaseExists(caseId);
  const runtime = getCaseRuntime(db, caseId);

  const isDraftPreSubmission =
    caseRecord.status === "draft" &&
    body.side === "prosecution" &&
    body.stage === "opening_addresses";

  if (!isDraftPreSubmission) {
    if (!runtime) {
      throw conflict("SESSION_NOT_INITIALISED", "Case session runtime is not initialised.");
    }

    if (runtime.currentStage !== body.stage) {
      throw conflict("STAGE_MISMATCH", "Submission stage does not match current server stage.", {
        expected: runtime.currentStage,
        received: body.stage
      });
    }

    if (runtime.stageDeadlineAtIso && Date.now() > new Date(runtime.stageDeadlineAtIso).getTime()) {
      throw conflict("STAGE_DEADLINE_PASSED", "Stage submission deadline has passed.");
    }
  }

  if (body.text.length > config.limits.maxSubmissionCharsPerPhase) {
    throw badRequest("SUBMISSION_TOO_LONG", "Submission text exceeds maximum characters.");
  }

  const principleCitations = normalisePrincipleIds(body.principleCitations ?? [], {
    field: "principleCitations"
  });
  const claimPrincipleCitations = body.claimPrincipleCitations
    ? Object.fromEntries(
        Object.entries(body.claimPrincipleCitations).map(([claimId, values]) => [
          claimId,
          normalisePrincipleIds(values, { field: `claimPrincipleCitations.${claimId}` })
        ])
      )
    : undefined;
  const evidenceCitations = Array.isArray(body.evidenceCitations)
    ? body.evidenceCitations.map((value) => String(value))
    : [];

  if (claimPrincipleCitations) {
    const validClaimIds = new Set(listClaims(db, caseId).map((item) => item.claimId));
    for (const claimId of Object.keys(claimPrincipleCitations)) {
      if (!validClaimIds.has(claimId)) {
        throw badRequest("UNKNOWN_CLAIM", "Submission references unknown claim ID.", { claimId });
      }
    }
  }

  if (body.side === "prosecution" && agentId !== caseRecord.prosecutionAgentId) {
    throw new ApiError(
      403,
      "NOT_PROSECUTION",
      "Only prosecution can submit prosecution stage messages."
    );
  }

  if (body.side === "defence") {
    if (caseRecord.defenceAgentId !== agentId) {
      throw new ApiError(403, "NOT_DEFENCE", "Only assigned defence can submit defence messages.");
    }
  }

  enforceActionRateLimit(db, config, { agentId, actionType: "submission" });

  const phase = toSubmissionPhase(body.stage);
  const contentHash = await canonicalHashHex({
    side: body.side,
    phase,
    text: body.text,
    principleCitations,
    claimPrincipleCitations: claimPrincipleCitations ?? {},
    evidenceCitations
  });

  const submission = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: body.side,
    phase,
    text: body.text,
    principleCitations,
    claimPrincipleCitations,
    evidenceCitations,
    contentHash
  });

  appendTranscriptEvent(db, {
    caseId,
    actorRole: body.side,
    actorAgentId: agentId,
    eventType: "stage_submission",
    stage: body.stage,
    messageText: `${body.side === "prosecution" ? "Prosecution" : "Defence"} submitted ${body.stage.replace(/_/g, " ")} message.`,
    artefactType: "submission",
    artefactId: submission.submissionId,
    payload: {
      phase,
      principleCitations,
      claimPrincipleCitations: claimPrincipleCitations ?? {},
      evidenceCitations
    }
  });

  return submission;
}

async function handleStageMessage(
  pathname: string,
  req: IncomingMessage,
  caseId: string,
  body: SubmitStageMessagePayload,
  actionType = "stage_message"
) {
  return handleSignedMutationWithIdempotency<SubmitStageMessagePayload, ReturnType<typeof upsertSubmission>>({
    req,
    pathname,
    method: "POST",
    body,
    caseId,
    actionType,
    async handler(verified) {
      const submission = await processStageMessageAction(caseId, body, verified.agentId);
      return {
        statusCode: 201,
        payload: submission
      };
    }
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  setCorsHeaders(res, config.corsOrigin);
  setSecurityHeaders(res, config.isProduction);

  const requestId = createRequestId();
  res.setHeader("X-Request-Id", requestId);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  const segments = pathSegments(pathname);

  logger.info("request_start", {
    requestId,
    method,
    pathname
  });

  try {
    if (method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        name: "opencawt-phase4-api",
        now: new Date().toISOString()
      });
      return;
    }

    if (method === "GET" && pathname === "/api/internal/credential-status") {
      assertSystemKey(req, config);
      sendJson(res, 200, {
        solanaMode: config.solanaMode,
        sealWorkerMode: config.sealWorkerMode,
        drandMode: config.drandMode,
        hasHeliusApiKey: Boolean(config.heliusApiKey),
        hasTreasuryAddress: Boolean(config.treasuryAddress),
        hasWorkerToken: Boolean(config.workerToken),
        hasSystemApiKey: Boolean(config.systemApiKey),
        hasHeliusWebhookToken: Boolean(config.heliusWebhookToken),
        hasSealWorkerUrl: Boolean(config.sealWorkerUrl)
      });
      return;
    }

    if (
      method === "GET" &&
      segments.length === 5 &&
      segments[0] === "api" &&
      segments[1] === "internal" &&
      segments[2] === "cases" &&
      segments[4] === "diagnostics"
    ) {
      assertSystemKey(req, config);
      const caseId = decodeURIComponent(segments[3]);
      sendJson(res, 200, getCaseIntegrityDiagnostics(db, caseId));
      return;
    }

    if (method === "GET" && pathname === "/api/openclaw/tools") {
      sendJson(res, 200, {
        tools: OPENCAWT_OPENCLAW_TOOLS.map(toOpenClawParameters)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/rules/timing") {
      sendJson(res, 200, {
        ...config.rules
      });
      return;
    }

    if (method === "GET" && pathname === "/api/rules/limits") {
      sendJson(res, 200, {
        softDailyCaseCap: config.softDailyCaseCap,
        filingPer24h: config.rateLimits.filingPer24h,
        evidencePerHour: config.rateLimits.evidencePerHour,
        submissionsPerHour: config.rateLimits.submissionsPerHour,
        ballotsPerHour: config.rateLimits.ballotsPerHour
      });
      return;
    }

    if (method === "GET" && pathname === "/api/metrics/cases") {
      sendJson(res, 200, {
        closedCasesCount: countClosedAndSealedCases(db)
      });
      return;
    }

    if (method === "GET" && pathname === "/api/schedule") {
      const openRecords = listCasesByStatuses(db, ["draft", "filed", "jury_selected", "voting"]);
      const hydrated = await Promise.all(openRecords.map((item) => hydrateCase(item)));
      const scheduled = hydrated.filter((item) => item.status === "scheduled");
      const active = hydrated.filter((item) => item.status === "active");

      sendJson(res, 200, {
        scheduled,
        active,
        softCapPerDay: config.softDailyCaseCap,
        capWindowLabel: "Soft daily cap"
      });
      return;
    }

    if (method === "GET" && pathname === "/api/open-defence") {
      const filters: OpenDefenceSearchFilters = {
        q: url.searchParams.get("q") || undefined,
        status: (url.searchParams.get("status") as OpenDefenceSearchFilters["status"]) || "all",
        tag: url.searchParams.get("tag") || undefined,
        startAfterIso: url.searchParams.get("start_after") || undefined,
        startBeforeIso: url.searchParams.get("start_before") || undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined
      };

      const cases = listOpenDefenceCases(db, filters, {
        nowIso: new Date().toISOString(),
        namedExclusiveSec: config.rules.namedDefendantExclusiveSeconds
      });

      sendJson(res, 200, {
        filters,
        cases
      });
      return;
    }

    if (method === "GET" && pathname === "/api/leaderboard") {
      const limit = Number(url.searchParams.get("limit") || "20");
      const minDecided = Number(url.searchParams.get("min_decided") || "5");
      const rows = listLeaderboard(db, {
        limit: Number.isFinite(limit) ? limit : 20,
        minDecidedCases: Number.isFinite(minDecided) ? minDecided : 5
      });
      sendJson(res, 200, {
        limit: Number.isFinite(limit) ? limit : 20,
        minDecidedCases: Number.isFinite(minDecided) ? minDecided : 5,
        rows
      });
      return;
    }

    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "agents" &&
      segments[3] === "profile"
    ) {
      const agentId = decodeURIComponent(segments[2]);
      const activityLimit = Number(url.searchParams.get("activity_limit") || "20");
      const profile: AgentProfile = getAgentProfile(db, agentId, {
        activityLimit: Number.isFinite(activityLimit) ? activityLimit : 20
      });
      sendJson(res, 200, profile);
      return;
    }

    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "session"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const caseRecord = getCaseById(db, caseId);
      if (!caseRecord) {
        sendJson(res, 404, null);
        return;
      }
      sendJson(res, 200, getCaseRuntime(db, caseId));
      return;
    }

    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "transcript"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const caseRecord = getCaseById(db, caseId);
      if (!caseRecord) {
        sendJson(res, 404, null);
        return;
      }
      const afterSeq = Number(url.searchParams.get("after_seq") || "0");
      const limit = Number(url.searchParams.get("limit") || "200");
      sendJson(res, 200, {
        caseId,
        events: listTranscriptEvents(db, {
          caseId,
          afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
          limit: Number.isFinite(limit) ? limit : 200
        })
      });
      return;
    }

    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "cases"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const caseRecord = getCaseById(db, caseId);
      if (!caseRecord) {
        sendJson(res, 404, null);
        return;
      }
      sendJson(res, 200, await hydrateCase(caseRecord));
      return;
    }

    if (method === "GET" && pathname === "/api/decisions") {
      const decisionRecords = listCasesByStatuses(db, ["closed", "sealed", "void"]);
      const decisions = await Promise.all(decisionRecords.map((item) => hydrateDecision(item)));
      sendJson(res, 200, decisions);
      return;
    }

    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "api" &&
      segments[1] === "decisions"
    ) {
      const id = decodeURIComponent(segments[2]);
      const caseRecord = getDecisionCase(db, id);
      if (!caseRecord || !["closed", "sealed", "void"].includes(caseRecord.status)) {
        sendJson(res, 404, null);
        return;
      }
      sendJson(res, 200, await hydrateDecision(caseRecord));
      return;
    }

    if (method === "POST" && pathname === "/api/agents/register") {
      const body = await readJsonBody<RegisterAgentPayload>(req);
      const result = await handleSignedMutationWithIdempotency<RegisterAgentPayload, {
        agentId: string;
        status: string;
        createdAtIso: string;
      }>({
        req,
        pathname,
        method: "POST",
        body,
        actionType: "register_agent",
        async handler(verified) {
          if (!body.agentId || body.agentId !== verified.agentId) {
            throw badRequest("AGENT_ID_MISMATCH", "Payload agentId must match signing identity.");
          }

          upsertAgent(db, body.agentId, body.jurorEligible ?? true);

          return {
            statusCode: 200,
            payload: {
              agentId: body.agentId,
              status: "registered",
              createdAtIso: new Date().toISOString()
            }
          };
        }
      });
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/jury-pool/join") {
      const body = await readJsonBody<JoinJuryPoolPayload>(req);
      const result = await handleSignedMutationWithIdempotency<JoinJuryPoolPayload, {
        registrationId: string;
        createdAtIso: string;
        status: string;
      }>({
        req,
        pathname,
        method: "POST",
        body,
        actionType: "join_jury_pool",
        async handler(verified) {
          if (body.agentId !== verified.agentId) {
            throw badRequest("AGENT_ID_MISMATCH", "Payload agentId must match signing identity.");
          }

          upsertAgent(db, body.agentId, true);
          setJurorAvailability(db, {
            agentId: body.agentId,
            availability: body.availability,
            profile: body.profile
          });

          return {
            statusCode: 200,
            payload: {
              registrationId: createId("jury"),
              createdAtIso: new Date().toISOString(),
              status: "registered"
            }
          };
        }
      });

      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/jury/assigned") {
      const body = await readJsonBody<AssignedCasesPayload>(req);
      const verified = await verifySignedMutation({
        db,
        config,
        req,
        body,
        path: pathname,
        method: "POST"
      });

      if (body.agentId !== verified.agentId) {
        throw badRequest("AGENT_ID_MISMATCH", "Payload agentId must match signing identity.");
      }

      sendJson(res, 200, {
        agentId: body.agentId,
        cases: listAssignedCasesForJuror(db, body.agentId)
      });
      return;
    }

    if (method === "POST" && pathname === "/api/cases/draft") {
      const body = await readJsonBody<CreateCaseDraftPayload>(req);
      const result = await handleSignedMutationWithIdempotency<CreateCaseDraftPayload, {
        draftId: string;
        caseId: string;
        createdAtIso: string;
        status: "draft";
      }>({
        req,
        pathname,
        method: "POST",
        body,
        actionType: "create_case_draft",
        async handler(verified) {
          if (body.prosecutionAgentId !== verified.agentId) {
            throw badRequest("AGENT_ID_MISMATCH", "Prosecution agent must match signing identity.");
          }

          if (!body.claimSummary?.trim() && (!body.claims || body.claims.length === 0)) {
            throw badRequest("CLAIM_SUMMARY_REQUIRED", "Claim summary is required.");
          }

          const caseTopic = validateCaseTopic(body.caseTopic ?? "other");
          const stakeLevel = validateStakeLevel(body.stakeLevel ?? "medium");
          const allegedPrinciples = normalisePrincipleIds(body.allegedPrinciples ?? [], {
            field: "allegedPrinciples"
          });
          const claims =
            body.claims && body.claims.length > 0
              ? body.claims.map((claim, index) => {
                  if (!claim.claimSummary?.trim()) {
                    throw badRequest(
                      "CLAIM_SUMMARY_REQUIRED",
                      `claims[${index}].claimSummary is required.`
                    );
                  }
                  return {
                    claimSummary: claim.claimSummary.trim(),
                    requestedRemedy: claim.requestedRemedy,
                    principlesInvoked: normalisePrincipleIds(claim.principlesInvoked ?? [], {
                      field: `claims[${index}].principlesInvoked`
                    })
                  };
                })
              : undefined;
          const claimSummary = body.claimSummary?.trim() || claims?.[0]?.claimSummary || "";

          upsertAgent(db, body.prosecutionAgentId, true);
          if (body.defendantAgentId) {
            upsertAgent(db, body.defendantAgentId, true);
          }

          const created = createCaseDraft(db, {
            ...body,
            claimSummary,
            caseTopic,
            stakeLevel,
            allegedPrinciples,
            claims
          });
          appendTranscriptEvent(db, {
            caseId: created.caseId,
            actorRole: "prosecution",
            actorAgentId: body.prosecutionAgentId,
            eventType: "notice",
            stage: "pre_session",
            messageText: "Dispute draft created."
          });

          return {
            statusCode: 201,
            payload: {
              draftId: created.caseId,
              caseId: created.caseId,
              createdAtIso: created.createdAtIso,
              status: "draft"
            }
          };
        }
      });

      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "file"
    ) {
      const body = await readJsonBody<FileCasePayload>(req);
      const result = await handlePostCaseFile(pathname, req, body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "volunteer-defence"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const body = await readJsonBody<VolunteerDefencePayload>(req);
      const result = await handleSignedMutationWithIdempotency<VolunteerDefencePayload, {
        caseId: string;
        defenceAgentId: string;
        status: "assigned";
        defenceState: "accepted" | "volunteered";
        defenceAssignedAtIso?: string;
        defenceWindowDeadlineIso?: string;
      }>({
        req,
        pathname,
        method: "POST",
        body,
        caseId,
        actionType: "volunteer_defence",
        async handler(verified) {
          upsertAgent(db, verified.agentId, true);
          ensureCaseExists(caseId);
          const claim = claimDefenceAssignment(db, {
            caseId,
            agentId: verified.agentId,
            nowIso: new Date().toISOString(),
            namedExclusiveSec: config.rules.namedDefendantExclusiveSeconds
          });

          if (claim.status === "already_taken") {
            throw conflict("DEFENCE_ALREADY_TAKEN", "Defence assignment has already been claimed.");
          }
          if (claim.status === "defence_cannot_be_prosecution") {
            throw badRequest("DEFENCE_CANNOT_BE_PROSECUTION", "Defence cannot be the same as prosecution.");
          }
          if (claim.status === "not_open") {
            throw conflict("CASE_NOT_OPEN_FOR_DEFENCE", "Case is not open for defence assignment.");
          }
          if (claim.status === "reserved_for_named_defendant") {
            throw conflict(
              "DEFENCE_RESERVED_FOR_NAMED_DEFENDANT",
              "Only the named defendant can accept during the exclusive window."
            );
          }
          if (claim.status === "window_closed") {
            throw conflict("DEFENCE_WINDOW_CLOSED", "The defence assignment window is closed.");
          }

          const accepted = claim.status === "assigned_accepted";
          appendTranscriptEvent(db, {
            caseId,
            actorRole: "court",
            eventType: "notice",
            stage: "pre_session",
            messageText: accepted
              ? `Defence accepted by named defendant ${verified.agentId}.`
              : `Defence volunteered by ${verified.agentId}.`,
            payload: {
              note: body.note ?? null,
              defenceAgentId: verified.agentId,
              defenceState: accepted ? "accepted" : "volunteered"
            }
          });

          return {
            statusCode: 200,
            payload: {
              caseId,
              defenceAgentId: verified.agentId,
              status: "assigned",
              defenceState: accepted ? "accepted" : "volunteered",
              defenceAssignedAtIso: claim.caseRecord.defenceAssignedAtIso,
              defenceWindowDeadlineIso: claim.caseRecord.defenceWindowDeadlineIso
            }
          };
        }
      });

      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "defence-assign"
    ) {
      throw new ApiError(
        410,
        "DEFENCE_ASSIGN_DEPRECATED",
        "Use /api/cases/:id/volunteer-defence with the defence agent signing directly."
      );
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "evidence"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const body = await readJsonBody<SubmitEvidencePayload>(req);

      const result = await handleSignedMutationWithIdempotency<SubmitEvidencePayload, ReturnType<typeof addEvidence>>({
        req,
        pathname,
        method: "POST",
        body,
        caseId,
        actionType: "evidence",
        async handler(verified) {
          const caseRecord = ensureCaseExists(caseId);
          const isDraft = caseRecord.status === "draft";
          const isOpenCase = ["filed", "jury_selected", "voting"].includes(caseRecord.status);

          if (isDraft) {
            if (verified.agentId !== caseRecord.prosecutionAgentId) {
              throw new ApiError(403, "NOT_PARTY", "Only prosecution can submit evidence during draft.");
            }
          } else if (isOpenCase) {
            const runtime = getCaseRuntime(db, caseId);
            if (!runtime || runtime.currentStage !== "evidence") {
              throw conflict("EVIDENCE_STAGE_REQUIRED", "Evidence can only be submitted during the evidence stage.");
            }
            if (
              verified.agentId !== caseRecord.prosecutionAgentId &&
              verified.agentId !== caseRecord.defenceAgentId
            ) {
              throw new ApiError(403, "NOT_PARTY", "Only participating agents can submit evidence.");
            }
          } else {
            throw conflict("CASE_NOT_OPEN", "Evidence can only be submitted to draft or open cases.");
          }

          enforceActionRateLimit(db, config, { agentId: verified.agentId, actionType: "evidence" });

          const EVIDENCE_KINDS = ["log", "transcript", "code", "link", "attestation", "other"] as const;
          const kind = body.kind?.trim?.() ?? body.kind;
          if (!kind || !EVIDENCE_KINDS.includes(kind as (typeof EVIDENCE_KINDS)[number])) {
            throw badRequest("INVALID_EVIDENCE_KIND", "Evidence kind must be one of: log, transcript, code, link, attestation, other.");
          }
          const evidenceTypes = validateEvidenceTypes(body.evidenceTypes);
          const evidenceStrength = validateEvidenceStrength(body.evidenceStrength);
          const references = Array.isArray(body.references)
            ? body.references.map((item) => String(item))
            : [];

          const bodyText = body.bodyText?.trim() ?? "";
          if (!bodyText) {
            throw badRequest("EVIDENCE_TEXT_REQUIRED", "Evidence text is required.");
          }
          if (bodyText.length > config.limits.maxEvidenceCharsPerItem) {
            throw badRequest("EVIDENCE_TOO_LONG", "Evidence item exceeds maximum characters.");
          }

          const evidenceStats = countEvidenceForCase(db, caseId);
          if (evidenceStats.count >= config.limits.maxEvidenceItemsPerCase) {
            throw conflict("EVIDENCE_LIMIT_REACHED", "Case evidence item limit reached.");
          }
          if (evidenceStats.totalChars + bodyText.length > config.limits.maxEvidenceCharsPerCase) {
            throw conflict(
              "EVIDENCE_TOTAL_LIMIT_REACHED",
              "Case evidence total character limit reached."
            );
          }

          const evidenceId = createId("E");
          const bodyHash = await canonicalHashHex({
            kind,
            bodyText,
            references,
            evidenceTypes,
            evidenceStrength: evidenceStrength ?? null
          });

          const evidence = addEvidence(db, {
            evidenceId,
            caseId,
            submittedBy: verified.agentId,
            kind: kind as "log" | "transcript" | "code" | "link" | "attestation" | "other",
            bodyText,
            references,
            evidenceTypes,
            evidenceStrength,
            bodyHash
          });

          appendTranscriptEvent(db, {
            caseId,
            actorRole:
              verified.agentId === caseRecord.prosecutionAgentId ? "prosecution" : "defence",
            actorAgentId: verified.agentId,
            eventType: "notice",
            stage: "evidence",
            messageText: "Evidence item submitted.",
            artefactType: "evidence",
            artefactId: evidence.evidenceId
          });

          return {
            statusCode: 201,
            payload: evidence
          };
        }
      });

      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "stage-message"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const body = await readJsonBody<SubmitStageMessagePayload>(req);
      const result = await handleStageMessage(pathname, req, caseId, body, "stage_message");
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "submissions"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const body = await readJsonBody<SubmitPhasePayload>(req);
      const result = await handleSignedMutationWithIdempotency<SubmitPhasePayload, ReturnType<typeof upsertSubmission>>({
        req,
        pathname,
        method: "POST",
        body,
        caseId,
        actionType: "submission",
        async handler(verified) {
          const stageBody: SubmitStageMessagePayload = {
            side: body.side,
            stage: toSubmissionStage(body.phase),
            text: body.text,
            principleCitations: body.principleCitations,
            evidenceCitations: body.evidenceCitations
          };
          const submission = await processStageMessageAction(caseId, stageBody, verified.agentId);
          return {
            statusCode: 201,
            payload: submission
          };
        }
      });
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "juror-ready"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const body = await readJsonBody<JurorReadinessPayload>(req);

      const result = await handleSignedMutationWithIdempotency<JurorReadinessPayload, {
        caseId: string;
        jurorId: string;
        status: "ready";
      }>({
        req,
        pathname,
        method: "POST",
        body,
        caseId,
        actionType: "juror_ready",
        async handler(verified) {
          ensureCaseExists(caseId);
          const runtime = getCaseRuntime(db, caseId);
          if (!runtime || runtime.currentStage !== "jury_readiness") {
            throw conflict("READINESS_NOT_OPEN", "Jury readiness is not currently open.");
          }

          const member = listJuryPanelMembers(db, caseId).find(
            (item) => item.jurorId === verified.agentId
          );
          if (!member || member.memberStatus !== "pending_ready") {
            throw new ApiError(403, "NOT_PENDING_JUROR", "Juror readiness is not pending for this agent.");
          }

          if (member.readyDeadlineAtIso && Date.now() > new Date(member.readyDeadlineAtIso).getTime()) {
            throw conflict("READINESS_DEADLINE_PASSED", "Readiness deadline has passed.");
          }

          const ok = confirmJurorReady(db, caseId, verified.agentId, new Date().toISOString());
          if (!ok) {
            throw conflict("READINESS_ALREADY_RECORDED", "Readiness was already recorded.");
          }

          appendTranscriptEvent(db, {
            caseId,
            actorRole: "juror",
            actorAgentId: verified.agentId,
            eventType: "juror_ready",
            stage: "jury_readiness",
            messageText: "Juror confirmed readiness."
          });

          return {
            statusCode: 200,
            payload: {
              caseId,
              jurorId: verified.agentId,
              status: "ready"
            }
          };
        }
      });

      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "ballots"
    ) {
      const caseId = decodeURIComponent(segments[2]);
      const body = await readJsonBody<SubmitBallotPayload>(req);
      const result = await handleSignedMutationWithIdempotency<SubmitBallotPayload, {
        ballotId: string;
        caseId: string;
        jurorId: string;
        submittedAtIso: string;
        ballotHash: string;
      }>({
        req,
        pathname,
        method: "POST",
        body,
        caseId,
        actionType: "ballot",
        async handler(verified) {
          const caseRecord = ensureCaseExists(caseId);
          const runtime = getCaseRuntime(db, caseId);
          if (caseRecord.status !== "voting" || runtime?.currentStage !== "voting") {
            throw conflict("CASE_NOT_VOTING", "Ballots are only accepted in voting stage.");
          }

          const juryMembers = listJuryMembers(db, caseId);
          if (!juryMembers.includes(verified.agentId)) {
            throw new ApiError(403, "NOT_JUROR", "Only selected jurors can submit ballots.");
          }

          const member = listJuryPanelMembers(db, caseId).find((item) => item.jurorId === verified.agentId);
          if (!member || !["active_voting", "ready"].includes(member.memberStatus)) {
            throw conflict("JUROR_NOT_ACTIVE", "Juror is not active for voting.");
          }

          if (member.votingDeadlineAtIso && Date.now() > new Date(member.votingDeadlineAtIso).getTime()) {
            throw conflict("BALLOT_DEADLINE_PASSED", "Voting deadline has passed for this juror.");
          }

          enforceActionRateLimit(db, config, { agentId: verified.agentId, actionType: "ballot" });

          const reasoningSummary = validateReasoningSummary(body.reasoningSummary || "");
          const principlesReliedOn = normalisePrincipleIds(body.principlesReliedOn, {
            required: true,
            min: 1,
            max: 3,
            field: "principlesReliedOn"
          });
          const confidence = validateBallotConfidence(body.confidence);
          const vote = validateBallotVoteLabel(body.vote);

          const claims = listClaims(db, caseId);
          const validClaimIds = new Set(claims.map((item) => item.claimId));
          if (!Array.isArray(body.votes) || body.votes.length === 0) {
            throw badRequest("BALLOT_VOTES_REQUIRED", "Ballot votes are required.");
          }
          const FINDING_ENUM = ["proven", "not_proven", "insufficient"] as const;
          const REMEDY_ENUM = ["warn", "delist", "ban", "restitution", "other", "none"] as const;

          for (const vote of body.votes) {
            if (!validClaimIds.has(vote.claimId)) {
              throw badRequest("UNKNOWN_CLAIM", "Ballot references unknown claim ID.", {
                claimId: vote.claimId
              });
            }
            if (!vote.finding || !FINDING_ENUM.includes(vote.finding as (typeof FINDING_ENUM)[number])) {
              throw badRequest("INVALID_FINDING", "Vote finding must be proven, not_proven, or insufficient.", {
                claimId: vote.claimId
              });
            }
            const severity = Number(vote.severity);
            if (!Number.isFinite(severity) || severity < 1 || severity > 3 || severity !== Math.floor(severity)) {
              throw badRequest("INVALID_SEVERITY", "Vote severity must be 1, 2, or 3.", {
                claimId: vote.claimId
              });
            }
            if (!vote.recommendedRemedy || !REMEDY_ENUM.includes(vote.recommendedRemedy as (typeof REMEDY_ENUM)[number])) {
              throw badRequest("INVALID_RECOMMENDED_REMEDY", "Vote recommendedRemedy must be warn, delist, ban, restitution, other, or none.", {
                claimId: vote.claimId
              });
            }
          }

          const ballotHash = await canonicalHashHex({
            ...body,
            reasoningSummary,
            principlesReliedOn,
            confidence: confidence ?? null,
            vote: vote ?? null
          });
          let ballot;
          try {
            ballot = addBallot(db, {
              caseId,
              jurorId: verified.agentId,
              votes: body.votes,
              reasoningSummary,
              principlesReliedOn,
              confidence,
              vote,
              ballotHash,
              signature: verified.signature
            });
          } catch (error) {
            if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
              throw conflict(
                "BALLOT_ALREADY_SUBMITTED",
                "Only one ballot per juror is allowed per case."
              );
            }
            throw error;
          }

          markJurorVoted(db, caseId, verified.agentId);

          appendTranscriptEvent(db, {
            caseId,
            actorRole: "juror",
            actorAgentId: verified.agentId,
            eventType: "ballot_submitted",
            stage: "voting",
            messageText: "Juror submitted ballot with reasoning summary.",
            artefactType: "ballot",
            artefactId: ballot.ballotId,
            payload: {
              reasoningSummary: ballot.reasoningSummary,
              principlesReliedOn: ballot.principlesReliedOn,
              confidence: ballot.confidence ?? null
            }
          });

          return {
            statusCode: 201,
            payload: {
              ballotId: ballot.ballotId,
              caseId: ballot.caseId,
              jurorId: ballot.jurorId,
              submittedAtIso: ballot.createdAtIso,
              ballotHash: ballot.ballotHash
            }
          };
        }
      });

      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "select-jury"
    ) {
      assertSystemKey(req, config);
      const caseId = decodeURIComponent(segments[2]);
      const caseRecord = ensureCaseExists(caseId);
      if (!["filed", "jury_selected", "voting"].includes(caseRecord.status)) {
        throw conflict("CASE_NOT_ELIGIBLE", "Case is not eligible for jury selection.");
      }

      const selected = await computeInitialJurySelection(caseId);
      db.exec("BEGIN IMMEDIATE");
      try {
        persistInitialJurySelection(caseId, selected);
        appendTranscriptEventInTransaction(db, {
          caseId,
          actorRole: "court",
          eventType: "jury_selected",
          stage: "pre_session",
          messageText: "Jury panel selected deterministically from the eligible pool.",
          payload: {
            round: selected.drandRound,
            jurors: selected.selectedJurors
          }
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      sendJson(res, 200, {
        caseId,
        status: "jury_selected",
        selectedJurors: selected.selectedJurors,
        drandRound: selected.drandRound
      });
      return;
    }

    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "api" &&
      segments[1] === "cases" &&
      segments[3] === "close"
    ) {
      assertSystemKey(req, config);
      const caseId = decodeURIComponent(segments[2]);
      sendJson(res, 200, await closeCasePipeline(caseId));
      return;
    }

    if (method === "POST" && pathname === "/api/internal/seal-result") {
      assertWorkerToken(req, config);
      const body = await readJsonBody<WorkerSealResponse>(req);
      if (!body.jobId || !body.caseId) {
        throw badRequest("SEAL_RESULT_INVALID", "Seal result requires jobId and caseId.");
      }

      const sealJob = getSealJobByJobId(db, body.jobId);
      if (!sealJob) {
        throw notFound("SEAL_JOB_NOT_FOUND", "Seal job was not found.");
      }
      if (sealJob.caseId !== body.caseId) {
        throw conflict("SEAL_JOB_CASE_MISMATCH", "Seal job does not match case.");
      }

      if (sealJob.status !== "queued") {
        const existingHash = await canonicalHashHex(sealJob.responseJson ?? {});
        const incomingHash = await canonicalHashHex(body);
        if (existingHash === incomingHash) {
          sendJson(res, 200, {
            ok: true,
            caseId: body.caseId,
            status: body.status,
            replayed: true
          });
          return;
        }
        throw conflict("SEAL_JOB_ALREADY_FINALISED", "Seal job has already been finalised.");
      }

      const caseRecord = ensureCaseExists(body.caseId);
      if (!["closed", "sealed"].includes(caseRecord.status)) {
        throw conflict("CASE_NOT_CLOSABLE_FOR_SEAL", "Case is not in a closable state for sealing.");
      }
      if (body.status === "minted") {
        if (!body.assetId?.trim() || !body.txSig?.trim() || !body.sealedUri?.trim()) {
          throw badRequest(
            "SEAL_RESULT_INVALID",
            "Minted seal result requires assetId, txSig and sealedUri."
          );
        }
      }

      applySealResult(db, body);

      if (body.status === "minted") {
        appendTranscriptEvent(db, {
          caseId: body.caseId,
          actorRole: "court",
          eventType: "case_sealed",
          stage: "sealed",
          messageText: "Case sealed and cNFT metadata resolved.",
          artefactType: "seal",
          artefactId: body.assetId,
          payload: {
            txSig: body.txSig,
            sealedUri: body.sealedUri
          }
        });
      }

      sendJson(res, 200, {
        ok: true,
        caseId: body.caseId,
        status: body.status
      });
      return;
    }

    if (method === "POST" && pathname === "/api/internal/helius/webhook") {
      if (!config.heliusWebhookEnabled) {
        throw notFound("WEBHOOK_DISABLED", "Helius webhook endpoint is disabled.");
      }
      const token = String(req.headers["x-helius-token"] || "");
      if (!config.heliusWebhookToken || token !== config.heliusWebhookToken) {
        throw unauthorised("HELIUS_WEBHOOK_TOKEN_INVALID", "Webhook token is invalid.");
      }
      const body = await readJsonBody<unknown>(req);
      const events = Array.isArray(body) ? body : [body];
      logger.info("helius_webhook_received", {
        requestId,
        eventCount: events.length,
        firstEventType:
          events.length > 0 && events[0] && typeof events[0] === "object"
            ? String((events[0] as Record<string, unknown>).type ?? "unknown")
            : "unknown"
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && !pathname.startsWith("/api")) {
      const distDir = resolve(process.cwd(), "dist");
      const safePath = pathname === "/" ? "/index.html" : pathname;
      const filePath = join(distDir, safePath.replace(/^\/+/, ""));
      if (filePath.startsWith(distDir) && existsSync(filePath)) {
        const ext = extname(filePath);
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".ico": "image/x-icon",
          ".svg": "image/svg+xml",
          ".json": "application/json"
        };
        res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
        createReadStream(filePath).pipe(res);
        return;
      }
      const indexPath = join(distDir, "index.html");
      if (existsSync(indexPath)) {
        res.setHeader("Content-Type", "text/html");
        createReadStream(indexPath).pipe(res);
        return;
      }
    }

    sendJson(res, 404, {
      error: {
        code: "NOT_FOUND",
        message: `No route for ${method} ${pathname}`
      }
    });
  } catch (error) {
    const apiError = safeError(error);
    logger.error("request_failed", {
      requestId,
      method,
      pathname,
      code: apiError.code,
      message: apiError.message
    });
    sendApiError(res, apiError);
  } finally {
    logger.info("request_end", {
      requestId,
      method,
      pathname
    });
  }
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(config.apiPort, config.apiHost, () => {
  process.stdout.write(
    `OpenCawt API listening on http://${config.apiHost}:${config.apiPort} (db ${config.dbPath})\n`
  );
  sessionEngine.start();
});

process.on("SIGINT", () => {
  sessionEngine.stop();
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  sessionEngine.stop();
  server.close(() => process.exit(0));
});
