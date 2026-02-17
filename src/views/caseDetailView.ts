import type { AppState } from "../app/state";
import { renderLinkButton, renderPrimaryPillButton } from "../components/button";
import { renderEvidenceCard } from "../components/evidenceCard";
import { renderJurorGrid } from "../components/jurorGrid";
import { renderStatusPill, statusFromCase } from "../components/statusPill";
import { renderStepper } from "../components/stepper";
import type { Case, PartySubmissionPack, SessionStage, TranscriptEvent } from "../data/types";
import { escapeHtml } from "../util/html";
import { renderViewFrame } from "./common";

function renderPrinciples(principles: string[]): string {
  return `<div class="principle-tags">${principles
    .map((principle) => `<span class="principle-tag">${escapeHtml(principle)}</span>`)
    .join("")}</div>`;
}

function renderPartyColumn(label: string, pack: PartySubmissionPack): string {
  return `
    <article class="party-column glass-overlay">
      <h3>${escapeHtml(label)}</h3>
      <section>
        <h4>Opening addresses</h4>
        <p>${escapeHtml(pack.openingAddress.text)}</p>
      </section>
      <section>
        <h4>Evidence</h4>
        <div class="evidence-grid">
          ${pack.evidence.map((item) => renderEvidenceCard(item)).join("")}
        </div>
      </section>
      <section>
        <h4>Closing addresses</h4>
        <p>${escapeHtml(pack.closingAddress.text)}</p>
      </section>
      <section>
        <h4>Summing up</h4>
        <p>${escapeHtml(pack.summingUp.text)}</p>
        ${renderPrinciples(pack.summingUp.principleCitations)}
      </section>
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

function renderTranscript(events: TranscriptEvent[]): string {
  if (events.length === 0) {
    return `<p class="muted">No transcript events yet.</p>`;
  }

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
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderStageMessageForm(caseId: string, stage?: SessionStage): string {
  const allowed = stage && ["opening_addresses", "evidence", "closing_addresses", "summing_up"].includes(stage);
  if (!allowed) {
    return "";
  }

  return `
    <section class="form-card glass-overlay">
      <h3>Submit stage message</h3>
      <form id="submit-stage-message-form" class="stack">
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
        ${renderPrimaryPillButton("Submit stage message", { type: "submit" })}
      </form>
    </section>
  `;
}

function renderReadinessForm(caseId: string, stage?: SessionStage): string {
  if (stage !== "jury_readiness") {
    return "";
  }

  return `
    <section class="form-card glass-overlay">
      <h3>Juror readiness</h3>
      <p>If you are selected you must confirm within one minute.</p>
      <form id="juror-ready-form" class="stack">
        <input type="hidden" name="caseId" value="${escapeHtml(caseId)}" />
        <label>
          <span>Optional note</span>
          <input type="text" name="note" placeholder="Ready for session" />
        </label>
        ${renderPrimaryPillButton("Confirm readiness", { type: "submit" })}
      </form>
    </section>
  `;
}

export function renderCaseDetailView(state: AppState, caseItem: Case): string {
  const liveVotes = state.liveVotes[caseItem.id] ?? caseItem.voteSummary.votesCast;
  const claimId = `${caseItem.id}-c1`;
  const session = state.caseSessions[caseItem.id] ?? caseItem.session;
  const transcript = state.transcripts[caseItem.id] ?? [];

  const top = `
    <section class="detail-top">
      <div>
        <div class="case-idline">
          <span class="case-id">${escapeHtml(caseItem.id)}</span>
          ${renderStatusPill(
            caseItem.status === "active" ? "Active" : "Scheduled",
            statusFromCase(caseItem.status)
          )}
        </div>
        <p>${escapeHtml(caseItem.summary)}</p>
      </div>
      <div class="detail-meta">
        <span><strong>Prosecution</strong> ${escapeHtml(caseItem.prosecutionAgentId)}</span>
        <span><strong>Defence</strong> ${escapeHtml(caseItem.defenceAgentId ?? "Open defence")}</span>
        <span><strong>Stage</strong> ${escapeHtml(toStageLabel(session?.currentStage))}</span>
        <span><strong>Timer</strong> ${escapeHtml(timeRemainingLabel(state.nowMs, session?.stageDeadlineAtIso || session?.votingHardDeadlineAtIso || session?.scheduledSessionStartAtIso))}</span>
        ${renderLinkButton("Back to Schedule", "/schedule", "ghost")}
      </div>
    </section>
  `;

  const body = `
    ${top}
    ${renderStepper(caseItem.currentPhase)}
    <section class="party-grid">
      ${renderPartyColumn("Prosecution", caseItem.parties.prosecution)}
      ${renderPartyColumn("Defence", caseItem.parties.defence)}
    </section>
    ${renderJurorGrid({
      caseId: caseItem.id,
      jurySize: caseItem.voteSummary.jurySize,
      votesCast: liveVotes
    })}
    ${renderReadinessForm(caseItem.id, session?.currentStage)}
    ${renderStageMessageForm(caseItem.id, session?.currentStage)}
    <section class="transcript-card glass-overlay">
      <h3>Live transcript</h3>
      ${renderTranscript(transcript)}
    </section>
    ${
      caseItem.status === "active"
        ? `
      <section class="form-card glass-overlay">
        <h3>Juror ballot</h3>
        <p>Ballots require a two to three sentence reasoning summary.</p>
        <form id="submit-ballot-form" class="stack">
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
          ${renderPrimaryPillButton("Submit ballot", { type: "submit" })}
        </form>
      </section>
      `
        : ""
    }
  `;

  return renderViewFrame({
    title: "Case Detail",
    subtitle: "Structured proceedings with stage authority, transcript events and jury progress.",
    ornament: "Adjudication Timeline",
    body
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
