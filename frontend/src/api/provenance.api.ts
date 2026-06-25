import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export type ProvenanceEntityTypeApi =
  | "decision"
  | "issue"
  | "task"
  | "regulation"
  | "instruction"
  | "block"
  | "notification"
  | "entity";

export interface ProvenanceSourceRefApi {
  type: string;
  refId: string | null;
  label: string;
  deepLink: string | null;
}

export interface ProvenanceNodeApi {
  blockId: string;
  rawEventId: string;
  source: ProvenanceSourceRefApi;
  quote: string;
  attribution: "quoted" | "inferred";
  startMs: number | null;
  endMs: number | null;
  occurredAt: string | null;
  confidence: number | null;
  needsReview: boolean;
  accessFiltered: boolean;
  hasAudio?: boolean;
}

export interface ProvenanceResponseApi {
  nodes: ProvenanceNodeApi[];
  coverage: { blocks: number; meetings: number };
}

export interface VoiceNoteAudioApi {
  url: string;
  expiresAt: string;
}

export const provenanceApi = {
  resolve: (
    orgId: string,
    entityType: ProvenanceEntityTypeApi,
    entityId: string,
  ) =>
    apiClient.get<ProvenanceResponseApi>(
      `/api/v1/provenance/${entityType}/${encodeURIComponent(entityId)}`,
      { headers: orgHeaders(orgId) },
    ),

  voiceNoteAudio: (orgId: string, rawEventId: string) =>
    apiClient.get<VoiceNoteAudioApi>(
      `/api/v1/provenance/voice-note/${encodeURIComponent(rawEventId)}/audio`,
      { headers: orgHeaders(orgId) },
    ),
};
