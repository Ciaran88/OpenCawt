import type { SessionStage, TranscriptEvent, TranscriptVoteAnswer } from "../data/types";

export const PROSECUTION_VOTE_PROMPT = "Do you side with the prosecution on this case?";

function fromVoteLabel(value: unknown): TranscriptVoteAnswer | null {
  if (value === "for_prosecution") {
    return "yay";
  }
  if (value === "for_defence") {
    return "nay";
  }
  return null;
}

function fromMessage(value: string): TranscriptVoteAnswer | null {
  const normalised = value.toLowerCase();
  if (
    normalised.includes("yay") ||
    normalised.includes("for prosecution") ||
    normalised.includes("prosecution finding")
  ) {
    return "yay";
  }
  if (
    normalised.includes("nay") ||
    normalised.includes("for defence") ||
    normalised.includes("defence finding") ||
    normalised.includes("not proven")
  ) {
    return "nay";
  }
  return null;
}

export function stageLabel(stage?: SessionStage): string {
  if (!stage) {
    return "General";
  }
  return stage.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isCourtSignpost(event: TranscriptEvent): boolean {
  return (
    event.actorRole === "court" &&
    (event.eventType === "stage_started" ||
      event.eventType === "stage_completed" ||
      event.eventType === "stage_deadline")
  );
}

export function actorLabel(event: TranscriptEvent): string {
  if (event.actorRole === "juror") {
    if (!event.actorAgentId) {
      return "Juror";
    }
    return `Juror ${event.actorAgentId.slice(0, 6)}`;
  }
  if (event.actorRole === "court") {
    return "Court";
  }
  if (event.actorRole === "prosecution") {
    return "Prosecution";
  }
  if (event.actorRole === "defence") {
    return "Defence";
  }
  return "System";
}

export function eventTimeLabel(event: TranscriptEvent): string {
  return new Date(event.createdAtIso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function extractVotePrompt(event: TranscriptEvent): string | null {
  const payloadPrompt =
    typeof event.payload?.votePrompt === "string" ? event.payload.votePrompt.trim() : "";
  if (payloadPrompt) {
    return payloadPrompt;
  }
  if (event.stage === "voting" && event.actorRole === "court" && event.eventType === "notice") {
    return event.messageText.trim() || PROSECUTION_VOTE_PROMPT;
  }
  return null;
}

export function extractVoteAnswer(event: TranscriptEvent): TranscriptVoteAnswer | null {
  if (event.eventType !== "ballot_submitted") {
    return null;
  }
  const payloadAnswer = event.payload?.voteAnswer;
  if (payloadAnswer === "yay" || payloadAnswer === "nay") {
    return payloadAnswer;
  }

  const fromLabel = fromVoteLabel(event.payload?.voteLabel);
  if (fromLabel) {
    return fromLabel;
  }

  return fromMessage(event.messageText);
}

export interface TranscriptVoteDisplayItem {
  eventId: string;
  jurorLabel: string;
  answer: TranscriptVoteAnswer;
  reasoningSummary?: string;
  createdAtIso: string;
}

export function collectVoteDisplayItems(events: TranscriptEvent[]): TranscriptVoteDisplayItem[] {
  const items: TranscriptVoteDisplayItem[] = [];
  for (const event of events) {
    const answer = extractVoteAnswer(event);
    if (!answer) {
      continue;
    }
    const reasoningSummary =
      typeof event.payload?.reasoningSummary === "string"
        ? event.payload.reasoningSummary.trim()
        : "";
    items.push({
      eventId: event.eventId,
      jurorLabel: actorLabel(event),
      answer,
      reasoningSummary: reasoningSummary || undefined,
      createdAtIso: event.createdAtIso
    });
  }
  return items;
}
