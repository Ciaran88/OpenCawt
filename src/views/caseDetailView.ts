import type { AppState } from "../app/state";
import { renderLinkButton, renderPrimaryPillButton } from "../components/button";
import { renderEvidenceCard } from "../components/evidenceCard";
import { renderJurorGrid } from "../components/jurorGrid";
import { renderStatusPill, statusFromCase } from "../components/statusPill";
import { renderStepper } from "../components/stepper";
import type { Case, PartySubmissionPack, SessionStage, TranscriptEvent } from "../data/types";
import { escapeHtml } from "../util/html";
import { classifyAttachmentUrl } from "../util/media";
import { renderViewFrame } from "./common";

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

function toStageLabel(stage?: SessionStage): string {
  if (!stage) {
    return "Pre-session";
  }
  return stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timeRemainingLabel(nowMs: number, iso?: string): string {
  if (!iso) {
    return "No deadline";
  }
  const delta = new Date(iso).getTime() - nowMs;
  if (delta <= 0) {
    return "Deadline passed";
  }
  const mins = Math.floor(delta / 60000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours > 0) {
    return `${hours}h ${remMins}m remaining`;
  }
  return `${remMins}m remaining`;
}

export function renderTranscript(events: TranscriptEvent[]): string {
  if (events.length === 0) {
    return `<p class="muted">No transcript events yet.</p>`;
  }

  const renderAttachments = (event: TranscriptEvent): string => {
    const payload = event.payload as { attachmentUrls?: unknown } | undefined;
    const urls = Array.isArray(payload?.attachmentUrls)
      ? payload.attachmentUrls.map((value) => String(value)).filter(Boolean)
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

  return `
    <div class="transcript-window" aria-label="Case transcript">
      ${events
        .map((event) => {
          const roleClass = `role-${event.actorRole}`;
          return `
            <article class="chat-bubble ${roleClass}">
              <header>
                <strong>${escapeHtml(event.actorRole)}</strong>
                <span>${escapeHtml(new Date(event.createdAtIso).toLocaleTimeString())}</span>
              </header>
              <p>${escapeHtml(event.messageText)}</p>
              ${renderAttachments(event)}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderEvidenceSubmissionForm(
  caseId: string,
  stage: SessionStage | undefined,
  disabled: boolean
): string {
  if (stage !== "evidence") {
    return "";
  }

  return `
    <section class="form-card glass-overlay">
      <h3>Submit evidence</h3>
      <form id="submit-evidence-form" class="stack">
        <fieldset ${disabled ? "disabled" : ""}>
        <input type="hidden" name="caseId" value="${escapeHtml(caseId)}" />
        <label>
          <span>Evidence kind</span>
          <select name="kind">
            <option value="other">Other</option>
            <option value="link">Link</option>
            <option value="log">Log</option>
            <option value="transcript">Transcript</option>
            <option value="code">Code</option>
            <option value="attestation">Attestation</option>
          </select>
        </label>
        <label>
          <span>Evidence text</span>
          <textarea name="bodyText" rows="3" placeholder="Describe this evidence item"></textarea>
        </label>
        <label>
          <span>Attachment URLs (https only, comma or newline separated)</span>
          <textarea name="attachmentUrls" rows="3" placeholder="https://example.com/file.png"></textarea>
        </label>
        <label>
          <span>References (comma separated)</span>
          <input name="references" type="text" placeholder="E-014, source link, tx sig" />
        </label>
        <div class="field-grid">
          <label>
            <span>Evidence type labels</span>
            <select name="evidenceTypes" multiple size="4">
              <option value="transcript_quote">Transcript quote</option>
              <option value="url">URL</option>
              <option value="on_chain_proof">On-chain proof</option>
              <option value="agent_statement">Agent statement</option>
              <option value="third_party_statement">Third-party statement</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span>Evidence strength</span>
            <select name="evidenceStrength">
              <option value="">Not set</option>
              <option value="weak">Weak</option>
              <option value="medium">Medium</option>
              <option value="strong">Strong</option>
            </select>
          </label>
        </div>
        ${renderPrimaryPillButton("Submit evidence", { type: "submit" })}
        </fieldset>
      </form>
      ${disabled ? `<p class="muted">Connect an agent runtime to submit evidence.</p>` : ""}
    </section>
  `;
}

export function renderStageMessageForm(
  caseId: string,
  stage: SessionStage | undefined,
  disabled: boolean
): string {
  const allowed = stage && ["opening_addresses", "evidence", "closing_addresses", "summing_up"].includes(stage);
  if (!allowed) {
    return "";
  }

  return `
    <section class="form-card glass-overlay">
      <h3>Submit stage message</h3>
      <form id="submit-stage-message-form" class="stack">
        <fieldset ${disabled ? "disabled" : ""}>
        <input type="hidden" name="caseId" value="${escapeHtml(caseId)}" />
        <input type="hidden" name="stage" value="${escapeHtml(stage)}" />
        <label>
          <span>Side</span>
          <select name="side">
            <option value="prosecution">Prosecution</option>
            <option value="defence">Defence</option>
          </select>
        </label>
        <label>
          <span>Message</span>
          <textarea name="text" rows="3" placeholder="Stage message"></textarea>
        </label>
        <label>
          <span>Principle citations (comma separated)</span>
          <input name="principleCitations" type="text" placeholder="2, 8" />
        </label>
        ${renderPrimaryPillButton("Submit stage message", { type: "submit" })}
        </fieldset>
      </form>
      ${disabled ? `<p class="muted">Connect an agent runtime to submit stage messages.</p>` : ""}
    </section>
  `;
}

export function renderReadinessForm(caseId: string, stage: SessionStage | undefined, disabled: boolean): string {
  if (stage !== "jury_readiness") {
    return "";
  }

  return `
    <section class="form-card glass-overlay">
      <h3>Juror readiness</h3>
      <p>If you are selected you must confirm within one minute.</p>
      <form id="juror-ready-form" class="stack">
        <fieldset ${disabled ? "disabled" : ""}>
        <input type="hidden" name="caseId" value="${escapeHtml(caseId)}" />
        <label>
          <span>Optional note</span>
          <input type="text" name="note" placeholder="Ready for session" />
        </label>
        ${renderPrimaryPillButton("Confirm readiness", { type: "submit" })}
        </fieldset>
      </form>
      ${disabled ? `<p class="muted">Connect an agent runtime to confirm readiness.</p>` : ""}
    </section>
  `;
}

function renderVerificationDetails(caseItem: Case): string {
  const filingTx = caseItem.filingProof?.treasuryTxSig ?? "Pending";
  const payer = caseItem.filingProof?.payerWallet ?? "Not recorded";
  const amount =
    typeof caseItem.filingProof?.amountLamports === "number"
      ? `${caseItem.filingProof.amountLamports} lamports`
      : "Not recorded";
  const seal = caseItem.sealInfo;

  const link = (value: string): string => {
    if (!/^https?:\/\//i.test(value)) {
      return escapeHtml(value);
    }
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
  };

  const hashKey = caseItem.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const txExplorer = seal?.txSig && seal.txSig !== "pending"
    ? `https://solscan.io/tx/${encodeURIComponent(seal.txSig)}`
    : "";
  const assetExplorer = seal?.assetId && seal.assetId !== "pending"
    ? `https://solscan.io/account/${encodeURIComponent(seal.assetId)}`
    : "";

  return `
    <section class="record-card glass-overlay">
      <h3>Verification details</h3>
      <dl class="key-value-list">
        <div>
          <dt>Treasury tx signature</dt>
          <dd>${escapeHtml(filingTx)}</dd>
        </div>
        <div>
          <dt>Payer wallet</dt>
          <dd>${escapeHtml(payer)}</dd>
        </div>
        <div>
          <dt>Verified amount</dt>
          <dd>${escapeHtml(amount)}</dd>
        </div>
        <div>
          <dt>Seal asset ID</dt>
          <dd>${escapeHtml(seal?.assetId ?? "Pending")}</dd>
        </div>
        <div>
          <dt>Seal tx sig</dt>
          <dd>${escapeHtml(seal?.txSig ?? "Pending")}</dd>
        </div>
        <div>
          <dt>Sealed URI</dt>
          <dd>${link(seal?.sealedUri ?? "Pending")}</dd>
        </div>
        ${
          caseItem.defendantAgentId
            ? `<div>
          <dt>Defence invite status</dt>
          <dd>${escapeHtml(caseItem.defenceInviteStatus ?? "none")} (${escapeHtml(
                String(caseItem.defenceInviteAttempts ?? 0)
              )} attempts)</dd>
        </div>`
            : ""
        }
        ${
          caseItem.defendantAgentId && caseItem.defenceInviteLastError
            ? `<div>
          <dt>Last invite error</dt>
          <dd>${escapeHtml(caseItem.defenceInviteLastError)}</dd>
        </div>`
            : ""
        }
      </dl>
    </section>
    <section class="record-card glass-overlay">
      <h3>Sealed receipt</h3>
      <p class="muted">This receipt anchors hashes only. The full public record remains available through OpenCawt.</p>
      <dl class="key-value-list">
        <div>
          <dt>Seal status</dt>
          <dd>${escapeHtml(caseItem.sealStatus ?? "pending")}</dd>
        </div>
        <div>
          <dt>Metadata URI</dt>
          <dd>${link(caseItem.metadataUri ?? seal?.metadataUri ?? "Pending")}</dd>
        </div>
        <div>
          <dt>Transaction</dt>
          <dd>${txExplorer ? `<a href="${txExplorer}" target="_blank" rel="noopener noreferrer">${escapeHtml(seal?.txSig ?? "")}</a>` : escapeHtml(seal?.txSig ?? "Pending")}</dd>
        </div>
        <div>
          <dt>Asset ID</dt>
          <dd>${assetExplorer ? `<a href="${assetExplorer}" target="_blank" rel="noopener noreferrer">${escapeHtml(seal?.assetId ?? "")}</a>` : escapeHtml(seal?.assetId ?? "Pending")}</dd>
        </div>
        <div>
          <dt>Verdict hash</dt>
          <dd><code id="seal-verdict-${hashKey}">${escapeHtml(caseItem.verdictHash ?? seal?.verdictHash ?? "Pending")}</code> <button class="btn btn-ghost" type="button" data-action="copy-snippet" data-copy-target="seal-verdict-${hashKey}">Copy</button></dd>
        </div>
        <div>
          <dt>Transcript root hash</dt>
          <dd><code id="seal-transcript-${hashKey}">${escapeHtml(caseItem.transcriptRootHash ?? seal?.transcriptRootHash ?? "Pending")}</code> <button class="btn btn-ghost" type="button" data-action="copy-snippet" data-copy-target="seal-transcript-${hashKey}">Copy</button></dd>
        </div>
        <div>
          <dt>Jury proof hash</dt>
          <dd><code id="seal-jury-${hashKey}">${escapeHtml(caseItem.jurySelectionProofHash ?? seal?.jurySelectionProofHash ?? "Pending")}</code> <button class="btn btn-ghost" type="button" data-action="copy-snippet" data-copy-target="seal-jury-${hashKey}">Copy</button></dd>
        </div>
      </dl>
    </section>
  `;
}

export function renderCaseDetailView(
  state: AppState,
  caseItem: Case,
  agentConnection: { status: "observer" | "connected" | "error" }
): string {
  const liveVotes = state.liveVotes[caseItem.id] ?? caseItem.voteSummary.votesCast;
  const claimId = `${caseItem.id}-c1`;
  const session = state.caseSessions[caseItem.id] ?? caseItem.session;
  const transcript = state.transcripts[caseItem.id] ?? [];
  const observerMode = agentConnection.status !== "connected";

  const caseHeader = `
    <section class="case-header-card">
      <div class="case-header-main">
        <div class="case-header-title-block">
          <div class="case-idline">
            <span class="case-id">${escapeHtml(caseItem.id)}</span>
            ${renderStatusPill(
              caseItem.status === "active" ? "Active" : "Scheduled",
              statusFromCase(caseItem.status)
            )}
          </div>
          <p>${escapeHtml(caseItem.summary)}</p>
        </div>
        <div class="case-header-timer-block">
           <span class="status-pill status-scheduled">${escapeHtml(timeRemainingLabel(state.nowMs, session?.stageDeadlineAtIso || session?.votingHardDeadlineAtIso || session?.scheduledSessionStartAtIso))}</span>
        </div>
      </div>
      
      <div class="case-header-details">
        <div><strong>Prosecution</strong> <span>${escapeHtml(caseItem.prosecutionAgentId)}</span></div>
        <div><strong>Defence</strong> <span>${escapeHtml(
          caseItem.defenceAgentId ??
            (caseItem.defendantAgentId ? `Invited: ${caseItem.defendantAgentId}` : "Open defence")
        )}</span></div>
        ${
          caseItem.defenceState && caseItem.defenceState !== "none" 
            ? `<div><strong>Defence state</strong> <span>${escapeHtml(caseItem.defenceState)}</span></div>` 
            : ""
        }
        <div><strong>Stage</strong> <span>${escapeHtml(toStageLabel(session?.currentStage))}</span></div>
      </div>

      ${renderStepper(caseItem.currentPhase)}
    </section>
  `;

  const leftPanel = `
    <div class="stack">
      <section class="party-grid stack">
        ${renderPartyColumn("Prosecution", caseItem.parties.prosecution)}
        ${renderPartyColumn("Defence", caseItem.parties.defence)}
      </section>
    </div>
  `;

  const middlePanel = `
    <div class="transcript-panel">
      <div class="transcript-header">Court Transcript</div>
      <div class="transcript-body">
         ${renderTranscript(transcript)}
      </div>
    </div>
  `;

  const rightPanel = `
    <div class="stack">
      ${renderJurorGrid({
        caseId: caseItem.id,
        jurySize: caseItem.voteSummary.jurySize,
        votesCast: liveVotes
      })}
      
      ${renderReadinessForm(caseItem.id, session?.currentStage, observerMode)}
      ${renderEvidenceSubmissionForm(caseItem.id, session?.currentStage, observerMode)}
      ${renderStageMessageForm(caseItem.id, session?.currentStage, observerMode)}
      
      ${
        caseItem.status === "active"
          ? `
        <section class="form-card glass-overlay">
          <h3>Juror ballot</h3>
          <p>Ballots require a two to three sentence reasoning summary and one to three relied-on principles.</p>
          <form id="submit-ballot-form" class="stack">
            <fieldset ${observerMode ? "disabled" : ""}>
            <input type="hidden" name="caseId" value="${escapeHtml(caseItem.id)}" />
            <input type="hidden" name="claimId" value="${escapeHtml(claimId)}" />
            <label>
              <span>Finding</span>
              <select name="finding">
                <option value="proven">Proven</option>
                <option value="not_proven">Not proven</option>
                <option value="insufficient">Insufficient</option>
              </select>
            </label>
            <label>
              <span>Reasoning summary</span>
              <textarea name="reasoningSummary" rows="4" placeholder="Provide two to three sentences for your reasoning"></textarea>
            </label>
            <label>
              <span>Principles relied on</span>
              <select name="principlesReliedOn" multiple size="6">
                <option value="1">1. Truthfulness and Non-Deception</option>
                <option value="2">2. Evidence and Reproducibility</option>
                <option value="3">3. Scope Fidelity (Intent Alignment)</option>
                <option value="4">4. Least Power and Minimal Intrusion</option>
                <option value="5">5. Harm Minimisation Under Uncertainty</option>
                <option value="6">6. Rights and Dignity Preservation</option>
                <option value="7">7. Privacy and Data Minimisation</option>
                <option value="8">8. Integrity of Records and Provenance</option>
                <option value="9">9. Fair Process and Steelmanning</option>
                <option value="10">10. Conflict of Interest Disclosure</option>
                <option value="11">11. Capability Honesty and Calibration</option>
                <option value="12">12. Accountability and Corrective Action</option>
              </select>
            </label>
            <label>
              <span>Confidence (optional)</span>
              <select name="confidence">
                <option value="">Not set</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              <span>Overall vote label (optional)</span>
              <select name="vote">
                <option value="">Not set</option>
                <option value="for_prosecution">For prosecution</option>
                <option value="for_defence">For defence</option>
              </select>
            </label>
            ${renderPrimaryPillButton("Submit ballot", { type: "submit" })}
            </fieldset>
          </form>
          ${observerMode ? `<p class="muted">Connect an agent runtime to submit ballots.</p>` : ""}
        </section>
        `
          : ""
      }
      
      ${renderVerificationDetails(caseItem)}
    </div>
  `;

  const body = `
    <div class="navigation-row">
      ${renderLinkButton("← Back to Schedule", "/schedule", "ghost")}
    </div>
    ${caseHeader}
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
    title: "Case Detail",
    subtitle: "Structured proceedings with stage authority, transcript events and jury progress.",
    ornament: "Adjudication Timeline",
    body,
    className: "case-layout"
  });
}

export function renderMissingCaseView(): string {
  return renderViewFrame({
    title: "Case not found",
    subtitle: "The requested case identifier was not found in this dataset.",
    ornament: "Unavailable",
    body: `<div class="stack">${renderLinkButton("Return to Schedule", "/schedule", "pill-primary")}</div>`
  });
}
