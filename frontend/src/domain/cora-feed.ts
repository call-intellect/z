/**
 * Domain-слой «Ленты Коры» — `/feed` (ТЗ редизайн кабинета 2026-06-13, Ф8.6).
 *
 * Бэк (commit 35237ae4):
 *   - GET  /api/v1/feed/cora?type=&window=&limit=
 *   - POST /api/v1/feed/cora/seen
 *   - GET  /api/v1/probe/control?window=&limit=
 *
 * «Лента Коры» = новости компании с анализом: идеи, сигналы, блокеры, решения,
 * конфликты, активность + вопросы Коры и вопросы людей. Каждая карточка несёт
 * `analysis` и `severity` (тон/сортировка приходят с бэка).
 */

import type {
  CoraFeedItemApi,
  CoraFeedListApi,
  CoraFeedTypeApi,
  CoraFeedSeverityApi,
  ProbeControlItemApi,
  ProbeControlListApi,
  ProbeControlStateApi,
} from '@/api/cora-feed.api';

// ─── Тон (severity → парные chip-токены) ────────────────────────────────────

/** Тон карточки/чипа. Маппится в `chip-{tone}-{bg,fg}` (см. tailwind.config). */
export type CoraFeedTone = 'info' | 'warning' | 'danger';

export const CORA_SEVERITY_TONE: Record<CoraFeedSeverityApi, CoraFeedTone> = {
  info: 'info',
  warn: 'warning',
  risk: 'danger',
};

// ─── Типы ленты + RU-лейблы ──────────────────────────────────────────────────

/** Значение чипа-переключателя: `all` или конкретный тип. */
export type CoraFeedFilter = 'all' | CoraFeedTypeApi;

/** RU-лейбл для тип-чипа на карточке. */
export const CORA_TYPE_LABEL: Record<CoraFeedTypeApi, string> = {
  idea: 'идея',
  insight: 'сигнал',
  decision: 'решение',
  conflict: 'конфликт',
  blocker: 'блокер',
  activity: 'активность',
  probe_question: 'вопрос Коры',
  open_question: 'вопрос людей',
};

/**
 * Переключатель-чипы ленты (порядок как в ТЗ: Всё · Идеи · Сигналы · Блокеры ·
 * Решения · Конфликты · Активность · Вопросы Коры · Вопросы людей).
 */
export const CORA_FILTER_CHIPS: ReadonlyArray<{
  value: CoraFeedFilter;
  label: string;
}> = [
  { value: 'all', label: 'Всё' },
  { value: 'idea', label: 'Идеи' },
  { value: 'insight', label: 'Сигналы' },
  { value: 'blocker', label: 'Блокеры' },
  { value: 'decision', label: 'Решения' },
  { value: 'conflict', label: 'Конфликты' },
  { value: 'activity', label: 'Активность' },
  { value: 'probe_question', label: 'Вопросы Коры' },
  { value: 'open_question', label: 'Вопросы людей' },
];

// ─── Доменная модель карточки ────────────────────────────────────────────────

/**
 * Инсайт-структура «оценка%→рекомендация→срок» — если payload её несёт.
 * Поля опциональны: разные источники наполняют payload по-разному.
 */
export type CoraInsightPayload = {
  /** Оценка/уверенность 0..1 (рендерим как проценты). */
  score?: number;
  /** Рекомендация Коры. */
  recommendation?: string;
  /** Срок/дедлайн (как строка для отображения). */
  due?: string;
};

export type CoraFeedItem = {
  id: string;
  type: CoraFeedTypeApi;
  typeLabel: string;
  title: string;
  analysis: string | null;
  severity: CoraFeedSeverityApi;
  tone: CoraFeedTone;
  meetingId: string | null;
  cite: string | null;
  createdAt: string;
  createdAtDate: Date;
  unread: boolean;
  /** Распарсенный «оценка→рекомендация→срок», если есть в payload. */
  insight: CoraInsightPayload | null;
};

export type CoraFeedView = {
  items: CoraFeedItem[];
  counters: Record<string, number>;
  unreadCount: number;
};

