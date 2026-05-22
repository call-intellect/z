import type { MeetingStatus, MeetingType, ParticipantRole } from './enums';

/**
 * Статус под-этапа AI-pipeline (chapters/tasks/embeddings).
 * Используется в meeting.chaptersStatus / tasksStatus / embeddingsStatus.
 */
export type ProcessingStageStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'skipped';

/**
 * Доменная модель встречи.
 * Маппинг из ApiDto — `mapMeetingFromApi` ниже. Дата в виде ISO-строки или Date —
 * выбираем `Date | null` (в UI форматируем через i18n / format).
 */
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
  /** Версия AI-отчёта (инкрементится при regenerate). */
  recapVersion: number;
  /** Под-этапы pipeline. backward-compat — поля могут отсутствовать на старых встречах. */
  chaptersStatus: ProcessingStageStatus | null;
  tasksStatus: ProcessingStageStatus | null;
  embeddingsStatus: ProcessingStageStatus | null;
  /** Длительность в миллисекундах (predtasked серверной стороной). */
  durationMs: number | null;
  /** Привязка к CRM-карточке. null если встреча не в карточке. */
  cardId: string | null;
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

export type AccessRole = 'host' | 'guest' | 'none';

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

// ─────────────────── api types (raw) ──────────────────

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

// ─────────────────── mappers ──────────────────

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
    durationMs: typeof api.durationMs === 'number' ? api.durationMs : null,
    cardId: api.cardId ?? null,
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
    durationMs: typeof api.durationMs === 'number' ? api.durationMs : null,
    cardId: null,
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

/**
 * Длительность встречи в секундах (приоритет — `durationMs` от бэка,
 * fallback — разница `startedAt`/`endedAt`).
 * Возвращает `null` если данных недостаточно.
 */
export function meetingDurationSeconds(m: MeetingDomain): number | null {
  if (typeof m.durationMs === 'number' && m.durationMs > 0) {
    return Math.round(m.durationMs / 1000);
  }
  if (!m.startedAt || !m.endedAt) return null;
  const ms = m.endedAt.getTime() - m.startedAt.getTime();
  if (ms <= 0) return null;
  return Math.round(ms / 1000);
}
