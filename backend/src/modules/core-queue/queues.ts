import type { JobsOptions } from 'bullmq';

/**
 * Имена BullMQ-очередей для knowledge-core (knowledge core = единое
 * информационное ядро). Префикс `core.` отделяет от `ai.*` очередей
 * AI-pipeline.
 *
 * Состав по фазам:
 *   - `core.raw-events`     (Фаза 1) — публикуется `IngestService`. Consumer:
 *      `block-ingest.worker` (Фаза 2). Payload: `{ rawEventId }`.
 *   - `core.block-distill`  (Фаза 2) — после block-ingest. Consumer:
 *      `block-distill.worker`. Payload: `{ blockId }`. Дебаунс 30s,
 *      jobId = `block_distill_<blockId>` (повторный enqueue обновляет delay).
 *   - `core.block-linker`   (Фаза 3) — после distill для canonical-блоков.
 *      На Фазе 2 jobs накапливаются — это нормально.
 *   - `core.entity-resolver` (Фаза 4) — арбитраж дублей Entity. На Фазе 2
 *      jobs не публикуются — очередь существует только для предсоздания.
 *   - `core.theme-clusterer` (Фаза 4) — кластеризация тем. Аналогично — pending.
 */
export const CORE_QUEUE_NAMES = {
  /** Универсальная очередь raw events для ingest pipeline. */
  RAW_EVENTS: 'core.raw-events',
  /** После создания IdeaBlock — дистилляция (KNN + LLM-арбитр merge/distinct). */
  BLOCK_DISTILL: 'core.block-distill',
  /** После канонизации блока — пересчёт связей (Фаза 3). */
  BLOCK_LINKER: 'core.block-linker',
  /** Дедупликация Entity (Фаза 4). */
  ENTITY_RESOLVER: 'core.entity-resolver',
  /** Кластеризация тем (Фаза 4). */
  THEME_CLUSTERER: 'core.theme-clusterer',
  /**
   * Card-rollup-v2 (Фаза 4): пересборка `Card.summaryCache` поверх IdeaBlock'ов
   * (через meeting и через entityId). Дебаунс ~60s по jobId=`card_rollup_v2_<cardId>`.
   */
  CARD_ROLLUP_V2: 'core.card-rollup-v2',
  /**
   * Meeting-analyze-v2 (Фаза 5): Tasks-2.0/Chapters-2.0/Summary-2.0 поверх
   * IdeaBlock'ов встречи. Один job обходит три extractor-сервиса параллельно
   * и пишет в новые поля БД (Task.evidenceBlockIds, MeetingChapter.evidenceBlockIds,
   * AiResult.summaryV2). Не перезаписывает legacy записи.
   * Дебаунс ~2 мин по jobId=`meeting_analyze_v2_<meetingId>`.
   */
  MEETING_ANALYZE_V2: 'core.meeting-analyze-v2',
  /**
   * Strategic-alignment (Фаза 9): суточная LLM-оценка движения к Goal Org.
   * Один job на (Org, Goal). jobId=`strat_<goalId>_<YYYYMMDD>` для cron'а
   * (дневной dedup) или `strat_manual_<goalId>_<ts>` для ручного recompute.
   */
  STRATEGIC_ALIGNMENT: 'core.strategic-alignment',
  /**
   * Role-profile-build (Фаза 0d): сборка карты должности через LLM поверх
   * контекста графа Role→Person→Meeting→IdeaBlock. Один job на
   * (Org, Role, buildVersion); idempotency через `role_profile:<roleId>:<buildVersion>`.
   * Cron каждые 4 часа + on-demand через POST /api/v1/role-profiles/:roleId/rebuild.
   */
  ROLE_PROFILE: 'core.role-profile',
  /**
   * Document-uploaded (Фаза 0b knowledge-core): consumer —
   * `DocumentIngestAdapter`. Скачивает содержимое `Document` (inline или S3),
   * парсит через `DocumentParserService`, заполняет `Document.parsedText`,
   * переводит status в `parsed`, создаёт `RawEvent` и публикует raw-event
   * для knowledge-core. jobId = `doc_<documentId>` — идемпотентно.
   */
  DOCUMENT_UPLOADED: 'core.document-uploaded',
  /**
   * Dump-created (Фаза 0b knowledge-core): consumer — `TextIngestAdapter`.
   * Принимает уже готовый текст (`Document.kind='text'`, `status='parsed'`),
   * без парсинга создаёт `RawEvent` и запускает knowledge-core pipeline.
   * jobId = `dump_<documentId>`.
   */
  DUMP_CREATED: 'core.dump-created',
} as const;