function parseInsightPayload(
  payload: Record<string, unknown> | null | undefined,
): CoraInsightPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const result: CoraInsightPayload = {};
  const rawScore = payload['score'] ?? payload['confidence'];
  if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
    result.score = rawScore;
  }
  const rawRec = payload['recommendation'] ?? payload['recommend'];
  if (typeof rawRec === 'string' && rawRec.trim()) {
    result.recommendation = rawRec.trim();
  }
  const rawDue = payload['due'] ?? payload['deadline'] ?? payload['dueDate'];
  if (typeof rawDue === 'string' && rawDue.trim()) {
    result.due = rawDue.trim();
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function coraFeedItemFromApi(api: CoraFeedItemApi): CoraFeedItem {
  return {
    id: api.id,
    type: api.type,
    typeLabel: CORA_TYPE_LABEL[api.type] ?? api.type,
    title: api.title,
    analysis: api.analysis ?? null,
    severity: api.severity,
    tone: CORA_SEVERITY_TONE[api.severity] ?? 'info',
    meetingId: api.sourceRef?.meetingId ?? null,
    cite: api.sourceRef?.cite ?? null,
    createdAt: api.createdAt,
    createdAtDate: new Date(api.createdAt),
    unread: api.unread === true,
    insight: parseInsightPayload(api.payload),
  };
}

export function coraFeedViewFromApi(api: CoraFeedListApi): CoraFeedView {
  return {
    items: (api.items ?? []).map(coraFeedItemFromApi),
    counters: api.counters ?? {},
    unreadCount: api.unreadCount ?? 0,
  };
}

// ─── Контроль вопросов Коры (probe/control) ──────────────────────────────────

export const PROBE_STATE_LABEL: Record<ProbeControlStateApi, string> = {
  answered: 'ответил',
  read_silent: 'прочитал, молчит',
  unseen: 'не видел',
  expired: 'протух',
};

/** Иконка-эмодзи статуса (как в ТЗ: ✅ / 👁 / 🔕 / ⏰). */
export const PROBE_STATE_ICON: Record<ProbeControlStateApi, string> = {
  answered: '✅',
  read_silent: '👁',
  unseen: '🔕',
  expired: '⏰',
};

export const PROBE_STATE_TONE: Record<ProbeControlStateApi, CoraFeedTone> = {
  answered: 'info',
  read_silent: 'warning',
  unseen: 'warning',
  expired: 'danger',
};

export type ProbeControlItem = {
  notificationId: string;
  question: string;
  recipientName: string | null;
  askedAt: string;
  askedAtDate: Date;
  expiresAt: string | null;
  state: ProbeControlStateApi;
  stateLabel: string;
  stateIcon: string;
  stateTone: CoraFeedTone;
  waitingDays: number;
};

export type ProbeControlView = {
  items: ProbeControlItem[];
  counts: {
    answered: number;
    read_silent: number;
    unseen: number;
    expired: number;
  };
};

export function probeControlItemFromApi(
  api: ProbeControlItemApi,
): ProbeControlItem {
  return {
    notificationId: api.notificationId,
    question: api.question,
    recipientName: api.recipientName ?? null,
    askedAt: api.askedAt,
    askedAtDate: new Date(api.askedAt),
    expiresAt: api.expiresAt ?? null,
    state: api.state,
    stateLabel: PROBE_STATE_LABEL[api.state] ?? api.state,
    stateIcon: PROBE_STATE_ICON[api.state] ?? '•',
    stateTone: PROBE_STATE_TONE[api.state] ?? 'warning',
    waitingDays: api.waitingDays ?? 0,
  };
}

export function probeControlViewFromApi(
  api: ProbeControlListApi,
): ProbeControlView {
  return {
    items: (api.items ?? []).map(probeControlItemFromApi),
    counts: {
      answered: api.counts?.answered ?? 0,
      read_silent: api.counts?.read_silent ?? 0,
      unseen: api.counts?.unseen ?? 0,
      expired: api.counts?.expired ?? 0,
    },
  };
}
