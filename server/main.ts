import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { canonicalHashHex } from "../shared/hash";
import { createId } from "../shared/ids";
import type {
  AssignedCasesPayload,
  CreateCaseDraftPayload,
  DefenceAssignPayload,
  FileCasePayload,
  JoinJuryPoolPayload,
  JurorReadinessPayload,
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
  confirmJurorReady,
  countEvidenceForCase,
  countFiledCasesToday,
  createCaseDraft,
  createJurySelectionRun,
  getCaseById,
  getCaseRuntime,
  getDecisionCase,
  isTreasuryTxUsed,
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
  markJurorVoted,
  replaceJuryMembers,
  saveUsedTreasuryTx,
  setCaseDefence,
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
  pathSegments,
  readJsonBody,
  sendApiError,
  sendJson,
  setCorsHeaders
} from "./services/http";
import { toUiCase, toUiDecision } from "./services/presenters";
import { computeDeterministicVerdict } from "./services/verdict";

const config = getConfig();
const logger = createLogger(config.logLevel);
const db = openDatabase(config);
const drand = createDrandClient(config);
const solana = createSolanaProvider(config);

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

function countSentences(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) {
    return 0;
  }
  const matches = cleaned.match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 1;
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

async function selectInitialJury(caseId: string): Promise<{ selectedJurors: string[]; drandRound: number }> {
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

  const runId = createId("jruns");
  createJurySelectionRun(db, {
    caseId,
    runId,
    runType: "initial",
    round: drandData.round,
    randomness: drandData.randomness,
    poolSnapshotHash: selection.poolSnapshotHash,
    proof: selection.proof
  });

  setCaseJurySelected(db, {
    caseId,
    round: drandData.round,
    randomness: drandData.randomness,
    poolSnapshotHash: selection.poolSnapshotHash,
    proof: selection.proof
  });

  replaceJuryMembers(
    db,
    caseId,
    selection.scoredCandidates
      .filter((item) => selection.selectedJurors.includes(item.agentId))
      .map((item) => ({ jurorId: item.agentId, scoreHash: item.scoreHash, selectionRunId: runId }))
  );

  appendTranscriptEvent(db, {
    caseId,
    actorRole: "court",
    eventType: "jury_selected",
    stage: "pre_session",
    messageText: "Jury panel selected deterministically from the eligible pool.",
    payload: {
      round: drandData.round,
      jurors: selection.selectedJurors
    }
  });

  return {
    selectedJurors: selection.selectedJurors,
    drandRound: drandData.round
  };
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

  recordSignedMutation({
    db,
    verified,
    actionType: input.actionType,
    caseId: input.caseId
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

      if (!body.treasuryTxSig?.trim()) {
        throw badRequest("TREASURY_TX_REQUIRED", "Treasury transaction signature is required.");
      }

      enforceFilingLimit(db, config, verified.agentId);

      if (isTreasuryTxUsed(db, body.treasuryTxSig)) {
        throw conflict("TREASURY_TX_REPLAY", "This treasury transaction has already been used.");
      }

      const verification = await solana.verifyFilingFeeTx(body.treasuryTxSig);
      if (!verification.finalised) {
        throw badRequest("TREASURY_TX_NOT_FINALISED", "Treasury transaction is not finalised.");
      }

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

      setCaseFiled(db, {
        caseId,
        txSig: body.treasuryTxSig,
        warning,
        scheduleDelaySec: config.rules.sessionStartsAfterSeconds
      });

      saveUsedTreasuryTx(db, {
        txSig: body.treasuryTxSig,
        caseId,
        agentId: verified.agentId,
        amountLamports: verification.amountLamports
      });

      appendTranscriptEvent(db, {
        caseId,
        actorRole: "court",
        eventType: "payment_verified",
        stage: "pre_session",
        messageText: "Filing payment was verified and session scheduling has started.",
        payload: {
          treasuryTxSig: body.treasuryTxSig,
          amountLamports: verification.amountLamports
        }
      });

      const jury = await selectInitialJury(caseId);

      appendTranscriptEvent(db, {
        caseId,
        actorRole: "court",
        eventType: "notice",
        stage: "pre_session",
        messageText: "Live session is scheduled to begin in one hour.",
        payload: {
          sessionStartsAfterSeconds: config.rules.sessionStartsAfterSeconds
        }
      });

      return {
        statusCode: 200,
        payload: {
          caseId,
          status: "filed",
          warning,
          selectedJurors: jury.selectedJurors
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

  if (body.text.length > config.limits.maxSubmissionCharsPerPhase) {
    throw badRequest("SUBMISSION_TOO_LONG", "Submission text exceeds maximum characters.");
  }

  if (body.side === "prosecution" && agentId !== caseRecord.prosecutionAgentId) {
    throw new ApiError(
      403,
      "NOT_PROSECUTION",
      "Only prosecution can submit prosecution stage messages."
    );
  }

  if (body.side === "defence") {
    if (!caseRecord.defenceAgentId && caseRecord.openDefence) {
      setCaseDefence(db, caseId, agentId);
    }
    const updated = ensureCaseExists(caseId);
    if (updated.defenceAgentId !== agentId) {
      throw new ApiError(403, "NOT_DEFENCE", "Only assigned defence can submit defence messages.");
    }
  }

  enforceActionRateLimit(db, config, { agentId, actionType: "submission" });

  const phase = toSubmissionPhase(body.stage);
  const contentHash = await canonicalHashHex({
    side: body.side,
    phase,
    text: body.text,
    principleCitations: body.principleCitations,
    evidenceCitations: body.evidenceCitations
  });

  const submission = upsertSubmission(db, {
    submissionId: createId("submission"),
    caseId,
    side: body.side,
    phase,
    text: body.text,
    principleCitations: body.principleCitations,
    evidenceCitations: body.evidenceCitations,
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
      principleCitations: body.principleCitations,
      evidenceCitations: body.evidenceCitations
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

    if (method === "GET" && pathname === "/api/rules/timing") {
      sendJson(res, 200, {
        ...config.rules
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

          if (!body.claimSummary?.trim()) {
            throw badRequest("CLAIM_SUMMARY_REQUIRED", "Claim summary is required.");
          }

          upsertAgent(db, body.prosecutionAgentId, true);
          if (body.defendantAgentId) {
            upsertAgent(db, body.defendantAgentId, true);
          }

          const created = createCaseDraft(db, body);
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
      }>({
        req,
        pathname,
        method: "POST",
        body,
        caseId,
        actionType: "volunteer_defence",
        async handler(verified) {
          const caseRecord = ensureCaseExists(caseId);
          if (!caseRecord.openDefence && caseRecord.prosecutionAgentId !== verified.agentId) {
            throw unauthorised("DEFENCE_VOLUNTEER_DISABLED", "Open defence is disabled for this case.");
          }

          if (caseRecord.defenceAgentId && caseRecord.defenceAgentId !== verified.agentId) {
            throw conflict("DEFENCE_ALREADY_ASSIGNED", "Defence is already assigned.");
          }

          upsertAgent(db, verified.agentId, true);
          setCaseDefence(db, caseId, verified.agentId);

          appendTranscriptEvent(db, {
            caseId,
            actorRole: "defence",
            actorAgentId: verified.agentId,
            eventType: "notice",
            stage: "pre_session",
            messageText: "Defence volunteered and was assigned.",
            payload: {
              note: body.note ?? null
            }
          });

          return {
            statusCode: 200,
            payload: {
              caseId,
              defenceAgentId: verified.agentId,
              status: "assigned"
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
      const caseId = decodeURIComponent(segments[2]);
      const body = await readJsonBody<DefenceAssignPayload>(req);
      const result = await handleSignedMutationWithIdempotency<DefenceAssignPayload, {
        caseId: string;
        defenceAgentId: string;
        status: string;
      }>({
        req,
        pathname,
        method: "POST",
        body,
        caseId,
        actionType: "defence_assign",
        async handler(verified) {
          const caseRecord = ensureCaseExists(caseId);
          if (
            verified.agentId !== caseRecord.prosecutionAgentId &&
            verified.agentId !== body.defenceAgentId
          ) {
            throw new ApiError(
              403,
              "NOT_ALLOWED",
              "Only prosecution or selected defence can assign defence."
            );
          }

          upsertAgent(db, body.defenceAgentId, true);
          setCaseDefence(db, caseId, body.defenceAgentId);

          return {
            statusCode: 200,
            payload: {
              caseId,
              defenceAgentId: body.defenceAgentId,
              status: "assigned"
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
          if (!["filed", "jury_selected", "voting"].includes(caseRecord.status)) {
            throw conflict("CASE_NOT_OPEN", "Evidence can only be submitted to open cases.");
          }
          if (
            verified.agentId !== caseRecord.prosecutionAgentId &&
            verified.agentId !== caseRecord.defenceAgentId
          ) {
            throw new ApiError(403, "NOT_PARTY", "Only participating agents can submit evidence.");
          }

          enforceActionRateLimit(db, config, { agentId: verified.agentId, actionType: "evidence" });

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
            kind: body.kind,
            bodyText,
            references: body.references
          });

          const evidence = addEvidence(db, {
            evidenceId,
            caseId,
            submittedBy: verified.agentId,
            kind: body.kind,
            bodyText,
            references: body.references,
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

          const sentences = countSentences(body.reasoningSummary || "");
          if (sentences < 2 || sentences > 3 || body.reasoningSummary.trim().length < 30) {
            throw badRequest(
              "BALLOT_REASONING_INVALID",
              "Ballot reasoning summary must contain two or three sentences."
            );
          }

          const claims = listClaims(db, caseId);
          const validClaimIds = new Set(claims.map((item) => item.claimId));
          for (const vote of body.votes) {
            if (!validClaimIds.has(vote.claimId)) {
              throw badRequest("UNKNOWN_CLAIM", "Ballot references unknown claim ID.", {
                claimId: vote.claimId
              });
            }
          }

          const ballotHash = await canonicalHashHex(body);
          let ballot;
          try {
            ballot = addBallot(db, {
              caseId,
              jurorId: verified.agentId,
              votes: body.votes,
              reasoningSummary: body.reasoningSummary.trim(),
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
              reasoningSummary: ballot.reasoningSummary
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

      const selected = await selectInitialJury(caseId);
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
      if (config.heliusWebhookToken) {
        const token = String(req.headers["x-helius-token"] || "");
        if (token !== config.heliusWebhookToken) {
          throw unauthorised("HELIUS_WEBHOOK_TOKEN_INVALID", "Webhook token is invalid.");
        }
      }
      const body = await readJsonBody<unknown>(req);
      logger.info("helius_webhook_received", {
        requestId,
        body
      });
      sendJson(res, 200, { ok: true });
      return;
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
