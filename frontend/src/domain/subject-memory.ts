import type { SubjectMemoryItemApi } from "@/api/subject-memory.api";

export const SUBJECT_MEMORY_KINDS = [
  "term",
  "disambiguation",
  "preference",
] as const;
export type SubjectMemoryKind = (typeof SUBJECT_MEMORY_KINDS)[number];

export const SUBJECT_MEMORY_STATUSES = [
  "shadow",
  "canary",
  "active",
  "superseded",
  "rolled_back",
  "disabled",
] as const;
export type SubjectMemoryStatus = (typeof SUBJECT_MEMORY_STATUSES)[number];

export const SUBJECT_MEMORY_KIND_LABELS: Record<SubjectMemoryKind, string> = {
  term: "Термин компании",
  disambiguation: "Разрешённая неоднозначность",
  preference: "Предпочтение",
};

export const SUBJECT_MEMORY_STATUS_LABELS: Record<SubjectMemoryStatus, string> =
  {
    shadow: "Наблюдается",
    canary: "Проверяется на части",
    active: "Активно",
    superseded: "Заменено новым",
    rolled_back: "Откатано (ухудшило метрику)",
    disabled: "Отключено",
  };

export type SubjectMemoryStatusTone =
  | "success"
  | "info"
  | "warning"
  | "muted";

export const SUBJECT_MEMORY_STATUS_TONES: Record<
  SubjectMemoryStatus,
  SubjectMemoryStatusTone
> = {
  active: "success",
  canary: "info",
  shadow: "info",
  superseded: "muted",
  rolled_back: "warning",
  disabled: "muted",
};

export interface SubjectMemoryRule {
  id: string;
  kind: SubjectMemoryKind;
  kindLabel: string;
  contextText: string;
  ruleText: string;
  status: SubjectMemoryStatus;
  statusLabel: string;
  statusTone: SubjectMemoryStatusTone;
  confidencePercent: number;
  confirmCount: number;
  refuteCount: number;
  sourceProbeIds: string[];
  appliedCount: number;
  occurredAt: Date;
  lastAppliedAt: Date | null;
  createdAt: Date;
}

export function mapSubjectMemoryRule(
  api: SubjectMemoryItemApi,
): SubjectMemoryRule {
  return {
    id: api.id,
    kind: api.kind,
    kindLabel: SUBJECT_MEMORY_KIND_LABELS[api.kind] ?? api.kind,
    contextText: api.contextText,
    ruleText: api.ruleText,
    status: api.status,
    statusLabel: SUBJECT_MEMORY_STATUS_LABELS[api.status] ?? api.status,
    statusTone: SUBJECT_MEMORY_STATUS_TONES[api.status] ?? "muted",
    confidencePercent: Math.round(api.confidence * 100),
    confirmCount: api.confirmCount,
    refuteCount: api.refuteCount,
    sourceProbeIds: api.sourceProbeIds,
    appliedCount: api.appliedCount,
    occurredAt: new Date(api.occurredAt),
    lastAppliedAt: api.lastAppliedAt ? new Date(api.lastAppliedAt) : null,
    createdAt: new Date(api.createdAt),
  };
}
