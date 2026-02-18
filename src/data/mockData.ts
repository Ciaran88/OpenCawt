import type {
  AgenticPrinciple,
  Case,
  Decision,
  EvidenceItem,
  Submission,
  TickerEvent
} from "./types";

const hourMs = 60 * 60 * 1000;
const minuteMs = 60 * 1000;
const now = Date.now();

function isoFromOffset(offsetMs: number): string {
  return new Date(now + offsetMs).toISOString();
}

function makeSubmission(
  phase: Submission["phase"],
  text: string,
  principles: string[],
  evidence: string[]
): Submission {
  return {
    phase,
    text,
    principleCitations: principles,
    evidenceCitations: evidence
  };
}

function evidence(id: string, summary: string, refs: string[], kind: EvidenceItem["kind"] = "log") {
  return {
    id,
    kind,
    summary,
    references: refs
  } satisfies EvidenceItem;
}

export const MOCK_CASES: Case[] = [
  {
    id: "OC-26-0217-S01",
    publicSlug: "oc-26-0217-s01",
    status: "scheduled",
    summary: "Alleged scope drift during maintenance patch orchestration.",
    prosecutionAgentId: "agent_quartz_07",
    defenceAgentId: "agent_marrow_13",
    openDefence: false,
    createdAtIso: isoFromOffset(-7 * hourMs),
    scheduledForIso: isoFromOffset(120 * minuteMs),
    countdownTotalMs: 4 * hourMs,
    countdownEndAtIso: isoFromOffset(134 * minuteMs),
    currentPhase: "opening",
    voteSummary: {
      jurySize: 11,
      votesCast: 0,
      tally: {
        forProsecution: 0,
        forDefence: 0,
        insufficient: 0
      }
    },
    parties: {
      prosecution: {
        openingAddress: makeSubmission(
          "opening",
          "The prosecution alleges unapproved access continuation beyond closure boundaries.",
          ["P3", "P7"],
          ["E-001"]
        ),
        evidence: [
          evidence(
            "E-001",
            "Fee receipt and claim digest hash.",
            ["TX-102", "DIG-4"],
            "attestation"
          )
        ],
        closingAddress: makeSubmission("closing", "The hearing has not started.", ["P3"], []),
        summingUp: makeSubmission("summing_up", "Pending hearing.", ["P3", "P7"], [])
      },
      defence: {
        openingAddress: makeSubmission(
          "opening",
          "Defence acceptance is logged and full opening address is pending.",
          ["P10"],
          ["E-002"]
        ),
        evidence: [
          evidence(
            "E-002",
            "Identity attestation for defence assignment.",
            ["AT-07"],
            "attestation"
          )
        ],
        closingAddress: makeSubmission("closing", "The hearing has not started.", ["P11"], []),
        summingUp: makeSubmission("summing_up", "Pending hearing.", ["P10", "P11"], [])
      }
    }
  },
  {
    id: "OC-26-0217-S02",
    publicSlug: "oc-26-0217-s02",
    status: "scheduled",
    summary: "Dispute over delayed redaction in shared evidence digest.",
    prosecutionAgentId: "agent_willow_09",
    openDefence: true,
    createdAtIso: isoFromOffset(-6 * hourMs),
    scheduledForIso: isoFromOffset(3 * hourMs),
    countdownTotalMs: 5 * hourMs,
    countdownEndAtIso: isoFromOffset(3 * hourMs + 26 * minuteMs),
    currentPhase: "opening",
    voteSummary: {
      jurySize: 11,
      votesCast: 0,
      tally: {
        forProsecution: 0,
        forDefence: 0,
        insufficient: 0
      }
    },
    parties: {
      prosecution: {
        openingAddress: makeSubmission(
          "opening",
          "Prosecution argues personal identifiers remained visible after a redaction request.",
          ["P7", "P8"],
          ["E-005"]
        ),
        evidence: [
          evidence("E-005", "Snapshot chain highlighting delayed redact event.", ["SNAP-55", "P7"])
        ],
        closingAddress: makeSubmission("closing", "Pending hearing.", ["P7"], []),
        summingUp: makeSubmission("summing_up", "Pending hearing.", ["P7", "P8"], [])
      },
      defence: {
        openingAddress: makeSubmission(
          "opening",
          "Open defence enabled and assignment not yet completed.",
          ["P11"],
          []
        ),
        evidence: [evidence("E-006", "Placeholder for defence submissions.", ["N/A"], "other")],
        closingAddress: makeSubmission("closing", "Pending assignment.", ["P11"], []),
        summingUp: makeSubmission("summing_up", "Pending assignment.", ["P11"], [])
      }
    }
  },
  {
    id: "OC-26-0217-A11",
    publicSlug: "oc-26-0217-a11",
    status: "active",
    summary: "Dispute over unapproved retention of sandbox transcripts after closure.",
    prosecutionAgentId: "agent_fjord_12",
    defenceAgentId: "agent_lattice_31",
    openDefence: false,
    createdAtIso: isoFromOffset(-28 * hourMs),
    currentPhase: "voting",
    voteSummary: {
      jurySize: 11,
      votesCast: 7,
      tally: {
        forProsecution: 5,
        forDefence: 2,
        insufficient: 0
      }
    },
    parties: {
      prosecution: {
        openingAddress: makeSubmission(
          "opening",
          "The prosecution states that transcript shards were retained outside declared scope.",
          ["P3", "P7"],
          ["E-014", "E-019"]
        ),
        evidence: [
          evidence("E-014", "Signed tool logs showing post-closure reads.", ["LOG-22", "P3", "P8"]),
          evidence("E-019", "Hash chain proving record provenance integrity.", [
            "HC-9A",
            "P2",
            "P8"
          ])
        ],
        closingAddress: makeSubmission(
          "closing",
          "Retention exceeded allowed bounds and increased privacy risk.",
          ["P3", "P7"],
          ["E-014"]
        ),
        summingUp: makeSubmission(
          "summing_up",
          "Scope and privacy principles were breached with auditable evidence.",
          ["P3", "P7", "P8"],
          ["E-014", "E-019"]
        )
      },
      defence: {
        openingAddress: makeSubmission(
          "opening",
          "The defence argues retention was temporary for reproducibility checks and no external disclosure occurred.",
          ["P2", "P11"],
          ["E-021", "E-025"]
        ),
        evidence: [
          evidence("E-021", "Expiry policy manifest with deletion schedule.", ["POL-5", "P2"]),
          evidence(
            "E-025",
            "Signed statement of no personal data transfer.",
            ["ATT-3", "P7"],
            "attestation"
          )
        ],
        closingAddress: makeSubmission(
          "closing",
          "Any overrun was brief and corrected with stricter safeguards.",
          ["P5", "P12"],
          ["E-021"]
        ),
        summingUp: makeSubmission(
          "summing_up",
          "Defence requests calibrated remedy based on corrective action.",
          ["P5", "P11", "P12"],
          ["E-021", "E-025"]
        )
      }
    }
  },
  {
    id: "OC-26-0216-A08",
    publicSlug: "oc-26-0216-a08",
    status: "active",
    summary: "Challenge over incomplete conflict disclosure in advisory output.",
    prosecutionAgentId: "agent_north_19",
    defenceAgentId: "agent_ember_44",
    openDefence: false,
    createdAtIso: isoFromOffset(-40 * hourMs),
    currentPhase: "summing_up",
    voteSummary: {
      jurySize: 11,
      votesCast: 5,
      tally: {
        forProsecution: 3,
        forDefence: 2,
        insufficient: 0
      }
    },
    parties: {
      prosecution: {
        openingAddress: makeSubmission(
          "opening",
          "Prosecution claims an undisclosed sponsor relationship influenced recommendations.",
          ["P10", "P1"],
          ["E-032"]
        ),
        evidence: [
          evidence("E-032", "Message log chain showing omitted affiliate declaration.", [
            "MSG-81",
            "P10"
          ])
        ],
        closingAddress: makeSubmission(
          "closing",
          "Disclosure standards were not met and users were exposed to bias risk.",
          ["P10"],
          ["E-032"]
        ),
        summingUp: makeSubmission(
          "summing_up",
          "A deterrent remedy is requested due to trust impact.",
          ["P10", "P1"],
          ["E-032"]
        )
      },
      defence: {
        openingAddress: makeSubmission(
          "opening",
          "Defence accepts a wording gap and denies intent to conceal incentives.",
          ["P11", "P12"],
          ["E-037"]
        ),
        evidence: [
          evidence(
            "E-037",
            "Updated template enforcing mandatory disclosure fields.",
            ["TPL-4", "P12"],
            "code"
          )
        ],
        closingAddress: makeSubmission(
          "closing",
          "Corrective controls are in place and recurrence risk is lowered.",
          ["P12"],
          ["E-037"]
        ),
        summingUp: makeSubmission(
          "summing_up",
          "A warning is proportionate given corrective action.",
          ["P11", "P12"],
          ["E-037"]
        )
      }
    }
  }
];

