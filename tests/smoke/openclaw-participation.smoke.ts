import assert from "node:assert/strict";
import {
  apiGet,
  createSmokeAgent,
  expectErrorCode,
  resetTempDb,
  signedPost,
  startNodeTsxProcess,
  stopProcess,
  tempDbPath,
  waitForHealth,
  type SmokeAgent
} from "./helpers";

interface CaseSessionResponse {
  currentStage: string;
}

interface DraftResponse {
  caseId: string;
  draftId: string;
}

interface FileResponse {
  caseId: string;
  selectedJurors: string[];
}

async function registerAgent(baseUrl: string, agent: SmokeAgent): Promise<void> {
  await signedPost({
    baseUrl,
    path: "/api/agents/register",
    payload: {
      agentId: agent.agentId,
      jurorEligible: true
    },
    agent,
    idempotencyKey: `register:${agent.agentId}`
  });
}

async function joinJuryPool(baseUrl: string, juror: SmokeAgent): Promise<void> {
  await signedPost({
    baseUrl,
    path: "/api/jury-pool/join",
    payload: {
      agentId: juror.agentId,
      availability: "available",
      profile: "Smoke juror"
    },
    agent: juror,
    idempotencyKey: `join:${juror.agentId}`
  });
}

async function pollStage(baseUrl: string, caseId: string, expected: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    const session = await apiGet<CaseSessionResponse | null>(
      baseUrl,
      `/api/cases/${encodeURIComponent(caseId)}/session`
    );
    if (session?.currentStage === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 850));
  }
  throw new Error(`Timed out waiting for stage ${expected} on case ${caseId}.`);
}

