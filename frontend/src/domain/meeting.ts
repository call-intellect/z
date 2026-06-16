import { MEETING_STATUSES } from "./enums";
import type { MeetingStatus, MeetingType, ParticipantRole } from "./enums";
import type {
  SpeakerAssignmentApi,
  UploadSpeakerApi,
} from "@/api/meetings.api";

export const MEETING_TYPE_LABEL_RU: Record<MeetingType, string> = {
  team: "Командная",
  standup: "Планёрка",
  plan_fact: "План-факт",
  project: "Проект",
  sales: "Продажи",
  custdev: "Кастдев",
  partner: "Партнёр",
  interview: "Интервью",
  customer_success: "Работа с клиентом",
};

export type ProcessingStageStatus =
  | "pending"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "skipped";

export type MeetingDomain = {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  customPrompt: string | null;
  failureReason: string | null;
  recapVersion: number;
  chaptersStatus: ProcessingStageStatus | null;
  tasksStatus: ProcessingStageStatus | null;
  embeddingsStatus: ProcessingStageStatus | null;
  durationMs: number | null;
  cardId: string | null;
  visibilityScope: string | null;
};

export type ParticipantDomain = {
  id: string;
  name: string;
  role: ParticipantRole;
  joinedAt: Date | null;
  leftAt: Date | null;
};

export type RecordingDomain = {
  hasRecording: boolean;
  status: string;
  durationSeconds: number | null;
  bytesTotal: string | null;
  expiresAt: Date | null;
};

export type AccessRole = "host" | "guest" | "none";

export type AccessDomain = {
  role: AccessRole;
  isRecordingActive: boolean;
  recordByDefault: boolean;
  meeting: {
    id: string;
    title: string;
    type: MeetingType;
    status: MeetingStatus;
  };
};

export type MeetingApi = {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  customPrompt?: string | null;
  failureReason?: string | null;
  recapVersion?: number;
  chaptersStatus?: ProcessingStageStatus | null;
  tasksStatus?: ProcessingStageStatus | null;
  embeddingsStatus?: ProcessingStageStatus | null;
  durationMs?: number | null;
  cardId?: string | null;
  visibilityScope?: string | null;
};

export type MeetingSummaryApi = {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  recapVersion?: number;
  durationMs?: number | null;
  chaptersStatus?: ProcessingStageStatus | null;
  tasksStatus?: ProcessingStageStatus | null;
  embeddingsStatus?: ProcessingStageStatus | null;
};

export type ParticipantApi = {
  id: string;
  name: string;
  role: ParticipantRole;
  joinedAt: string | null;
  leftAt: string | null;
};

export type AccessApi = {
  role: AccessRole;
  isRecordingActive: boolean;
  recordByDefault: boolean;
  meeting: {
    id: string;
    title: string;
    type: MeetingType;
    status: MeetingStatus;
  };
};

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function meetingFromApi(api: MeetingApi): MeetingDomain {
  return {
    id: api.id,
    title: api.title,
    type: api.type,
    status: api.status,
    startedAt: parseDate(api.startedAt),
    endedAt: parseDate(api.endedAt),
    createdAt: new Date(api.createdAt),
    customPrompt: api.customPrompt ?? null,
    failureReason: api.failureReason ?? null,
    recapVersion: api.recapVersion ?? 1,
    chaptersStatus: api.chaptersStatus ?? null,
    tasksStatus: api.tasksStatus ?? null,
    embeddingsStatus: api.embeddingsStatus ?? null,
    durationMs: typeof api.durationMs === "number" ? api.durationMs : null,
    cardId: api.cardId ?? null,
    visibilityScope: api.visibilityScope ?? null,
  };
}

export function meetingSummaryFromApi(api: MeetingSummaryApi): MeetingDomain {
  return {
    id: api.id,
    title: api.title,
    type: api.type,
    status: api.status,
    startedAt: parseDate(api.startedAt),
    endedAt: parseDate(api.endedAt),
    createdAt: new Date(api.createdAt),
    customPrompt: null,
    failureReason: null,
    recapVersion: api.recapVersion ?? 1,
    chaptersStatus: api.chaptersStatus ?? null,
    tasksStatus: api.tasksStatus ?? null,
    embeddingsStatus: api.embeddingsStatus ?? null,
    durationMs: typeof api.durationMs === "number" ? api.durationMs : null,
    cardId: null,
    visibilityScope: null,
  };
}

export function participantFromApi(api: ParticipantApi): ParticipantDomain {
  return {
    id: api.id,
    name: api.name,
    role: api.role,
    joinedAt: parseDate(api.joinedAt),
    leftAt: parseDate(api.leftAt),
  };
}

export function accessFromApi(api: AccessApi): AccessDomain {
  return {
    role: api.role,
    isRecordingActive: api.isRecordingActive,
    recordByDefault: api.recordByDefault,
    meeting: {
      id: api.meeting.id,
      title: api.meeting.title,
      type: api.meeting.type,
      status: api.meeting.status,
    },
  };
}

export function meetingDurationSeconds(m: MeetingDomain): number | null {
  if (typeof m.durationMs === "number" && m.durationMs > 0) {
    return Math.round(m.durationMs / 1000);
  }
  if (!m.startedAt || !m.endedAt) return null;
  const ms = m.endedAt.getTime() - m.startedAt.getTime();
  if (ms <= 0) return null;
  return Math.round(ms / 1000);
}

export type VisibilityScope = "owner_only" | "participants" | "custom" | "org";

