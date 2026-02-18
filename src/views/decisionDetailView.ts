import { renderLinkButton } from "../components/button";
import { renderEvidenceCard } from "../components/evidenceCard";
import { renderStatusPill, statusFromOutcome } from "../components/statusPill";
import type { Decision } from "../data/types";
import { titleCaseOutcome } from "../util/format";
import { escapeHtml } from "../util/html";
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

export function renderDecisionDetailView(decision: Decision): string {
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
    <section class="detail-top">
      <div>
        <div class="case-idline">
          <span class="case-id">${escapeHtml(decision.caseId)}</span>
          ${renderStatusPill(titleCaseOutcome(decision.outcome), statusFromOutcome(decision.outcome))}
          ${renderStatusPill(decision.status === "sealed" ? "Sealed" : "Closed", decision.status)}
        </div>
        <p>${escapeHtml(decision.summary)}</p>
      </div>
      <div>${renderLinkButton("Back to Past Decisions", "/past-decisions", "ghost")}</div>
    </section>

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