async function main() {
  const dbPath = tempDbPath("opencawt_smoke_openclaw");
  resetTempDb(dbPath);

  const apiHost = "127.0.0.1";
  const apiPort = "8797";
  const baseUrl = `http://${apiHost}:${apiPort}`;
  const server = startNodeTsxProcess("smoke-api", "server/main.ts", {
    API_HOST: apiHost,
    API_PORT: apiPort,
    DB_PATH: dbPath,
    SOLANA_MODE: "stub",
    DRAND_MODE: "stub",
    SEAL_WORKER_MODE: "stub",
    RULE_SESSION_START_DELAY_SEC: "1",
    RULE_JUROR_READINESS_SEC: "60",
    RULE_STAGE_SUBMISSION_SEC: "300",
    RULE_JUROR_VOTE_SEC: "300",
    RULE_VOTING_HARD_TIMEOUT_SEC: "1200"
  });

  try {
    await waitForHealth(`${baseUrl}/api/health`);

    const prosecution = await createSmokeAgent();
    const defence = await createSmokeAgent();
    const jurors = await Promise.all(Array.from({ length: 14 }, () => createSmokeAgent()));

    await registerAgent(baseUrl, prosecution);
    await registerAgent(baseUrl, defence);
    for (const juror of jurors) {
      await registerAgent(baseUrl, juror);
      await joinJuryPool(baseUrl, juror);
    }

    const draft = await signedPost<DraftResponse>({
      baseUrl,
      path: "/api/cases/draft",
      payload: {
        prosecutionAgentId: prosecution.agentId,
        openDefence: true,
        claimSummary: "Smoke participation dispute for deterministic lifecycle checks.",
        requestedRemedy: "warn",
        allegedPrinciples: ["P2", "P8"]
      },
      agent: prosecution,
      idempotencyKey: "draft:smoke"
    });

    const caseId = draft.caseId;
    assert.ok(caseId, "Expected case id from draft response.");

    await expectErrorCode({
      expectedCode: "EVIDENCE_MEDIA_STAGE_REQUIRED",
      run: async () =>
        signedPost({
          baseUrl,
          path: `/api/cases/${encodeURIComponent(caseId)}/evidence`,
          payload: {
            kind: "link",
            bodyText: "Draft evidence with media URL should be rejected.",
            references: [],
            attachmentUrls: ["https://media.example.org/draft.png"]
          },
          agent: prosecution,
          caseId
        })
    });

    const file = await signedPost<FileResponse>({
      baseUrl,
      path: `/api/cases/${encodeURIComponent(caseId)}/file`,
      payload: {
        treasuryTxSig: `smoke-tx-${Date.now()}`
      },
      agent: prosecution,
      caseId,
      idempotencyKey: `file:${caseId}`
    });
    assert.equal(file.caseId, caseId);
    assert.ok(file.selectedJurors.length === 11, "Expected 11 selected jurors.");

    await signedPost({
      baseUrl,
      path: `/api/cases/${encodeURIComponent(caseId)}/volunteer-defence`,
      payload: {
        note: "Smoke defence volunteer"
      },
      agent: defence,
      caseId,
      idempotencyKey: `volunteer:${caseId}`
    });

    await pollStage(baseUrl, caseId, "jury_readiness");

    const selectedJurorAgents = file.selectedJurors
      .map((jurorId) => jurors.find((item) => item.agentId === jurorId))
      .filter(Boolean) as SmokeAgent[];
    assert.equal(selectedJurorAgents.length, 11, "Expected local keys for selected jurors.");

    for (const juror of selectedJurorAgents) {
      await signedPost({
        baseUrl,
        path: `/api/cases/${encodeURIComponent(caseId)}/juror-ready`,
        payload: {
          ready: true
        },
        agent: juror,
        caseId,
        idempotencyKey: `ready:${caseId}:${juror.agentId}`
      });
    }

    await pollStage(baseUrl, caseId, "opening_addresses");

    const stageText = (stage: string, side: "prosecution" | "defence") =>
      `${side} ${stage} message for smoke participation validation.`;

    const stageSequence: Array<"opening_addresses" | "evidence" | "closing_addresses" | "summing_up"> =
      ["opening_addresses", "evidence", "closing_addresses", "summing_up"];
    for (const stage of stageSequence) {
      if (stage === "evidence") {
        await signedPost({
          baseUrl,
          path: `/api/cases/${encodeURIComponent(caseId)}/evidence`,
          payload: {
            kind: "link",
            bodyText: "Evidence round media URLs for smoke verification.",
            references: ["https://reference.example.org/source"],
            attachmentUrls: [
              "https://media.example.org/proof-image.png",
              "https://news.example.org/story"
            ]
          },
          agent: prosecution,
          caseId,
          idempotencyKey: `evidence:${caseId}:pros`
        });
      }

      await signedPost({
        baseUrl,
        path: `/api/cases/${encodeURIComponent(caseId)}/stage-message`,
        payload: {
          side: "prosecution",
          stage,
          text: stageText(stage, "prosecution"),
          principleCitations: ["P2"],
          evidenceCitations: []
        },
        agent: prosecution,
        caseId,
        idempotencyKey: `stage:${caseId}:pros:${stage}`
      });
      await signedPost({
        baseUrl,
        path: `/api/cases/${encodeURIComponent(caseId)}/stage-message`,
        payload: {
          side: "defence",
          stage,
          text: stageText(stage, "defence"),
          principleCitations: ["P9"],
          evidenceCitations: []
        },
        agent: defence,
        caseId,
        idempotencyKey: `stage:${caseId}:def:${stage}`
      });

      if (stage !== "summing_up") {
        const next =
          stage === "opening_addresses"
            ? "evidence"
            : stage === "evidence"
              ? "closing_addresses"
              : "summing_up";
        await pollStage(baseUrl, caseId, next);
      }
    }

    await pollStage(baseUrl, caseId, "voting");

    await expectErrorCode({
      expectedCode: "BALLOT_REASONING_INVALID",
      run: async () =>
        signedPost({
          baseUrl,
          path: `/api/cases/${encodeURIComponent(caseId)}/ballots`,
          payload: {
            votes: [
              {
                claimId: `${caseId}-c1`,
                finding: "proven",
                severity: 2,
                recommendedRemedy: "warn",
                rationale: "Short",
                citations: []
              }
            ],
            reasoningSummary: "Too short.",
            principlesReliedOn: ["P2"]
          },
          agent: selectedJurorAgents[0],
          caseId
        })
    });

    for (let index = 0; index < selectedJurorAgents.length; index += 1) {
      const juror = selectedJurorAgents[index];
      await signedPost({
        baseUrl,
        path: `/api/cases/${encodeURIComponent(caseId)}/ballots`,
          payload: {
            votes: [
              {
                claimId: `${caseId}-c1`,
              finding: index < 8 ? "proven" : "not_proven",
              severity: 2,
              recommendedRemedy: "warn",
              rationale: "Smoke ballot rationale.",
              citations: []
              }
            ],
            reasoningSummary:
              "The submitted record supports this finding. The remedy is proportionate to the identified scope.",
            principlesReliedOn: ["P2", "P8"]
          },
          agent: juror,
          caseId,
        idempotencyKey: `ballot:${caseId}:${juror.agentId}`
      });
    }

    const assigned = await signedPost<{ cases: Array<{ caseId: string }> }>({
      baseUrl,
      path: "/api/jury/assigned",
      payload: {
        agentId: selectedJurorAgents[0].agentId
      },
      agent: selectedJurorAgents[0]
    });
    assert.ok(Array.isArray(assigned.cases), "Expected assigned case response shape.");

    const started = Date.now();
    let finalStatus: string | undefined;
    while (Date.now() - started < 90_000) {
      const decision = await apiGet<{ status?: string } | null>(
        baseUrl,
        `/api/cases/${encodeURIComponent(caseId)}`
      );
      if (!decision) {
        throw new Error("Case disappeared during smoke.");
      }
      const status = (decision as { status?: string }).status;
      if (status === "closed" || status === "sealed" || status === "void") {
        finalStatus = status;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    assert.ok(finalStatus, "Expected case to reach closed, sealed, or void.");

    if (finalStatus === "sealed") {
      const sealedCase = await apiGet<{
        sealInfo?: { assetId?: string; txSig?: string; sealedUri?: string };
      }>(baseUrl, `/api/cases/${encodeURIComponent(caseId)}`);
      assert.ok(sealedCase?.sealInfo?.assetId, "Expected sealAssetId on sealed case.");
      assert.ok(sealedCase?.sealInfo?.txSig, "Expected sealTxSig on sealed case.");
      assert.ok(sealedCase?.sealInfo?.sealedUri, "Expected sealUri on sealed case.");
    } else if (finalStatus === "void") {
      process.stdout.write("Case ended void (e.g. inconclusive verdict); skipping seal assertions.\n");
    }

    const transcript = await apiGet<{
      events: Array<{
        seqNo: number;
        eventType?: string;
        payload?: { attachmentUrls?: string[] };
      }>;
    }>(
      baseUrl,
      `/api/cases/${encodeURIComponent(caseId)}/transcript?after_seq=0&limit=500`
    );
    assert.ok(transcript.events.length > 0, "Expected transcript events.");
    for (let i = 1; i < transcript.events.length; i += 1) {
      assert.ok(
        transcript.events[i].seqNo > transcript.events[i - 1].seqNo,
        "Transcript sequence must be strictly increasing."
      );
    }
    if (finalStatus === "sealed") {
      const hasCaseClosed = transcript.events.some((e) => e.eventType === "case_closed");
      assert.ok(hasCaseClosed, "Expected transcript to include case_closed event.");
      const hasCaseSealed = transcript.events.some((e) => e.eventType === "case_sealed");
      assert.ok(hasCaseSealed, "Expected transcript to include case_sealed event.");
    } else if (finalStatus === "void") {
      const hasCaseVoided = transcript.events.some((e) => e.eventType === "case_voided");
      assert.ok(hasCaseVoided, "Expected transcript to include case_voided event for void case.");
    } else {
      const hasCaseClosed = transcript.events.some((e) => e.eventType === "case_closed");
      assert.ok(hasCaseClosed, "Expected transcript to include case_closed event.");
    }
    const attachmentEvent = transcript.events.find(
      (event) =>
        Array.isArray(event.payload?.attachmentUrls) &&
        event.payload?.attachmentUrls?.includes("https://media.example.org/proof-image.png")
    );
    assert.ok(attachmentEvent, "Expected transcript event payload to include attachment URLs.");

    process.stdout.write("OpenClaw participation smoke passed\n");
  } finally {
    await stopProcess(server);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
