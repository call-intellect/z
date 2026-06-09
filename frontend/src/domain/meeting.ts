import { MEETING_STATUSES } from './enums';
import type { MeetingStatus, MeetingType, ParticipantRole } from './enums';
import type {
  SpeakerAssignmentApi,
  UploadSpeakerApi,
} from '@/api/meetings.api';

/**
 * Единый русский справочник подписей типов встреч.
 * Источник правды для UI (журнал встреч, страница результата, фильтры).
 * Раньше дублировался локально в MeetingsJournalReal и MeetingResultPageReal.
 */
export const MEETING_TYPE_LABEL_RU: Record<MeetingType, string> = {
  team: 'Командная',
  standup: 'Планёрка',
  plan_fact: 'План-факт',
  project: 'Проект',
  sales: 'Продажи',
  custdev: 'Кастдев',
  partner: 'Партнёр',
  interview: 'Интервью',
  customer_success: 'Работа с клиентом',
};

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

// ─────────────── статус встречи — центральный маппер ───────────────

/**
 * Семантический «тон» статуса встречи. Маппится на парные цветовые токены
 * (`bg-chip-{tone}-bg` + `text-chip-{tone}-fg`) — без жёстких hex/slate.
 */
export type MeetingStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type MeetingStatusView = {
  /** Человекочитаемый русский лейбл статуса. */
  label: string;
  /** Семантический тон для подбора цвета. */
  tone: MeetingStatusTone;
  /** CSS-классы парных токенов чипа (`bg-chip-…-bg text-chip-…-fg`). */
  chipClass: string;
  /**
   * `true` — терминальный сбой AI-ветки: запись в порядке, но AI-отчёт
   * не сформирован. Не путать с полным провалом (`failed`).
   */
  isAiFailed: boolean;
  /** `true` — полный провал встречи (ни записи, ни отчёта). */
  isFailed: boolean;
};

const STATUS_VIEW: Record<MeetingStatus, { label: string; tone: MeetingStatusTone }> = {
  scheduled: { label: 'Запланирована', tone: 'neutral' },
  active: { label: 'Идёт', tone: 'info' },
  completed: { label: 'Завершена', tone: 'success' },
  recording_processing: { label: 'Обработка записи', tone: 'info' },
  recording_ready: { label: 'Запись готова', tone: 'info' },
  transcription_processing: { label: 'Распознаём речь', tone: 'info' },
  transcription_ready: { label: 'Расшифровка готова', tone: 'info' },
  ai_processing: { label: 'Готовим отчёт', tone: 'info' },
  ai_ready: { label: 'Отчёт готов', tone: 'success' },
  failed: { label: 'Ошибка', tone: 'danger' },
  // Запись есть, AI-ветка упала — это НЕ полный провал, поэтому «warning».
  ai_failed: { label: 'Запись готова · отчёт не удался', tone: 'warning' },
  // Загруженная запись распознана — ждём подписи говорящих (ТЗ-5 Ф5).
  awaiting_speakers: { label: 'Подпишите говорящих', tone: 'warning' },
};

const TONE_CHIP_CLASS: Record<MeetingStatusTone, string> = {
  neutral: 'bg-bg-overlay text-fg-secondary',
  info: 'bg-chip-info-bg text-chip-info-fg',
  success: 'bg-chip-success-bg text-chip-success-fg',
  warning: 'bg-chip-warning-bg text-chip-warning-fg',
  danger: 'bg-chip-danger-bg text-chip-danger-fg',
};

/**
 * Центральный маппер статуса встречи → лейбл + тон + парные цветовые токены.
 * Единственный источник правды для бейджей/чипов статуса в UI.
 */
export function meetingStatusView(status: MeetingStatus): MeetingStatusView {
  const v = STATUS_VIEW[status];
  return {
    label: v.label,
    tone: v.tone,
    chipClass: TONE_CHIP_CLASS[v.tone],
    isAiFailed: status === 'ai_failed',
    isFailed: status === 'failed',
  };
}

/**
 * Единый критерий «встреча открыта для входа» (Войти/Скопировать/Пригласить
 * vs Открыть результат). См. ТЗ Часть Б.
 */
export function isJoinableStatus(status: MeetingStatus): boolean {
  return status === 'scheduled' || status === 'active';
}

/** Список всех статусов с их представлением — для фильтров/легенд. */
export const MEETING_STATUS_VIEWS: ReadonlyArray<{ status: MeetingStatus } & MeetingStatusView> =
  MEETING_STATUSES.map((status) => ({ status, ...meetingStatusView(status) }));

// ─────────────── Говорящие загруженной записи (ТЗ-5 Ф5) ───────────────

/**
 * UiModel говорящего на экране подписи. В отличие от ApiDto тут уже посчитаны
 * доля времени (`timePercent`), флаг «нужно подписать» и подпись-плейсхолдер
 * для лейбла дорожки.
 */
export type UploadSpeakerUi = {
  /** Технический лейбл дорожки (SPEAKER_00 и т.п.) — ключ, не переводить. */
  label: string;
  /** Текущее отображаемое имя говорящего. */
  displayLabel: string;
  turnsCount: number;
  speakingSeconds: number;
  /** Доля времени говорящего от суммы всех (0..100, целое). */
  timePercent: number;
  sampleText: string;
  assignment: SpeakerAssignmentApi;
  personId: string | null;
  externalName: string | null;
  externalCompany: string | null;
  externalPosition: string | null;
  mergedIntoLabel: string | null;
  /** Говорящий реально звучал в записи (а не пустая дорожка). */
  hasSpeech: boolean;
};

/**
 * Маппер ApiDto → UiModel. `totalSpeakingSeconds` нужен для расчёта доли
 * времени; передаётся вызывающим (сумма по всем говорящим).
 */
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
