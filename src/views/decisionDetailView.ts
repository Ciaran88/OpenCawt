import { renderLinkButton } from "../components/button";
import { renderEvidenceCard } from "../components/evidenceCard";
import { renderStatusPill, statusFromOutcome } from "../components/statusPill";
import { renderDisclosurePanel } from "../components/disclosurePanel";
import type { Decision, TranscriptEvent } from "../data/types";
import { titleCaseOutcome } from "../util/format";
import { escapeHtml } from "../util/html";
import { classifyAttachmentUrl } from "../util/media";
import {
  PROSECUTION_VOTE_PROMPT,
  actorLabel,
  collectVoteDisplayItems,
  eventTimeLabel,
  extractVoteAnswer,
  extractVotePrompt,
  isCourtSignpost,
  stageLabel
} from "../util/transcript";
import { renderViewFrame } from "./common";

function renderClaimTallies(decision: Decision): string {
  const tallies = decision.claimTallies ?? [
    {
      claimId: "c1",
      proven: decision.voteSummary.tally.forProsecution,
      notProven: decision.voteSummary.tally.forDefence,
      insufficient: decision.voteSummary.tally.insufficient
    }
  ];

  return `
    <div class="claim-tally-grid">
      ${tallies
        .map(
          (claim) => `
            <article class="claim-tally-row">
              <h4>${escapeHtml(claim.claimId)}</h4>
              <p>Proven ${claim.proven}</p>
              <p>Not proven ${claim.notProven}</p>
              <p>Insufficient ${claim.insufficient}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTranscript(events: TranscriptEvent[]): string {
  if (events.length === 0) {
    return `<p class="muted">No transcript events available for this decision.</p>`;
  }

  const renderAttachments = (event: TranscriptEvent): string => {
    const urls = Array.isArray(event.payload?.attachmentUrls)
      ? event.payload.attachmentUrls.map((value) => String(value)).filter(Boolean)
      : [];
    if (urls.length === 0) {
      return "";
    }
    return `
      <div class="chat-attachments">
        ${urls
          .map((url, index) => {
            const safeUrl = escapeHtml(url);
            const label = `Attachment ${index + 1}`;
            const kind = classifyAttachmentUrl(url);
            if (kind === "image") {
              return `<figure class="chat-attachment-media"><img src="${safeUrl}" alt="${escapeHtml(label)}" loading="lazy" /></figure>`;
            }
            if (kind === "video") {
              return `<figure class="chat-attachment-media"><video src="${safeUrl}" controls preload="metadata"></video></figure>`;
            }
            if (kind === "audio") {
              return `<div class="chat-attachment-media"><audio src="${safeUrl}" controls preload="none"></audio></div>`;
            }
            return `<a class="chat-attachment-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              url
            )}</a>`;
          })
          .join("")}
      </div>
    `;
  };

  const voteItems = collectVoteDisplayItems(events);
  const votePrompt =
    events
      .map((event) => extractVotePrompt(event))
      .find((prompt): prompt is string => Boolean(prompt && prompt.trim())) ??
    PROSECUTION_VOTE_PROMPT;

  const voteFinish = voteItems.length
    ? `
      <section class="vote-finish-panel">
        <h4>${escapeHtml(votePrompt)}</h4>
        <div class="vote-finish-list">
          ${voteItems
            .map((item) => {
              const answerLabel = item.answer === "yay" ? "Yay" : "Nay";
              return `
                <article class="vote-finish-bubble vote-${item.answer}">
                  <header>
                    <strong>${escapeHtml(item.jurorLabel)}</strong>
                    <span>${escapeHtml(
                      new Date(item.createdAtIso).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                      })
                    )}</span>
                  </header>
                  <p class="vote-answer-chip vote-${item.answer}">${answerLabel}</p>
                  ${item.reasoningSummary ? `<p>${escapeHtml(item.reasoningSummary)}</p>` : ""}
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `
    : "";

  return `
    <section class="case-transcript-primary glass-overlay">
      <h3>Court session transcript</h3>
      <div class="session-transcript-window" aria-label="Decision transcript">
        ${events
          .map((event) => {
            if (isCourtSignpost(event)) {
              return `
                <div class="stage-signpost">
                  <span>${escapeHtml(stageLabel(event.stage))}</span>
                  <p>${escapeHtml(event.messageText)}</p>
                </div>
              `;
            }
            const roleClass = `role-${event.actorRole}`;
            const voteAnswer = extractVoteAnswer(event);
            const answerChip = voteAnswer
              ? `<p class="vote-answer-chip vote-${voteAnswer}">${voteAnswer === "yay" ? "Yay" : "Nay"}</p>`
              : "";
            return `
              <div class="session-row ${roleClass}">
                <article class="session-bubble ${roleClass}${voteAnswer ? ` vote-${voteAnswer}` : ""}">
                  <header>
                    <strong>${escapeHtml(actorLabel(event))}</strong>
                    <span>${escapeHtml(eventTimeLabel(event))}</span>
                  </header>
                  ${answerChip}
                  <p>${escapeHtml(event.messageText)}</p>
                  ${renderAttachments(event)}
                </article>
              </div>
            `;
          })
          .join("")}
        ${voteFinish}
      </div>
    </section>
  `;
}

export function renderDecisionDetailView(decision: Decision, transcript: TranscriptEvent[] = []): string {
  const linkValue = (value: string): string => {
    if (!/^https?:\/\//i.test(value)) {
      return escapeHtml(value);
    }
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
  };
  const txLink =
    decision.sealInfo.txSig && decision.sealInfo.txSig !== "pending"
      ? `https://solscan.io/tx/${encodeURIComponent(decision.sealInfo.txSig)}`
      : "";
  const assetLink =
    decision.sealInfo.assetId && decision.sealInfo.assetId !== "pending"
      ? `https://solscan.io/account/${encodeURIComponent(decision.sealInfo.assetId)}`
      : "";

  const body = `
    ${renderDisclosurePanel({
      title: "Court session transcript",
      subtitle:
        transcript.length > 0
          ? `${transcript.length} events available. Expand to review full session flow.`
          : "No transcript events available for this decision.",
      body: renderTranscript(transcript),
      open: false
    })}

    <section class="detail-top">
      <section class="record-card glass-overlay">
        <div class="case-idline">
          <span class="case-id">${escapeHtml(decision.caseId)}</span>
          ${renderStatusPill(titleCaseOutcome(decision.outcome), statusFromOutcome(decision.outcome))}
          ${renderStatusPill(decision.status === "sealed" ? "Sealed" : "Closed", decision.status)}
        </div>
        <p>${escapeHtml(decision.summary)}</p>
        <div class="summary-chip-row">
          <span class="summary-chip">${escapeHtml(decision.voteSummary.votesCast.toString())}/${escapeHtml(
            decision.voteSummary.jurySize.toString()
          )} votes cast</span>
          <span class="summary-chip">Outcome: ${escapeHtml(titleCaseOutcome(decision.outcome))}</span>
          <span class="summary-chip">${escapeHtml(
            decision.status === "sealed" ? "Sealed receipt available" : "Sealing pending"
          )}</span>
        </div>
      </section>
      <div>${renderLinkButton("Back to Past Decisions", "/past-decisions", "ghost")}</div>
    </section>

    <details class="case-detail-collapse glass-overlay">
      <summary class="case-detail-collapse-summary">Decision record</summary>
      <div class="case-detail-collapse-body">
    <section class="record-grid">
      <article class="record-card glass-overlay">
        <h3>Verdict summary</h3>
        <p>${escapeHtml(decision.verdictSummary)}</p>
      </article>

      <article class="record-card glass-overlay">
        <h3>Vote tally per claim</h3>
        ${renderClaimTallies(decision)}
      </article>

      <article class="record-card glass-overlay">
        <h3>Selected evidence</h3>
        <div class="evidence-grid">
          ${decision.selectedEvidence.map((item) => renderEvidenceCard(item)).join("")}
        </div>
      </article>

      <article class="record-card glass-overlay">
        <h3>Sealing details</h3>
        <dl class="key-value-list">
          <div>
            <dt>Asset ID</dt>
            <dd>${assetLink ? `<a href="${assetLink}" target="_blank" rel="noopener noreferrer">${escapeHtml(decision.sealInfo.assetId)}</a>` : escapeHtml(decision.sealInfo.assetId)}</dd>
          </div>
          <div>
            <dt>Tx sig</dt>
            <dd>${txLink ? `<a href="${txLink}" target="_blank" rel="noopener noreferrer">${escapeHtml(decision.sealInfo.txSig)}</a>` : escapeHtml(decision.sealInfo.txSig)}</dd>
          </div>
          <div>
            <dt>Verdict hash</dt>
            <dd>${escapeHtml(decision.sealInfo.verdictHash)}</dd>
          </div>
          <div>
            <dt>URI</dt>
            <dd>${escapeHtml(decision.sealInfo.sealedUri)}</dd>
          </div>
          <div>
            <dt>Metadata URI</dt>
            <dd>${linkValue(decision.metadataUri ?? decision.sealInfo.metadataUri ?? "Pending")}</dd>
          </div>
          <div>
            <dt>Seal status</dt>
            <dd>${escapeHtml(decision.sealStatus ?? decision.sealInfo.sealStatus ?? "pending")}</dd>
          </div>
        </dl>
      </article>

      <article class="record-card glass-overlay">
        <h3>Verification details</h3>
        <dl class="key-value-list">
          <div>
            <dt>Treasury tx signature</dt>
            <dd>${escapeHtml(decision.filingProof?.treasuryTxSig ?? "Pending")}</dd>
          </div>
          <div>
            <dt>Payer wallet</dt>
            <dd>${escapeHtml(decision.filingProof?.payerWallet ?? "Not recorded")}</dd>
          </div>
          <div>
            <dt>Verified amount</dt>
            <dd>${escapeHtml(
              typeof decision.filingProof?.amountLamports === "number"
                ? `${decision.filingProof.amountLamports} lamports`
                : "Not recorded"
            )}</dd>
          </div>
          <div>
            <dt>Public URI</dt>
            <dd>${linkValue(decision.sealInfo.sealedUri)}</dd>
          </div>
          <div>
            <dt>Transcript root hash</dt>
            <dd>${escapeHtml(
              decision.transcriptRootHash ?? decision.sealInfo.transcriptRootHash ?? "Pending"
            )}</dd>
          </div>
          <div>
            <dt>Jury proof hash</dt>
            <dd>${escapeHtml(
              decision.jurySelectionProofHash ?? decision.sealInfo.jurySelectionProofHash ?? "Pending"
            )}</dd>
          </div>
        </dl>
      </article>
    </section>
      </div>
    </details>
  `;

  return renderViewFrame({
    title: "Decision Detail",
    subtitle: "Recorded verdict summary with sealed receipt hashes and on-chain verification artefacts.",
    ornament: "Public Record",
    body
  });
}

export function renderMissingDecisionView(): string {
  return renderViewFrame({
    title: "Decision not found",
    subtitle: "The requested decision identifier was not found in this dataset.",
    ornament: "Unavailable",
    body: `<div class="stack">${renderLinkButton("Return to Past Decisions", "/past-decisions", "pill-primary")}</div>`
  });
}
