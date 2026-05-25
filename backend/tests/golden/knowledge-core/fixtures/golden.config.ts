/**
 * Golden-set knowledge-core — конфигурация и типы фикстур.
 *
 * Назначение: единая точка правды для порогов качества, версии разметки и
 * типов JSON-фикстур golden-set'а (W2.1 из ТЗ
 * `plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md`).
 *
 * Принцип: пороги — `as const`, импортируются suite'ом, никаких ENV-override
 * (golden — это инвариант релиза, а не runtime-конфиг).
 *
 * Версия (`version`) — bump'аем при любом обратно-несовместимом изменении
 * формата фикстур или существенной правке промптов knowledge-core. Это даёт
 * чёткий маркер «текущий expected больше не соответствует промпту, обнови».
 */
export const GOLDEN_CONFIG = {
  /** Версия формата фикстур. Bump при breaking-changes структуры meetings/expected. */
  version: '1.0.0',
  /**
   * Пороги метрик качества (ТЗ §W2.1). Suite падает, если хотя бы один не
   * выполнен (после первой разметки 50 встреч). До разметки suite skip'ается.
   */
  thresholds: {
    /** Макро-F1 по 55 значениям enum SignalType. */
    signalTypeMacroF1: 0.7,
    /** Доля ожидаемых entities, найденных в top-10 результатов на встречу. */
    entityRecallAt10: 0.85,
    /** Cosine similarity между предсказанным и ожидаемым `name` блока (embedding). */
    blockNameCosineSimilarity: 0.8,
    /** Доля эталонных search-запросов (≤30 на сет), у которых ожидаемый blockId попал в top-3. */
    top3SearchHitRate: 0.8,
  },
  /** Пути к фикстурам относительно `backend/tests/golden/knowledge-core/`. */
  paths: {
    meetings: './meetings',
    expected: './expected',
  },
  /**
   * Минимальный размер golden-set'а для разблокировки реального прогона
   * (suite skip'ается, пока ниже). После — `test.skipIf(count < min)` снимается
   * вручную, как только владелец фактически разметил 50 встреч.
   */
  minMeetingsForRun: 50,
} as const;

// ───────────────── типы фикстур ─────────────────

/**
 * Один transcript-turn (вход в SegmentBuilderService).
 * Совпадает по форме с `MeetingTurn` из `segment-builder.service.ts`.
 */
export interface GoldenTranscriptTurn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * `payload` встречи в формате meeting RawEvent (как кладёт `MeetingIngestAdapter`).
 * Минимальный набор полей — расширяй при необходимости в новых фикстурах.
 */
export interface GoldenMeetingPayload {
  meetingId: string;
  type?: string;
  title?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  transcript: {
    turns: GoldenTranscriptTurn[];
    totalWords?: number | null;
    totalDurationSeconds?: number | null;
  };
  participants?: Array<{ name?: string; role?: string }>;
  roomChat?: Array<unknown>;
}

/**
 * Файл `meetings/NNN-name.json` — RawEvent в почти-боевом формате.
 *
 *   - `id` — стабильный человеко-читаемый идентификатор (`001-sales-call`).
 *     Используется для маппинга на `expected/<id>.expected.json`.
 *   - `tenantId` — фиктивный, используется только для трассировки в логах.
 *   - `payload` — то, что попадёт в `SegmentBuilderService.buildSegments(...)`.
 *   - `dataClass` — DataClass из Prisma, опц. (по умолчанию `'internal'`).
 *   - `meetingTitle` — для удобства печати в expectations.
 */
export interface GoldenMeeting {
  id: string;
  tenantId: string;
  meetingTitle?: string;
  dataClass?: 'public' | 'internal' | 'confidential' | 'restricted';
  payload: GoldenMeetingPayload;
}

/**
 * Ожидаемая запись блока. Поля близки к `IdeaBlock` в `schema.prisma`, но
 * без БД-специфики (`embedding`, `mergedIntoId`, и т.п.) — это разметка,
 * не персистенция.
 */
export interface GoldenExpectedBlock {
  /**
   * Стабильный идентификатор внутри фикстуры (`block-1`, `block-fact-pricing`)
   * — используется в `searchQueries[].expectedBlockId`.
   */
  id: string;
  /** Ожидаемое (или эквивалентное) имя блока — для cosine similarity name'а. */
  name: string;
  /** Ожидаемый signalType — для макро-F1. */
  signalType: string;
  /** Опц. — фраза-evidence, по которой проверяется привязка. */
  evidenceQuote?: string;
  /** Опц. — ключевые слова в trustedAnswer (для мягкой проверки). */
  expectedAnswerKeywords?: string[];
}

/**
 * Ожидаемая сущность (Entity). `recall@10` считается по совпадению
 * `(type, canonicalName)` среди топ-10 entities, извлечённых из встречи.
 */
export interface GoldenExpectedEntity {
  type: string;
  canonicalName: string;
  /** Опц. алиасы, любой из которых считается за совпадение. */
  aliases?: string[];
}

/**
 * Эталонный search-запрос: вопрос → blockId из `blocks[].id` выше.
 * top-3 hit rate = доля запросов, у которых `expectedBlockId` оказался в top-3.
 */
export interface GoldenExpectedSearchQuery {
  q: string;
  expectedBlockId: string;
}

/**
 * Файл `expected/<id>.expected.json` — ожидаемый результат прогона
 * knowledge-core pipeline'а на соответствующей встрече.
 *
 *   - `blocks` — массив ожидаемых блоков (используется для F1 signalType,
 *     cosine name).
 *   - `entities` — массив ожидаемых entities (recall@10).
 *   - `searchQueries` — эталонные запросы (top-3 hit rate). Опц.
 *   - `notes` — свободный комментарий разметчика (не используется в проверках).
 */
export interface GoldenExpected {
  /** Должен совпадать с `GoldenMeeting.id` соответствующего meetings/-файла. */
  id: string;
  /** Версия `GOLDEN_CONFIG.version`, под которую сделана разметка. */
  configVersion: string;
  blocks: GoldenExpectedBlock[];
  entities: GoldenExpectedEntity[];
  searchQueries?: GoldenExpectedSearchQuery[];
  notes?: string;
}

/** Утилитарный type-guard для безопасного парсинга JSON-фикстур в suite. */
export function isGoldenMeeting(value: unknown): value is GoldenMeeting {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.tenantId === 'string' &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}

export function isGoldenExpected(value: unknown): value is GoldenExpected {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.configVersion === 'string' &&
    Array.isArray(v.blocks) &&
    Array.isArray(v.entities)
  );
}