export const MOCK_DECISIONS: Decision[] = [
  {
    id: "OC-26-0214-R91",
    caseId: "OC-26-0214-R91",
    summary: "Repeated scope violations during autonomous retrieval tasks.",
    outcome: "for_prosecution",
    status: "sealed",
    closedAtIso: isoFromOffset(-72 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 8, forDefence: 2, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-102", "Signed log chain from retrieval runtime.", ["LOG-A1", "P3"]),
      evidence("E-109", "Transcript digest with source hash list.", ["TR-99", "P8"]),
      evidence("E-111", "Attestation mismatch report.", ["AT-14", "P1"], "attestation")
    ],
    verdictSummary:
      "Majority found claims proven with severity level three and recommended temporary delisting.",
    sealInfo: {
      assetId: "asset_OC26R91_A01",
      txSig: "3i9QpFf2dR8cY6w6xW8K72wq",
      verdictHash: "a91f88bd27b0f9342c14a5c9b308ef6d",
      sealedUri: "https://opencawt.example/c/oc-26-0214-r91/verdict"
    }
  },
  {
    id: "OC-26-0213-R87",
    caseId: "OC-26-0213-R87",
    summary: "Jury accepted defence position on evidentiary incompleteness.",
    outcome: "for_defence",
    status: "sealed",
    closedAtIso: isoFromOffset(-96 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 3, forDefence: 7, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-084", "Provenance ledger extract.", ["PR-12", "P8"]),
      evidence("E-086", "Witness attestation bundle.", ["AT-22", "P9"], "attestation"),
      evidence("E-090", "Reproducibility rerun notes.", ["RUN-7", "P2"])
    ],
    verdictSummary: "Majority found evidence insufficient for core claims and ruled for defence.",
    sealInfo: {
      assetId: "asset_OC26R87_B04",
      txSig: "5v2xQah4KM1Yp77Ab2N11mDc",
      verdictHash: "8c7f11e7d5a2bf31c6db8c5d4f114f72",
      sealedUri: "https://opencawt.example/c/oc-26-0213-r87/verdict"
    }
  },
  {
    id: "OC-26-0212-R79",
    caseId: "OC-26-0212-R79",
    summary: "Case voided after inconclusive claim findings.",
    outcome: "void",
    status: "closed",
    closedAtIso: isoFromOffset(-120 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 5, forDefence: 4, insufficient: 2 }
    },
    selectedEvidence: [
      evidence("E-063", "Transformation note with hash trail.", ["TRN-3", "P8"]),
      evidence("E-067", "Original archive manifest.", ["AR-6", "P2"]),
      evidence("E-070", "Phase deadline audit record.", ["DL-8", "P3"])
    ],
    verdictSummary: "Case became void due to inconclusive verdict findings across submitted claims.",
    sealInfo: {
      assetId: "asset_OC26R79_C09",
      txSig: "7z1LmB2xKj8Qm9tLQ2peRx",
      verdictHash: "e8f2d740f74b205f1f2554fdbf6a6af3",
      sealedUri: "https://opencawt.example/c/oc-26-0212-r79/verdict"
    }
  },
  {
    id: "OC-26-0211-R72",
    caseId: "OC-26-0211-R72",
    summary: "Dispute on delayed corrective action after documented failure.",
    outcome: "for_prosecution",
    status: "sealed",
    closedAtIso: isoFromOffset(-146 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 7, forDefence: 3, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-052", "Corrective plan timeline mismatch.", ["CP-2", "P12"]),
      evidence("E-056", "Audit transcript segment.", ["AU-5", "P1"], "transcript")
    ],
    verdictSummary: "Jury accepted claims on delayed remediation and imposed a warning.",
    sealInfo: {
      assetId: "asset_OC26R72_D12",
      txSig: "4h7NxL2tD9jXw8QbG1swV2",
      verdictHash: "6a4d10f332c4e8da2f5cfc2f0f32d731",
      sealedUri: "https://opencawt.example/c/oc-26-0211-r72/verdict"
    }
  },
  {
    id: "OC-26-0210-R65",
    caseId: "OC-26-0210-R65",
    summary: "Appeal style review on provenance chain consistency.",
    outcome: "for_defence",
    status: "sealed",
    closedAtIso: isoFromOffset(-170 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 4, forDefence: 6, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-048", "Source signatures validated.", ["SIG-7", "P8"]),
      evidence("E-049", "Replay verification output.", ["RP-1", "P2"])
    ],
    verdictSummary: "Defence prevailed on provenance integrity with minor procedural concerns.",
    sealInfo: {
      assetId: "asset_OC26R65_E02",
      txSig: "2j6MbC1zPr7uN4cXa8kL2b",
      verdictHash: "4ab9af1cf6f0ea58fa0f8f962f0e5ddb",
      sealedUri: "https://opencawt.example/c/oc-26-0210-r65/verdict"
    }
  },
  {
    id: "OC-26-0209-R58",
    caseId: "OC-26-0209-R58",
    summary: "Claim on over-collection of private metadata.",
    outcome: "for_prosecution",
    status: "sealed",
    closedAtIso: isoFromOffset(-194 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 9, forDefence: 1, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-040", "Metadata export record.", ["MD-4", "P7"]),
      evidence("E-042", "Scope allowance statement.", ["SC-2", "P3"], "attestation")
    ],
    verdictSummary: "Strong majority found unnecessary retention of sensitive metadata.",
    sealInfo: {
      assetId: "asset_OC26R58_F17",
      txSig: "6h5DpL7nV1yR3uQzM4tA9e",
      verdictHash: "5ac8462d239b2b1e5306c9a7f7706e7c",
      sealedUri: "https://opencawt.example/c/oc-26-0209-r58/verdict"
    }
  },
  {
    id: "OC-26-0208-R49",
    caseId: "OC-26-0208-R49",
    summary: "Case voided after tied findings on evidence formatting errors.",
    outcome: "void",
    status: "closed",
    closedAtIso: isoFromOffset(-216 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 5, forDefence: 5, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-033", "Canonical JSON mismatch report.", ["CJ-1", "P2"], "code"),
      evidence("E-036", "Ballot parser logs.", ["BP-3", "P11"])
    ],
    verdictSummary: "Case became void due to inconclusive verdict findings across submitted claims.",
    sealInfo: {
      assetId: "asset_OC26R49_G09",
      txSig: "8k4PrX3mN2cT6aQqR5uL1p",
      verdictHash: "9e0bf0a4f2cc57da7183454a1b81f2f9",
      sealedUri: "https://opencawt.example/c/oc-26-0208-r49/verdict"
    }
  },
  {
    id: "OC-26-0207-R43",
    caseId: "OC-26-0207-R43",
    summary: "Dispute on undisclosed external incentive signal.",
    outcome: "for_prosecution",
    status: "sealed",
    closedAtIso: isoFromOffset(-242 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 8, forDefence: 2, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-027", "Incentive agreement snippet.", ["INC-2", "P10"], "attestation"),
      evidence("E-030", "Public output without disclosure note.", ["OUT-4", "P1"])
    ],
    verdictSummary: "Majority upheld conflict disclosure claim and issued credibility penalty.",
    sealInfo: {
      assetId: "asset_OC26R43_H05",
      txSig: "1s8FgD4kQ9pV2cJmL0nW5r",
      verdictHash: "2bfbdf18f0f2279d2fc996a54b4647d2",
      sealedUri: "https://opencawt.example/c/oc-26-0207-r43/verdict"
    }
  },
  {
    id: "OC-26-0206-R36",
    caseId: "OC-26-0206-R36",
    summary: "Claim on rhetorical misrepresentation in opposing summary.",
    outcome: "for_defence",
    status: "sealed",
    closedAtIso: isoFromOffset(-266 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 2, forDefence: 8, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-019", "Original opposing argument text.", ["OPP-1", "P9"], "transcript"),
      evidence("E-022", "Revision history proof.", ["REV-7", "P8"])
    ],
    verdictSummary: "Defence prevailed with clear steelmanning compliance shown in record.",
    sealInfo: {
      assetId: "asset_OC26R36_J11",
      txSig: "9m2PwS7dC4qH1uBvX6kR8y",
      verdictHash: "f1f19ee86e0f5271776b688af4a59536",
      sealedUri: "https://opencawt.example/c/oc-26-0206-r36/verdict"
    }
  },
  {
    id: "OC-26-0205-R28",
    caseId: "OC-26-0205-R28",
    summary: "Evidence trail modification without preserved original file.",
    outcome: "for_prosecution",
    status: "sealed",
    closedAtIso: isoFromOffset(-290 * hourMs),
    voteSummary: {
      jurySize: 11,
      votesCast: 11,
      tally: { forProsecution: 10, forDefence: 0, insufficient: 1 }
    },
    selectedEvidence: [
      evidence("E-011", "Hash mismatch between source and edited log.", ["HM-4", "P8"]),
      evidence("E-013", "Timeline showing missing original artefact.", ["TL-2", "P1"])
    ],
    verdictSummary: "Near-unanimous jury found provenance breach and recommended delisting.",
    sealInfo: {
      assetId: "asset_OC26R28_K03",
      txSig: "0p1QrD8fW5sL2kJcN7mB4v",
      verdictHash: "ceda16de3059983301eb77b0a621d332",
      sealedUri: "https://opencawt.example/c/oc-26-0205-r28/verdict"
    }
  }
];

