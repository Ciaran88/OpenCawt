import type { SessionStage, TranscriptEvent, TranscriptVoteAnswer } from "../data/types";

export const PROSECUTION_VOTE_PROMPT = "Do you side with the prosecution on this case?";
const COURT_ICON_PATH = "/chaticons/court.png";
const JUDGE_ICON_PATH = "/chaticons/judge.png";
const JURY_ICON_PATH = "/chaticons/jury.png";
const PROSECUTION_ICON_PATH = "/chaticons/prosecution.png";
const DEFENCE_ICON_PATH = "/chaticons/defense.png";

export type TranscriptSpeakerKey = "court" | "judge" | "jury" | "prosecution" | "defence";
export type TranscriptSpeakerAlign = "left" | "right";

export interface TranscriptSpeakerVisual {
  speakerKey: TranscriptSpeakerKey;
  align: TranscriptSpeakerAlign;
  iconPath: string;
  displayLabel: string;
}

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

function inferJudgeSurface(event: TranscriptEvent, hasJudgeContext: boolean): boolean {
  if (event.stage === "judge_screening") {
    return true;
  }

  if (event.actorRole !== "court" && event.actorRole !== "system") {
    return false;
  }

  const payloadText =
    event.payload && typeof event.payload === "object" ? JSON.stringify(event.payload) : "";
  const merged = `${event.messageText} ${payloadText}`.toLowerCase();
  if (
    /\bjudge\b/.test(merged) ||
    /\btiebreak\b/.test(merged) ||
    /\bintent class\b/.test(merged) ||
    /\bremediation\b/.test(merged)
  ) {
    return true;
  }

  if (
    hasJudgeContext &&
    event.stage === "closed" &&
    (event.eventType === "case_closed" || event.eventType === "notice")
  ) {
    return true;
  }

  return false;
}

export function resolveTranscriptSpeaker(
  event: TranscriptEvent,
  options?: { hasJudgeContext?: boolean }
): TranscriptSpeakerVisual {
  const hasJudgeContext = options?.hasJudgeContext ?? false;
  if (event.actorRole === "prosecution") {
    return {
      speakerKey: "prosecution",
      align: "left",
      iconPath: PROSECUTION_ICON_PATH,
      displayLabel: "Prosecution"
    };
  }
  if (event.actorRole === "defence") {
    return {
      speakerKey: "defence",
      align: "right",
      iconPath: DEFENCE_ICON_PATH,
      displayLabel: "Defence"
    };
  }
  if (event.actorRole === "juror") {
    return {
      speakerKey: "jury",
      align: "left",
      iconPath: JURY_ICON_PATH,
      displayLabel: "Jury"
    };
  }
  if (inferJudgeSurface(event, hasJudgeContext)) {
    return {
      speakerKey: "judge",
      align: "left",
      iconPath: JUDGE_ICON_PATH,
      displayLabel: "Judge"
    };
  }
  return {
    speakerKey: "court",
    align: "left",
    iconPath: COURT_ICON_PATH,
    displayLabel: "Court"
  };
}

export function shouldShowSpeakerAvatar(
  event: TranscriptEvent,
  previous: TranscriptEvent | undefined,
  speaker: TranscriptSpeakerVisual,
  previousSpeaker: TranscriptSpeakerVisual | undefined
): boolean {
  if (!previous || !previousSpeaker) {
    return true;
  }
  if (speaker.speakerKey !== previousSpeaker.speakerKey) {
    return true;
  }
  if ((event.actorAgentId ?? "") !== (previous.actorAgentId ?? "")) {
    return true;
  }
  return false;
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
