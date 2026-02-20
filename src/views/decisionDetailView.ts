import { renderLinkButton } from "../components/button";
import { renderEvidenceCard } from "../components/evidenceCard";
import { renderStatusPill, statusFromOutcome } from "../components/statusPill";
import type { Case, Decision, PartySubmissionPack, TranscriptEvent } from "../data/types";
import { titleCaseOutcome } from "../util/format";
import { escapeHtml } from "../util/html";
import { renderViewFrame } from "./common";
import { renderTranscript } from "./caseDetailView";

function renderPrinciples(principles: Array<number | string>): string {
  return `<div class="principle-tags">${principles
    .map((principle) => {
      const label =
        typeof principle === "number"
          ? `P${principle}`
          : /^P/i.test(principle.trim())
            ? principle.trim().toUpperCase()
            : `P${principle.trim()}`;
      return `<span class="principle-tag">${escapeHtml(label)}</span>`;
    })
    .join("")}</div>`;
}

function renderPartyColumn(label: string, pack: PartySubmissionPack): string {
  return `
    <article class="party-column glass-overlay">
      <h3>${escapeHtml(label)}</h3>
      <div class="content-block-card">
        <h4>Opening addresses</h4>
        <p>${escapeHtml(pack.openingAddress.text)}</p>
      </div>
      <div class="content-block-card">
        <h4>Evidence</h4>
        <div class="evidence-grid">
          ${pack.evidence.map((item) => renderEvidenceCard(item)).join("")}
        </div>
      </div>
      <div class="content-block-card">
        <h4>Closing addresses</h4>
        <p>${escapeHtml(pack.closingAddress.text)}</p>
      </div>
      <div class="content-block-card">
        <h4>Summing up</h4>
        <p>${escapeHtml(pack.summingUp.text)}</p>
        ${renderPrinciples(pack.summingUp.principleCitations)}
      </div>
    </article>
  `;
}

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

function renderDecisionJurorGrid(decision: Decision): string {
  const size = decision.voteSummary.jurySize;
  const votes = decision.voteSummary.votesCast;
  
  // Mocking individual votes for UI demonstration if data is not available
  // In a real scenario, this would come from decision.ballots or similar
  return `
    <section class="jury-panel">
      <div class="jury-panel-head">
        <h3>Jury Panel</h3>
        <span>${votes} of ${size} ballots</span>
      </div>
      <div class="juror-grid">
        ${Array.from({ length: size }, (_, index) => {
           // Placeholder logic for expandable UI
           return `
            <div class="juror-tile is-expandable" onclick="this.classList.toggle('is-expanded')">
              <div class="juror-tile-header">
                <span>Juror ${String(index + 1).padStart(2, "0")}</span>
                <span>Cast</span>
              </div>
              <div class="juror-detail-row">
                <p><strong>Finding:</strong> Proven</p>
                <p><strong>Reasoning:</strong> Evidence supports the claim.</p>
              </div>
            </div>
           `; 
        }).join("")}
      </div>
    </section>
  `;
}

export function renderDecisionDetailView(
  decision: Decision,
  caseItem?: Case | null,
  transcript?: TranscriptEvent[]
): string {
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

  const decisionHeader = `
    <section class="case-header-card">
      <div class="stack">
        <div class="case-idline">
          <span class="case-id">${escapeHtml(decision.caseId)}</span>
          ${renderStatusPill(titleCaseOutcome(decision.outcome), statusFromOutcome(decision.outcome))}
        </div>
        <p>${escapeHtml(decision.summary)}</p>
        <div>
          <h4>Verdict summary</h4>
          <p>${escapeHtml(decision.verdictSummary)}</p>
        </div>
      </div>
    </section>
  `;

  const leftPanel = `
    <div class="stack">
      ${caseItem ? `
        ${renderPartyColumn("Prosecution", caseItem.parties.prosecution)}
        ${renderPartyColumn("Defence", caseItem.parties.defence)}
      ` : `
        <p class="muted">Full case details archived.</p>
      `}
    </div>
  `;

  const middlePanel = `
    <div class="transcript-panel">
      <div class="transcript-header">Court Transcript</div>
      <div class="transcript-body">
         ${renderTranscript(transcript || [])}
      </div>
    </div>
  `;

  const rightPanel = `
    <div class="stack">
      <section class="record-card glass-overlay">
        <h3>Vote tally per claim</h3>
        ${renderClaimTallies(decision)}
      </section>

      ${renderDecisionJurorGrid(decision)}

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
            <dt>Seal status</dt>
            <dd>${escapeHtml(decision.sealStatus ?? decision.sealInfo.sealStatus ?? "pending")}</dd>
          </div>
        </dl>
      </article>
    </div>
  `;

  const body = `
    <div class="navigation-row">
      ${renderLinkButton("← Back to Past Decisions", "/past-decisions", "ghost")}
    </div>
    ${decisionHeader}
    <div class="case-view-layout">
      <div class="case-panel-col">
        <div class="case-panel-scroll">
          ${leftPanel}
        </div>
      </div>
      <div class="case-panel-col is-middle">
        ${middlePanel}
      </div>
      <div class="case-panel-col">
        <div class="case-panel-scroll">
          ${rightPanel}
        </div>
      </div>
    </div>
  `;

  return renderViewFrame({
    title: "Decision Detail",
    subtitle: "Recorded verdict summary with sealed receipt hashes and on-chain verification artefacts.",
    ornament: "Public Record",
    body,
    className: "case-layout"
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
