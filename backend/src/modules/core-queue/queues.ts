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
   * Meeting-report-fast (ТЗ 2026-05-25, Фаза 2). Consumer —
   * `MeetingReportFastWorker`. Один LLM-вызов поверх СЫРОГО транскрипта
   * выдаёт chapters + tasks + summaryFast + qualityScore. Работает
   * НЕЗАВИСИМО от block-ingest / meeting-analyze-v2.
   *
   * Идемпотентность: jobId = `meeting_report_fast_<meetingId>` (опционально
   * добавляется producer'ом, фоновый cron в Фазе 4).
   *
   * На Фазе 2 (текущая волна) consumer регистрируется в DI, но автоматически
   * на готовность транскрипта НЕ подписан — это сделает Фаза 4 (event
   * + producer). Пока используется только для ручного запуска из админки /
   * тестов.
   */
  MEETING_REPORT_FAST: 'core.meeting-report-fast',
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
  /**
   * SBA α-3 — RouterService.dispatch публикует jobs в эту очередь после
   * persist'а IdeaBlock'а. Multi-consumer: каждый специалист Слоя 3
   * (3-1-regulations, 3-3-decisions, 3-4-project-customer, 3-5-insights,
   * 3-6-ideas, 3-7-skill, 3-2-knowledge-clone) подписывается на свой jobName.
   * Payload — `SpecialistRoutingJobData`. На α-3 consumer'ы ещё НЕ запущены —
   * jobs накапливаются до появления первого специалиста (α-6, α-7, β-2, β-3, γ-1).
   * jobId = `<specialistName>_<blockId>` — идемпотентно.
   */
  SPECIALIST_ROUTING: 'core.specialist-routing',
  /**
   * SBA β-2 — Specialist 3.2 (Knowledge Clone). Очередь rebuild'а профиля
   * знаний конкретного Person. Consumer — `KnowledgeCloneRebuildWorker`.
   * Дебаунс через jobId `rebuild-knowledge-profile_<personId>` + delay
   * (`cfg.knowledgeClone.debounceMs`, 60s по умолчанию).
   *
   * Несколько подряд идущих enqueue для одного Person'а сложатся в один
   * отложенный job — это снимает нагрузку, если в одной встрече упомянуто
   * много блоков одного и того же сотрудника.
   */
  KNOWLEDGE_CLONE_REBUILD: 'core.knowledge-clone-rebuild',
  /**
   * SBA β-5 — Layer 6 (Probe-Agent). Consumer — `ProbeDispatcherWorker`.
   * Принимает `{ probeEventId }`. Выбор recipient'а, LLM-формулировка вопроса,
   * dispatch через `ConversationalService.sendNotification(eventType='probe.question')`.
   * jobId = `probe_<probeEventId>` для идемпотентности.
   */
  PROBE_EVENTS: 'core.probe-events',
  /**
   * SBA β-5 — Specialist 3.6 (Ideas Collector). Consumer — `IdeaClustererCron`-
   * style worker (или прямо cron вызывает). Очередь нужна, чтобы кластеризация
   * не делалась синхронно при создании каждой идеи. jobId = `idea_cluster_<orgId>`.
   */
  IDEA_CLUSTERER: 'core.idea-clusterer',
  /**
   * SBA γ-1 — Specialist 3.7 (SkillProfile) rebuild. Consumer —
   * `SkillProfileRebuildWorker`. Дебаунс через jobId
   * `skill-profile-rebuild_<profileId>` + delay (`cfg.skill.rebuildDebounceMs`,
   * 60s по умолчанию). Несколько подряд идущих enqueue для одного профиля
   * сложатся в один отложенный job.
   */
  SKILL_PROFILE_REBUILD: 'core.skill-profile-rebuild',
  /**
   * Wave 2 Recognition — формулировка благодарности через LLM. Consumer —
   * `RecognitionFormulateWorker`. Принимает payload с метаданными
   * (tenantId, type, contextEntityType/Id, toUserId, fromUserId?), формулирует
   * message через `recognition-formulate` LLM-task и создаёт `Recognition`.
   *
   * Идемпотентность через `jobId`:
   *   - thanks_comment        — `recognition_thanks_comment_<commentId>_<fromUserId>`
   *   - thanks_helpfulness    — `recognition_thanks_helpfulness_<spotlightId>_<fromUserId>`
   *   - idea_shipped          — `recognition_idea_shipped_<ideaId>_<toUserId>`
   *   - streak_milestone      — `recognition_streak_<userId>_<days>`
   *   - mention_helped        — `recognition_mention_helped_<blockId>_<toUserId>`
   *   - weekly_summary        — `recognition_weekly_<userId>_<YYYYWW>`
   */
  RECOGNITION_FORMULATE: 'core.recognition-formulate',
  /**
   * Calendar MVP (2026-05-25). Consumer — `EventRemindersWorker`. Принимает
   * `EventReminderJobData` ({ reminderId }) и доставляет напоминание по
   * каналу (telegram / push / email). После доставки помечает
   * `EventReminder.sentAt = now`. Producer — `EventReminderSchedulerCron`
   * (раз в минуту сканирует ближайшие due reminders). jobId = reminderId —
   * идемпотентно: повторный enqueue того же reminder'а не создаст дубль.
   */
  EVENT_REMINDERS: 'core.event-reminders',
  /**
   * Wave 2 — Web Push (2026-05-24). Consumer — `PushSenderWorker` (PushModule).
   * Принимает `PushSendJobData` и отправляет web-push на все активные
   * PushSubscription'ы пользователя через npm `web-push` с VAPID.
   *
   * Идемпотентность через `jobId = push_<userId>_<sha1(title+body)>_<bucketMin>`
   * — повторный enqueue той же благодарности/уведомления в ту же минуту
   * на того же user'а не создаст дубль push'а. Reuters / DAU-минута — окно.
   */
  PUSH_SEND: 'core.push-send',
  /**
   * ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined (Variant Б+).
   *
   * Consumer — `SpecialistsCombinedWorker`. Один LLM-вызов на ВСЕ canonical-
   * блоки одной встречи через tool `submit_all_8_entities`. Извлекает 8 типов
   * сущностей (decisions/ideas/insights/experiments/regulations/
   * knowledge_categories/skill_traits/helpfulness_traits) за один thinking-
   * проход. Заменяет 8 раздельных вызовов специалистов 3-1..3-9.
   *
   * Включается ENV-флагом `SPECIALISTS_COMBINED_ENABLED=true`. Старые
   * специалисты НЕ отключаются — flag-rollout (см. RouterSchema).
   *
   * Идемпотентность: `jobId = specialists_combined_<meetingId>`.
   */
  SPECIALISTS_COMBINED: 'core.specialists-combined',
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
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/** Payload для job'а `core.block-distill`. */
export interface BlockDistillJobData {
  blockId: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/** Payload для job'а `core.block-linker`. */
export interface BlockLinkerJobData {
  blockId: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/** Payload для job'а `core.entity-resolver`. */
export interface EntityResolverJobData {
  entityId: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/** Payload для job'а `core.card-rollup-v2`. Дополнительно reason — для логов. */
export interface CardRollupV2JobData {
  cardId: string;
  reason?: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/**
 * Payload для job'а `core.meeting-analyze-v2`. Минимальный — только
 * `meetingId`, остальное (tenantId, blocks) consumer подтянет из БД.
 */
export interface MeetingAnalyzeV2JobData {
  meetingId: string;
}

/**
 * Payload для job'а `core.meeting-report-fast` (ТЗ 2026-05-25, Фаза 2).
 * Минимальный — только `meetingId`; consumer сам подтянет transcript /
 * tenantId / type из БД.
 */
export interface MeetingReportFastJobData {
  meetingId: string;
}

/**
 * Payload для job'а `core.specialists-combined` (ТЗ 2026-05-25 llm-architecture §3).
 * Минимальный — только `meetingId`; consumer (`SpecialistsCombinedWorker`)
 * сам подтянет canonical-блоки и tenantId через `BlockFetchService`.
 *
 * Идемпотентность через `jobId = specialists_combined_<meetingId>`.
 */
export interface SpecialistsCombinedJobData {
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

/**
 * Payload для `core.specialist-routing` (SBA α-3). Воркеры-специалисты сами
 * подгрузят дополнительные данные из БД по `blockId`. `signalType` дублируется
 * в payload для cheap-filter'а на стороне consumer'а (чтобы не лазить в БД
 * только для проверки signalType).
 */
export interface SpecialistRoutingJobData {
  blockId: string;
  tenantId: string;
  signalType: string;
  /** Имя специалиста, на которого диспатчем (для логов и для match jobName). */
  specialistName: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/**
 * Sprints (2026-05-27) — payload для `3-13-sprint-helper` job в очереди
 * `core.specialist-routing`. В отличие от SpecialistRoutingJobData, работает
 * не с одним блоком, а со ВСЕМ спринтом (по `cycleId`). Воркер сам соберёт
 * контекст: задачи, последние блоки графа, активные SprintHint для дедупа.
 *
 * jobId-дедуп: один job на cycle (`3-13-sprint-helper_<cycleId>`). Повторный
 * enqueue в окне обработки обновит существующий job вместо создания дубля.
 *
 * Воркер уходит в ту же очередь `core.specialist-routing` — это удобно для
 * единого пула воркеров. Различение payload по jobName в Worker.process.
 */
export interface SprintHelperJobData {
  cycleId: string;
  tenantId: string;
  reason?: 'cron' | 'meeting_completed' | 'manual';
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/**
 * Payload для `core.knowledge-clone-rebuild` (SBA β-2). Воркер сам
 * подгрузит блоки Person'а за окно `cfg.knowledgeClone.lookbackMonths`.
 *
 * `reason` — для трассировки в логах (откуда пришёл rebuild: dispatch
 * специалиста / cron / manual).
 */
export interface RebuildKnowledgeProfileJobData {
  personId: string;
  tenantId: string;
  reason?: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/**
 * Payload для `core.probe-events` (SBA β-5). Воркер по probeEventId подтянет
 * `ProbeEvent` из БД и сделает selectRecipient + LLM probe-formulate + dispatch
 * через `ConversationalService.sendNotification`.
 */
export interface ProbeEventJobData {
  probeEventId: string;
}

/**
 * Payload для `core.idea-clusterer` (SBA β-5). Воркер запускает один проход
 * группировки Idea → IdeaCluster в указанной Org.
 */
export interface IdeaClustererJobData {
  tenantId: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/**
 * Payload для `core.skill-profile-rebuild` (SBA γ-1). Воркер по profileId
 * запустит `Specialist37Service.rebuildProfile`. `reason` — для логов
 * (откуда пришёл rebuild: dispatch специалиста / cron / manual).
 */
export interface RebuildSkillProfileJobData {
  profileId: string;
  tenantId: string;
  reason?: string;
  /** Проброс traceId цепочки (для сшивки логов со встречей-источником). */
  traceId?: string;
}

/**
 * Wave 2 — payload `core.recognition-formulate`. Воркер
 * `RecognitionFormulateWorker` формирует message через LLM `recognition-formulate`
 * и создаёт запись `Recognition`. Если `message` уже передан — LLM-шаг пропускается
 * (например, для streak milestone — текст фиксированный, не нужен LLM).
 *
 * `type` — один из:
 *   - 'thanks_comment'      — нажатие «спасибо» под комментарием.
 *   - 'thanks_helpfulness'  — HelpfulnessSpotlight (Specialist 3.8). На 2026-05-24
 *                              ещё не реализован; контекстный entityId оставляем.
 *   - 'mention_helped'      — в чек-ине упомянуто «мне помог X» (signalType=helped_by).
 *   - 'idea_shipped'        — Idea.status стала 'shipped' или 'in_progress'.
 *   - 'streak_milestone'    — порог чек-инов (7/14/30/60/90/...).
 *   - 'weekly_summary'      — дайджест от RecognitionWeeklyDigestCron.
 *
 * `visibility` определяет, публикуется ли запись в Activity Feed (если 'team'
 * или 'public_org' — публикуем через ActivityFeedService.publish, который
 * на 2026-05-24 может быть ещё не готов — тогда воркер оставляет только
 * Recognition в БД и логирует TODO).
 */
/**
 * Wave 2 — payload `core.push-send`. Consumer — `PushSenderWorker` отправляет
 * web-push всем активным `PushSubscription` указанного user в указанном tenant.
 *
 *   - `tenantId`/`userId` — целевой получатель.
 *   - `title`/`body` — текст уведомления (рендерится в ServiceWorker'е).
 *   - `icon` — опциональный URL иконки 192x192 (если null — берётся /icon-192.png).
 *   - `data` — произвольный JSON-словарь, пробрасывается в `event.data` SW.
 *     Договорённое поле — `url` (на клик ServiceWorker открывает или фокусирует
 *     вкладку с этим URL). Остальные поля свободные, для будущих фич (badge,
 *     deep-link, аналитика).
 */
export interface PushSendJobData {
  tenantId: string;
  userId: string;
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
}

/**
 * Calendar MVP (2026-05-25) — payload `core.event-reminders`. Consumer —
 * `EventRemindersWorker`. jobId = reminderId — повторный enqueue того же
 * reminder'а не создаст дубль. Сам ID воркер получит из payload и сам
 * подтянет Event/EventReminder из БД (правильный pattern с тонким payload).
 */
export interface EventReminderJobData {
  reminderId: string;
}

export interface RecognitionFormulateJobData {
  tenantId: string;
  type:
    | 'thanks_comment'
    | 'thanks_helpfulness'
    | 'mention_helped'
    | 'idea_shipped'
    | 'streak_milestone'
    | 'weekly_summary';
  toUserId: string;
  /** Null = от AI / системы; non-null = от другого user'а (например, кто нажал «спасибо»). */
  fromUserId?: string | null;
  contextEntityType?:
    | 'issue_comment'
    | 'insight'
    | 'regulation'
    | 'idea'
    | 'checkin'
    | 'helpfulness_spotlight'
    | null;
  contextEntityId?: string | null;
  /** Готовый message (skip LLM). Если null/undefined — формулируем через LLM. */
  message?: string | null;
  /** По умолчанию 'private'. Если 'team'/'public_org' — публикуем в Activity Feed. */
  visibility?: 'private' | 'team' | 'public_org';
  /** Сериализованный контекст для LLM-промпта (например, аггрегаты weekly_summary). */
  contextPayload?: Record<string, unknown>;
}
