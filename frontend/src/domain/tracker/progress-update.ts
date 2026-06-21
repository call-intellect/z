import {
  mapPreviewToProvenanceRef,
  type PreviewSourceRefApi,
  type ProvenanceRef,
} from "@/domain/provenance";

export type ProgressHealth = "on_track" | "at_risk" | "off_track";

export type ProgressAuthorType = "human" | "ai_agent";

export type ProgressDraftState =
  | "pending"
  | "accepted"
  | "edited"
  | "rejected";

export interface ProgressUpdateApi {
  id: string;
  issueId: string;
  authorId: string | null;
  authorType: string;
  health: string;
  body: string;
  doneText: string | null;
  nextText: string | null;
  draftState: string | null;
  sourceBlockIds: string[];
  evidenceQuote: string | null;
  confidence: number | null;
  previewQuote: string | null;
  previewSourceRef: PreviewSourceRefApi | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressUpdate {
  id: string;
  issueId: string;
  authorId: string | null;
  authorType: ProgressAuthorType;
  health: ProgressHealth;
  body: string;
  doneText: string | null;
  nextText: string | null;
  draftState: ProgressDraftState | null;
  sourceBlockIds: string[];
  evidenceQuote: string | null;
  confidence: number | null;
  provenancePreview: ProvenanceRef | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isDraft: boolean;
  isAiAuthored: boolean;
}

const HEALTH_VALUES: readonly string[] = ["on_track", "at_risk", "off_track"];

const DRAFT_STATE_VALUES: readonly string[] = [
  "pending",
  "accepted",
  "edited",
  "rejected",
];

function parseHealth(value: string): ProgressHealth {
  return HEALTH_VALUES.includes(value)
    ? (value as ProgressHealth)
    : "on_track";
}

function parseAuthorType(value: string): ProgressAuthorType {
  return value === "ai_agent" ? "ai_agent" : "human";
}

function parseDraftState(
  value: string | null,
): ProgressDraftState | null {
  if (value === null) return null;
  return DRAFT_STATE_VALUES.includes(value)
    ? (value as ProgressDraftState)
    : null;
}

const parseDate = (s: string | null): Date | null => (s ? new Date(s) : null);

export function progressUpdateFromApi(api: ProgressUpdateApi): ProgressUpdate {
  const draftState = parseDraftState(api.draftState);
  const authorType = parseAuthorType(api.authorType);
  return {
    id: api.id,
    issueId: api.issueId,
    authorId: api.authorId,
    authorType,
    health: parseHealth(api.health),
    body: api.body,
    doneText: api.doneText,
    nextText: api.nextText,
    draftState,
    sourceBlockIds: api.sourceBlockIds ?? [],
    evidenceQuote: api.evidenceQuote,
    confidence: api.confidence,
    provenancePreview: mapPreviewToProvenanceRef(
      api.previewQuote,
      api.previewSourceRef,
    ),
    periodStart: parseDate(api.periodStart),
    periodEnd: parseDate(api.periodEnd),
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    isDraft: draftState === "pending",
    isAiAuthored: authorType === "ai_agent",
  };
}

export const PROGRESS_HEALTH_LABELS: Record<ProgressHealth, string> = {
  on_track: "в норме",
  at_risk: "риск",
  off_track: "буксует",
};

export const PROGRESS_HEALTH_CHIP: Record<ProgressHealth, string> = {
  on_track: "bg-chip-success-bg text-chip-success-fg",
  at_risk: "bg-chip-warning-bg text-chip-warning-fg",
  off_track: "bg-chip-danger-bg text-chip-danger-fg",
};

export const PROGRESS_HEALTH_DOT: Record<ProgressHealth, string> = {
  on_track: "bg-success",
  at_risk: "bg-warning",
  off_track: "bg-danger",
};

export function progressUpdateDateLabel(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
