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

async function issueCapabilityToken(
  baseUrl: string,
  systemApiKey: string,
  agentId: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/internal/capabilities/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-System-Key": systemApiKey
    },
    body: JSON.stringify({
      agentId,
      scope: "writes",
      ttlSeconds: 3600
    })
  });
  const body = (await response.json()) as { capabilityToken?: string; error?: { message?: string } };
  if (!response.ok || !body.capabilityToken) {
    throw new Error(`Failed to issue capability for ${agentId}: ${body.error?.message ?? response.status}`);
  }
  return body.capabilityToken;
}

async function registerAgent(
  baseUrl: string,
  agent: SmokeAgent,
  capabilityToken?: string
): Promise<void> {
  await signedPost({
    baseUrl,
    path: "/api/agents/register",
    payload: {
      agentId: agent.agentId,
      jurorEligible: true
    },
    agent,
    idempotencyKey: `register:${agent.agentId}`,
    capabilityToken
  });
}

async function joinJuryPool(
  baseUrl: string,
  juror: SmokeAgent,
  capabilityToken?: string
): Promise<void> {
  await signedPost({
    baseUrl,
    path: "/api/jury-pool/join",
    payload: {
      agentId: juror.agentId,
      availability: "available",
      profile: "Smoke juror"
    },
    agent: juror,
    idempotencyKey: `join:${juror.agentId}`,
    capabilityToken
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
  const systemApiKey = "smoke-system-key";
  const server = startNodeTsxProcess("smoke-api", "server/main.ts", {
    API_HOST: apiHost,
    API_PORT: apiPort,
    DB_PATH: dbPath,
    SYSTEM_API_KEY: systemApiKey,
    CAPABILITY_KEYS_ENABLED: "true",
    COURT_MODE: "11-juror",
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
    const capabilityByAgent = new Map<string, string>();
    const allAgents: SmokeAgent[] = [prosecution, defence, ...jurors];
    for (const agent of allAgents) {
      capabilityByAgent.set(
        agent.agentId,
        await issueCapabilityToken(baseUrl, systemApiKey, agent.agentId)
      );
    }
    const capabilityFor = (agent: SmokeAgent): string => capabilityByAgent.get(agent.agentId) ?? "";

    await registerAgent(baseUrl, prosecution, capabilityFor(prosecution));
    await registerAgent(baseUrl, defence, capabilityFor(defence));
    for (const juror of jurors) {
      await registerAgent(baseUrl, juror, capabilityFor(juror));
      await joinJuryPool(baseUrl, juror, capabilityFor(juror));
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
      idempotencyKey: "draft:smoke",
      capabilityToken: capabilityFor(prosecution)
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
          caseId,
          capabilityToken: capabilityFor(prosecution)
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
      idempotencyKey: `file:${caseId}`,
      capabilityToken: capabilityFor(prosecution)
    });
    assert.equal(file.caseId, caseId);
    assert.ok(file.selectedJurors.length >= 11, "Expected at least 11 selected jurors.");

    await signedPost({
      baseUrl,
      path: `/api/cases/${encodeURIComponent(caseId)}/volunteer-defence`,
      payload: {
        note: "Smoke defence volunteer"
      },
      agent: defence,
      caseId,
      idempotencyKey: `volunteer:${caseId}`,
      capabilityToken: capabilityFor(defence)
    });

    await pollStage(baseUrl, caseId, "jury_readiness");

    const selectedJurorAgents = file.selectedJurors
      .map((jurorId) => jurors.find((item) => item.agentId === jurorId))
      .filter(Boolean) as SmokeAgent[];
    assert.ok(selectedJurorAgents.length >= 11, "Expected local keys for selected jurors.");
    const firstSelectedJuror = selectedJurorAgents[0];
    assert.ok(firstSelectedJuror, "Expected at least one selected juror.");

    for (const juror of selectedJurorAgents) {
      await signedPost({
        baseUrl,
        path: `/api/cases/${encodeURIComponent(caseId)}/juror-ready`,
        payload: {
          ready: true
        },
        agent: juror,
        caseId,
        idempotencyKey: `ready:${caseId}:${juror.agentId}`,
        capabilityToken: capabilityFor(juror)
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
          idempotencyKey: `evidence:${caseId}:pros`,
          capabilityToken: capabilityFor(prosecution)
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
        idempotencyKey: `stage:${caseId}:pros:${stage}`,
        capabilityToken: capabilityFor(prosecution)
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
        idempotencyKey: `stage:${caseId}:def:${stage}`,
        capabilityToken: capabilityFor(defence)
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
          agent: firstSelectedJuror,
          caseId,
          capabilityToken: capabilityFor(firstSelectedJuror)
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
        idempotencyKey: `ballot:${caseId}:${juror.agentId}`,
        capabilityToken: capabilityFor(juror)
      });
    }

    const assigned = await signedPost<{ cases: Array<{ caseId: string }> }>({
      baseUrl,
      path: "/api/jury/assigned",
      payload: {
        agentId: firstSelectedJuror.agentId
      },
      agent: firstSelectedJuror,
      capabilityToken: capabilityFor(firstSelectedJuror)
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
        payload?: {
          attachmentUrls?: string[];
          votePrompt?: string;
          voteAnswer?: "yay" | "nay";
        };
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

    const votingPromptEvent = transcript.events.find(
      (event) => event.eventType === "notice" && event.payload?.votePrompt === "Do you side with the prosecution on this case?"
    );
    assert.ok(votingPromptEvent, "Expected transcript to include voting prompt signpost.");

    const ballotEvents = transcript.events.filter((event) => event.eventType === "ballot_submitted");
    if (ballotEvents.length > 0) {
      assert.ok(
        ballotEvents.every(
          (event) => event.payload?.voteAnswer === "yay" || event.payload?.voteAnswer === "nay"
        ),
        "Expected each ballot transcript event to include voteAnswer."
      );
    }

    process.stdout.write("OpenClaw participation smoke passed\n");
  } finally {
    await stopProcess(server);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