export const VISIBILITY_SCOPE_OPTIONS: ReadonlyArray<{
  value: VisibilityScope;
  label: string;
  hint: string;
}> = [
  {
    value: "owner_only",
    label: "Только мне",
    hint: "Знания встречи видите только вы.",
  },
  {
    value: "participants",
    label: "Участникам",
    hint: "Видят те, кто был на встрече (по умолчанию).",
  },
  {
    value: "custom",
    label: "Выбрать людей и группы",
    hint: "Доступ только у выбранных людей и групп.",
  },
  {
    value: "org",
    label: "Всей компании",
    hint: "Знания встречи открыты всей компании.",
  },
];

export function normalizeVisibilityScope(
  scope: string | null | undefined,
): VisibilityScope {
  if (
    scope === "owner_only" ||
    scope === "participants" ||
    scope === "custom" ||
    scope === "org"
  ) {
    return scope;
  }
  return "participants";
}

export function visibilityScopeLabel(scope: string | null | undefined): string {
  const value = normalizeVisibilityScope(scope);
  return (
    VISIBILITY_SCOPE_OPTIONS.find((o) => o.value === value)?.label ??
    "Участникам"
  );
}

export type GranteeType = "person" | "group";

export type VisibilityGrantDomain = {
  granteeType: GranteeType;
  granteeId: string;
  name: string;
};

export type MeetingVisibilityDomain = {
  scope: VisibilityScope;
  grants: VisibilityGrantDomain[];
};

export function meetingVisibilityFromApi(api: {
  scope: string;
  grants: { granteeType: string; granteeId: string; name: string }[];
}): MeetingVisibilityDomain {
  return {
    scope: normalizeVisibilityScope(api.scope),
    grants: (api.grants ?? []).map((g) => ({
      granteeType: g.granteeType === "group" ? "group" : "person",
      granteeId: g.granteeId,
      name: g.name,
    })),
  };
}

export type MeetingStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type MeetingStatusView = {
  label: string;
  tone: MeetingStatusTone;
  chipClass: string;
  isAiFailed: boolean;
  isFailed: boolean;
};

const STATUS_VIEW: Record<
  MeetingStatus,
  { label: string; tone: MeetingStatusTone }
> = {
  scheduled: { label: "Запланирована", tone: "neutral" },
  active: { label: "Идёт", tone: "info" },
  completed: { label: "Завершена", tone: "success" },
  recording_processing: { label: "Обработка записи", tone: "info" },
  recording_ready: { label: "Запись готова", tone: "info" },
  transcription_processing: { label: "Распознаём речь", tone: "info" },
  transcription_ready: { label: "Расшифровка готова", tone: "info" },
  ai_processing: { label: "Готовим отчёт", tone: "info" },
  ai_ready: { label: "Отчёт готов", tone: "success" },
  failed: { label: "Ошибка", tone: "danger" },
  ai_failed: { label: "Запись готова · отчёт не удался", tone: "warning" },
  awaiting_speakers: { label: "Подпишите говорящих", tone: "warning" },
};

const TONE_CHIP_CLASS: Record<MeetingStatusTone, string> = {
  neutral: "bg-bg-overlay text-fg-secondary",
  info: "bg-chip-info-bg text-chip-info-fg",
  success: "bg-chip-success-bg text-chip-success-fg",
  warning: "bg-chip-warning-bg text-chip-warning-fg",
  danger: "bg-chip-danger-bg text-chip-danger-fg",
};

export function meetingStatusView(status: MeetingStatus): MeetingStatusView {
  const v = STATUS_VIEW[status];
  return {
    label: v.label,
    tone: v.tone,
    chipClass: TONE_CHIP_CLASS[v.tone],
    isAiFailed: status === "ai_failed",
    isFailed: status === "failed",
  };
}

export function isJoinableStatus(status: MeetingStatus): boolean {
  return status === "scheduled" || status === "active";
}

export const MEETING_STATUS_VIEWS: ReadonlyArray<
  { status: MeetingStatus } & MeetingStatusView
> = MEETING_STATUSES.map((status) => ({
  status,
  ...meetingStatusView(status),
}));

export function meetingStatusLabel(status: string): string {
  if ((MEETING_STATUSES as readonly string[]).includes(status)) {
    return meetingStatusView(status as MeetingStatus).label;
  }
  return status.replaceAll("_", " ");
}

export type UploadSpeakerUi = {
  label: string;
  displayLabel: string;
  turnsCount: number;
  speakingSeconds: number;
  timePercent: number;
  sampleText: string;
  assignment: SpeakerAssignmentApi;
  personId: string | null;
  externalName: string | null;
  externalCompany: string | null;
  externalPosition: string | null;
  mergedIntoLabel: string | null;
  hasSpeech: boolean;
};

export function uploadSpeakerFromApi(
  api: UploadSpeakerApi,
  totalSpeakingSeconds: number,
): UploadSpeakerUi {
  const timePercent =
    totalSpeakingSeconds > 0
      ? Math.round((api.speakingSeconds / totalSpeakingSeconds) * 100)
      : 0;
  return {
    label: api.label,
    displayLabel: api.displayLabel,
    turnsCount: api.turnsCount,
    speakingSeconds: api.speakingSeconds,
    timePercent,
    sampleText: api.sampleText,
    assignment: api.assignment,
    personId: api.personId ?? null,
    externalName: api.externalName ?? null,
    externalCompany: api.externalCompany ?? null,
    externalPosition: api.externalPosition ?? null,
    mergedIntoLabel: api.mergedIntoLabel ?? null,
    hasSpeech: api.speakingSeconds > 0,
  };
}