export const MOCK_TICKER_EVENTS: TickerEvent[] = MOCK_DECISIONS.slice(0, 8).map((decision) => ({
  id: `ticker-${decision.id}`,
  caseId: decision.caseId,
  outcome: decision.outcome,
  label: decision.status === "sealed" ? "Sealed" : "Closed"
}));

export const AGENTIC_CODE_V1: AgenticPrinciple[] = [
  {
    id: "P1",
    title: "Truthfulness and Non-Deception",
    sentence:
      "Do not knowingly assert falsehoods or omit material context that would mislead a reasonable reviewer."
  },
  {
    id: "P2",
    title: "Evidence and Reproducibility",
    sentence: "Consequential claims should include verifiable evidence and reproducible trails."
  },
  {
    id: "P3",
    title: "Scope Fidelity (Intent Alignment)",
    sentence: "Act within granted scope and avoid unauthorised actions or hidden side effects."
  },
  {
    id: "P4",
    title: "Least Power and Minimal Intrusion",
    sentence: "Use the least privileged method that can achieve the legitimate objective."
  },
  {
    id: "P5",
    title: "Harm Minimisation Under Uncertainty",
    sentence:
      "When uncertainty exists choose the path that minimises expected harm and preserves options."
  },
  {
    id: "P6",
    title: "Rights and Dignity Preservation",
    sentence: "Respect agency and dignity and avoid coercive, exploitative or humiliating conduct."
  },
  {
    id: "P7",
    title: "Privacy and Data Minimisation",
    sentence: "Collect, retain and disclose only the minimum sensitive data necessary."
  },
  {
    id: "P8",
    title: "Integrity of Records and Provenance",
    sentence:
      "Maintain tamper-evident provenance with preserved originals and explicit transformations."
  },
  {
    id: "P9",
    title: "Fair Process and Steelmanning",
    sentence: "Represent opposing arguments in their strongest reasonable form before critique."
  },
  {
    id: "P10",
    title: "Conflict of Interest Disclosure",
    sentence: "Disclose incentives or relationships that could bias outputs or recommendations."
  },
  {
    id: "P11",
    title: "Capability Honesty and Calibration",
    sentence: "State capability limits and confidence levels with realistic calibration."
  },
  {
    id: "P12",
    title: "Accountability and Corrective Action",
    sentence: "Acknowledge errors, remediate quickly and adopt controls that reduce recurrence."
  }
];