export type CoreQueueName = (typeof CORE_QUEUE_NAMES)[keyof typeof CORE_QUEUE_NAMES];

/**
 * Дефолтные опции job'ов knowledge-core. Те же 5 attempts, что и у
 * AI-pipeline, но backoff меньше (5s вместо 8s) — события raw-events
 * легковесные (только `rawEventId`), не нужно долгое ожидание между retry.
 *
 *   attempts: 5                               — итого до 5 попыток.
 *   backoff: exponential delay 5000           — 5s, 10s, 20s, 40s.
 *   removeOnComplete: { age: 24h, count:1000} — успешные jobs не висят.
 *   removeOnFail: false                       — failed остаются для разбора.
 */
export const CORE_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

/**
 * Payload для job'а `core.raw-events`. Минимальный — только `rawEventId`,
 * остальное consumer (block-ingest.worker, Фаза 2) подтянет из БД.
 */
export interface RawEventJobData {
  rawEventId: string;
}

/** Payload для job'а `core.block-distill`. */
export interface BlockDistillJobData {
  blockId: string;
}

/** Payload для job'а `core.block-linker`. */
export interface BlockLinkerJobData {
  blockId: string;
}

/** Payload для job'а `core.entity-resolver`. */
export interface EntityResolverJobData {
  entityId: string;
}

/** Payload для job'а `core.card-rollup-v2`. Дополнительно reason — для логов. */
export interface CardRollupV2JobData {
  cardId: string;
  reason?: string;
}

/**
 * Payload для job'а `core.meeting-analyze-v2`. Минимальный — только
 * `meetingId`, остальное (tenantId, blocks) consumer подтянет из БД.
 */
export interface MeetingAnalyzeV2JobData {
  meetingId: string;
}

/**
 * Payload для job'а `core.strategic-alignment`. Воркер сам подтянет Goal,
 * связанные темы и блоки. `manual` помечает запуски через UI (для логов
 * и метрик). `windowDays` опционален — если не задан, используется
 * `Org.strategicAlignmentWindowDays`.
 */
export interface StrategicAlignmentJobData {
  tenantId: string;
  goalId: string;
  manual?: boolean;
  windowDays?: number;
}

/**
 * Payload для job'а `core.role-profile` (Фаза 0d).
 * Идемпотентность через `jobId = role_profile:<roleId>:<buildVersion>` —
 * повторный enqueue не создаёт дубликат.
 */
export interface RoleProfileJobData {
  tenantId: string;
  roleId: string;
  triggerReason: 'cron' | 'on-demand' | 'stale-detected';
  triggeredByUserId?: string;
}

/**
 * Payload для job'а `core.document-uploaded` (Фаза 0b knowledge-core).
 * Минимальный — `documentId` + `tenantId`. Адаптер сам подтянет Document
 * из БД, проверит status и возьмёт байты.
 */
export interface DocumentUploadedJobData {
  documentId: string;
  tenantId: string;
}

/**
 * Payload для job'а `core.dump-created` (Фаза 0b knowledge-core).
 * Передаём `content` inline, чтобы text.adapter не лез повторно в БД —
 * текст у нас уже на руках в момент publish'а (см. `DumpService` и
 * `DocumentsService.createTextDump`).
 */
export interface DumpCreatedJobData {
  documentId: string;
  tenantId: string;
  /** Person.id автора (uploaderId). Для audit-логов внутри адаптера. */
  uploaderPersonId: string;
  /** Готовый текст дампа — без парсинга. */
  content: string;
}
