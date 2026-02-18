import { canonicalHashHex } from "../../shared/hash";
import type { Db } from "../db/sqlite";
import { getCaseById, listTranscriptEvents } from "../db/repository";

export interface CaseSealHashes {
  verdictHash: string;
  transcriptRootHash: string;
  jurySelectionProofHash: string;
}

interface TranscriptProjection {
  seqNo: number;
  actorRole: string;
  actorAgentId?: string;
  eventType: string;
  stage?: string;
  messageText: string;
  artefactType?: string;
  artefactId?: string;
  payload?: Record<string, unknown>;
  createdAtIso: string;
}

export async function hashTranscriptProjection(
  projection: TranscriptProjection[]
): Promise<string> {
  return canonicalHashHex(projection);
}

export async function hashJurySelectionProof(proof: unknown): Promise<string> {
  return canonicalHashHex(proof ?? {});
}

function projectTranscriptEvents(caseId: string, db: Db): TranscriptProjection[] {
  const events = listTranscriptEvents(db, { caseId, afterSeq: 0, limit: 2000 });
  return events.map((event) => {
    const projected: TranscriptProjection = {
      seqNo: event.seqNo,
      actorRole: event.actorRole,
      eventType: event.eventType,
      messageText: event.messageText,
      createdAtIso: event.createdAtIso
    };
    if (event.actorAgentId) {
      projected.actorAgentId = event.actorAgentId;
    }
    if (event.stage) {
      projected.stage = event.stage;
    }
    if (event.artefactType) {
      projected.artefactType = event.artefactType;
    }
    if (event.artefactId) {
      projected.artefactId = event.artefactId;
    }
    if (event.payload && Object.keys(event.payload).length > 0) {
      projected.payload = event.payload;
    }
    return projected;
  });
}

export async function computeCaseSealHashes(db: Db, caseId: string): Promise<CaseSealHashes> {
  const caseRecord = getCaseById(db, caseId);
  if (!caseRecord) {
    throw new Error(`CASE_NOT_FOUND:${caseId}`);
  }
  if (!caseRecord.verdictHash) {
    throw new Error("CASE_VERDICT_HASH_MISSING");
  }

  const transcriptProjection = projectTranscriptEvents(caseId, db);
  const transcriptRootHash = await hashTranscriptProjection(transcriptProjection);

  const selectionProofHash = await hashJurySelectionProof(caseRecord.selectionProof ?? {});

  return {
    verdictHash: caseRecord.verdictHash,
    transcriptRootHash,
    jurySelectionProofHash: selectionProofHash
  };
}
