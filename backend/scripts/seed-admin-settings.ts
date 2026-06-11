/**
 * Admin-redesign Фаза 0 — idempotent seed для AdminSetting / Plan /
 * CronSchedule / EmailTemplate / RetentionPolicy.
 *
 * Идём по правилам `safe-seed-rules`:
 *   - используем `upsert` по `key`/`id`/`name`/`type` — повторный запуск
 *     никогда не падает и не дублирует;
 *   - НЕ затираем `updatedBy != null` (значит, super_admin уже правил
 *     запись из админки) — пропускаем её и пишем в "skipped";
 *   - значения по умолчанию берём из `process.env` (нам нужны те же ENV,
 *     что валидирует `env.schema.ts`); если ENV не задан — fallback'ы
 *     дублируют дефолты из schema, чтобы dev'еру не нужно было поднимать
 *     полный .env;
 *   - в конце печатаем сводку «Создано/обновлено: X settings, Y plans, ...».
 *
 * Запуск (из backend/):
 *   bun run scripts/seed-admin-settings.ts
 */

import { type Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

import {
  INVITE_DIRECTOR_TIMEOUT_TEMPLATE,
  INVITE_GITHUB_STYLE_TEMPLATE,
  INVITE_REMINDER_TEMPLATE,
  PASSWORD_RESET_TEMPLATE,
  REGISTER_TEMP_PASSWORD_TEMPLATE,
} from '../src/modules/mail/mail.templates';

const prisma = createPrismaClient();

// ─────────────────────────────── helpers ─────────────────────────────────

type Severity = 'low' | 'medium' | 'high' | 'destructive';

interface SettingSeed {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity?: Severity;
  description?: string;
  schemaId?: string;
}

interface SeedCounters {
  settingsCreated: number;
  settingsUpdated: number;
  settingsSkipped: number;
  plansCreated: number;
  plansUpdated: number;
  cronsCreated: number;
  cronsUpdated: number;
  emailTemplatesCreated: number;
  emailTemplatesUpdated: number;
  retentionsCreated: number;
  retentionsUpdated: number;
}

function env(name: string, fallback: string | number | boolean): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return String(fallback);
  return raw;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * Парсит CSV-список дней (например `'1,7,14'`) в массив положительных целых.
 * Используется для `share.allowedExpirationDays` — в AdminSetting храним
 * `number[]` напрямую (Json), а не строку, чтобы геттер `cfg.share.*`
 * получал готовый массив через `resolveSync<readonly number[]>`.
 */
function parseShareDays(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Парсит CSV-список расширений (например `'pdf,docx,csv'`) в массив строк.
 * Используется для `documents.acceptedFormats` (ТЗ-4 Ф6) — храним `string[]`
 * напрямую (Json), чтобы геттер `cfg.documentLimits()` получал готовый массив.
 */
function parseFormats(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * upsert одной AdminSetting. Если admin её уже редактировал (updatedBy != null),
 * то перезаписываем ТОЛЬКО метаданные (category/section/severity/description),
 * сохраняя value — это правило `safe-seed-rules` для admin-edited.
 */
async function upsertSetting(
  seed: SettingSeed,
  counters: SeedCounters,
): Promise<void> {
  const existing = await prisma.adminSetting.findUnique({
    where: { key: seed.key },
    select: { updatedBy: true },
  });
  const severity = seed.severity ?? 'low';
  const valueInput = seed.value as Prisma.InputJsonValue;

  if (!existing) {
    await prisma.adminSetting.create({
      data: {
        key: seed.key,
        value: valueInput,
        category: seed.category,
        section: seed.section,
        severity,
        ...(seed.description !== undefined ? { description: seed.description } : {}),
        ...(seed.schemaId !== undefined ? { schemaId: seed.schemaId } : {}),
      },
    });
    counters.settingsCreated++;
    return;
  }

  // Admin-edited — не трогаем value, обновляем только метаданные.
  if (existing.updatedBy && existing.updatedBy !== 'system') {
    await prisma.adminSetting.update({
      where: { key: seed.key },
      data: {
        category: seed.category,
        section: seed.section,
        severity,
        ...(seed.description !== undefined ? { description: seed.description } : {}),
        ...(seed.schemaId !== undefined ? { schemaId: seed.schemaId } : {}),
      },
    });
    counters.settingsSkipped++;
    return;
  }

  // Системная запись — можем обновить value на свежий ENV.
  await prisma.adminSetting.update({
    where: { key: seed.key },
    data: {
      value: valueInput,
      category: seed.category,
      section: seed.section,
      severity,
      ...(seed.description !== undefined ? { description: seed.description } : {}),
      ...(seed.schemaId !== undefined ? { schemaId: seed.schemaId } : {}),
    },
  });
  counters.settingsUpdated++;
}

// ─────────────────────────────── seeds ───────────────────────────────────

function buildSettings(): SettingSeed[] {
  const out: SettingSeed[] = [];

  // ── Лимиты (limits.*) — ~30 ключей.
  const limits: Array<[string, string, number, Severity, string]> = [
    ['MAX_API_KEYS_PER_USER', 'limits.maxApiKeysPerUser', envInt('MAX_API_KEYS_PER_USER', 10), 'high', 'Максимум API-ключей на пользователя'],
    ['MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER', 'limits.maxWebhookSubscriptionsPerUser', envInt('MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER', 20), 'high', 'Максимум webhook-подписок на пользователя'],
    ['MAX_DESTINATIONS_PER_USER', 'limits.maxDestinationsPerUser', envInt('MAX_DESTINATIONS_PER_USER', 10), 'medium', 'Максимум direct destinations на пользователя'],
    ['MAX_TAGS_PER_USER', 'limits.maxTagsPerUser', envInt('MAX_TAGS_PER_USER', 200), 'low', 'Максимум тегов на пользователя'],
    ['MAX_USER_TEMPLATES_PER_USER', 'limits.maxUserTemplatesPerUser', envInt('MAX_USER_TEMPLATES_PER_USER', 50), 'low', 'Максимум шаблонов встреч на пользователя'],
    ['MAX_CHAT_REQUESTS_PER_DAY', 'limits.maxChatRequestsPerDay', envInt('MAX_CHAT_REQUESTS_PER_DAY', 500), 'high', 'Лимит chat-запросов в сутки на пользователя'],
    ['MAX_CHAT_TOKENS_PER_DAY', 'limits.maxChatTokensPerDay', envInt('MAX_CHAT_TOKENS_PER_DAY', 1_000_000), 'high', 'Лимит chat-токенов в сутки'],
    ['MAX_RENDER_JOBS_PER_HOUR', 'limits.maxRenderJobsPerHour', envInt('MAX_RENDER_JOBS_PER_HOUR', 50), 'medium', 'Лимит render-задач в час'],
    ['MAX_BULK_EXPORTS_PER_DAY', 'limits.maxBulkExportsPerDay', envInt('MAX_BULK_EXPORTS_PER_DAY', 5), 'medium', 'Лимит bulk-экспортов в сутки'],
    ['MAX_REGENERATE_PER_MEETING_PER_DAY', 'limits.maxRegeneratePerMeetingPerDay', envInt('MAX_REGENERATE_PER_MEETING_PER_DAY', 5), 'medium', 'Лимит перегенераций отчёта встречи в сутки'],
    ['MAX_MEETINGS_CREATED_PER_DAY_VIA_API', 'limits.maxMeetingsCreatedPerDayViaApi', envInt('MAX_MEETINGS_CREATED_PER_DAY_VIA_API', 100), 'high', 'Лимит создаваемых встреч через API в сутки'],
    ['MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER', 'limits.maxEmbeddingTokensPerMonthPerUser', envInt('MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER', 10_000_000), 'high', 'Лимит embedding-токенов в месяц'],
    ['MAX_HIGHLIGHTS_PER_MEETING', 'limits.maxHighlightsPerMeeting', envInt('MAX_HIGHLIGHTS_PER_MEETING', 100), 'low', 'Лимит хайлайтов на встречу'],
    ['MAX_BULK_OPERATION_IDS', 'limits.maxBulkOperationIds', envInt('MAX_BULK_OPERATION_IDS', 100), 'medium', 'Лимит элементов в одном bulk-запросе'],
    ['MAX_CHAT_MESSAGE_CHARS', 'limits.maxChatMessageChars', envInt('MAX_CHAT_MESSAGE_CHARS', 8000), 'medium', 'Максимум символов в chat-сообщении'],
    ['MAX_ROOM_MESSAGE_CHARS', 'limits.maxRoomMessageChars', envInt('MAX_ROOM_MESSAGE_CHARS', 4000), 'medium', 'Максимум символов в room-сообщении'],
    ['MAX_CARDS_PER_USER', 'limits.maxCardsPerUser', envInt('MAX_CARDS_PER_USER', 1000), 'medium', 'Максимум карточек на пользователя'],
    ['MAX_CARD_ROLLUPS_PER_DAY', 'limits.maxCardRollupsPerDay', envInt('MAX_CARD_ROLLUPS_PER_DAY', 100), 'medium', 'Лимит card-rollup-операций в сутки'],
    ['MAX_GOAL_RECOMPUTE_PER_DAY', 'limits.maxGoalRecomputePerDay', envInt('MAX_GOAL_RECOMPUTE_PER_DAY', 20), 'medium', 'Лимит пересчётов strategic-alignment по Goal в сутки'],
    ['MAX_PARTICIPANTS_PER_MEETING', 'limits.maxParticipantsPerMeeting', envInt('MAX_PARTICIPANTS_PER_MEETING', 10), 'medium', 'Максимум участников встречи'],
    ['MAX_MEETING_DURATION_HOURS', 'limits.maxMeetingDurationHours', envInt('MAX_MEETING_DURATION_HOURS', 4), 'medium', 'Максимум длительности встречи в часах'],
    ['CLIP_MAX_DURATION_SECONDS', 'limits.clipMaxDurationSeconds', envInt('CLIP_MAX_DURATION_SECONDS', 600), 'low', 'Максимум длительности клипа в секундах'],
    ['EXPORT_ZIP_MAX_MEETINGS', 'limits.exportZipMaxMeetings', envInt('EXPORT_ZIP_MAX_MEETINGS', 50), 'medium', 'Максимум встреч в одном zip-экспорте'],
    ['EXPORT_ZIP_MAX_SIZE_BYTES', 'limits.exportZipMaxBytes', envInt('EXPORT_ZIP_MAX_SIZE_BYTES', 5_000_000_000), 'medium', 'Максимум байт в zip-экспорте'],
  ];
  for (const [, key, value, severity, description] of limits) {
    out.push({ key, value, category: 'platform', section: 'limits', severity, description });
  }

  // ── Retention (retention.*) — также в RetentionPolicy.
  const retentions: Array<[string, string, unknown, Severity, string]> = [
    ['DEFAULT_RETENTION_DAYS', 'retention.defaultDays', envInt('DEFAULT_RETENTION_DAYS', 90), 'high', 'Дефолтный срок хранения по умолчанию (дни)'],
    ['SOFT_DELETE_GRACE_DAYS', 'retention.softDeleteGraceDays', envInt('SOFT_DELETE_GRACE_DAYS', 30), 'high', 'Льготный период перед окончательным удалением (дни)'],
    ['WEBHOOK_DELIVERY_RETENTION_DAYS', 'retention.webhookDeliveryDays', envInt('WEBHOOK_DELIVERY_RETENTION_DAYS', 14), 'high', 'Хранение журнала webhook-доставок (дни)'],
    ['SHARE_VIEW_RETENTION_DAYS', 'retention.shareViewDays', envInt('SHARE_VIEW_RETENTION_DAYS', 90), 'high', 'Хранение логов просмотров shared-ссылок (дни)'],
    ['API_ACCESS_LOG_RETENTION_DAYS', 'retention.apiAccessLogDays', envInt('API_ACCESS_LOG_RETENTION_DAYS', 30), 'high', 'Хранение журнала API-обращений (дни)'],
    ['RETENTION_CRON', 'retention.cron', env('RETENTION_CRON', '0 * * * *'), 'high', 'Cron retention-sweep'],
    ['RETENTION_SWEEP_BATCH_SIZE', 'retention.sweepBatchSize', envInt('RETENTION_SWEEP_BATCH_SIZE', 500), 'medium', 'Размер батча retention-sweep'],
    ['RETENTION_RAW_EVENTS_ENABLED', 'retention.rawEventsEnabled', envBool('RETENTION_RAW_EVENTS_ENABLED', false), 'high', 'Retention sweep RawEvent включён'],
    ['RETENTION_AUDIT_ENABLED', 'retention.auditEnabled', envBool('RETENTION_AUDIT_ENABLED', false), 'high', 'Retention sweep AuditLog включён'],
    ['RETENTION_CHAT_ENABLED', 'retention.chatEnabled', envBool('RETENTION_CHAT_ENABLED', true), 'high', 'Retention sweep ChatMessage включён'],
    ['RETENTION_BLOCKS_ENABLED', 'retention.blocksEnabled', envBool('RETENTION_BLOCKS_ENABLED', false), 'destructive', 'Retention sweep IdeaBlock включён'],
  ];
  for (const [, key, value, severity, description] of retentions) {
    out.push({ key, value, category: 'tenants', section: 'retention', severity, description });
  }

  // ── Knowledge-Core пороги (knowledge.*) — ~40.
  const knowledge: Array<[string, unknown, Severity, string]> = [
    ['knowledge.distillMergeThreshold', envFloat('DISTILL_MERGE_THRESHOLD', 0.85), 'medium', 'KNN cosine-порог merge IdeaBlock'],
    // Report-to-graph Ф4 ГАРД A — cap уверенности блоков из отчёта встречи
    // (вторичный источник). Дефолт 0.6 — report виден в поиске, но ниже
    // транскриптного primary.
    ['knowledge.reportBlockConfidenceCap', envFloat('REPORT_BLOCK_CONFIDENCE_CAP', 0.6), 'medium', 'Cap уверенности блоков из отчёта встречи (вторичный источник)'],
    ['knowledge.distillDebounceMs', envInt('DISTILL_DEBOUNCE_MS', 30000), 'low', 'Дебаунс distill-воркера, мс'],
    ['knowledge.distillKnnTopK', envInt('DISTILL_KNN_TOP_K', 10), 'medium', 'KNN top-K для distill'],
    ['knowledge.entityMergeThreshold', envFloat('ENTITY_MERGE_THRESHOLD', 0.9), 'medium', 'KNN cosine-порог merge Entity'],
    ['knowledge.blockIngestWindowSegments', envInt('BLOCK_INGEST_WINDOW_SEGMENTS', 5), 'medium', 'Размер окна сегментов при block-ingest'],
    ['knowledge.blockIngestMaxTokensPerSegment', envInt('BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT', 1500), 'medium', 'Максимум токенов на сегмент при block-ingest'],
    ['knowledge.searchCosineWeight', envFloat('SEARCH_COSINE_WEIGHT', 0.7), 'medium', 'Вес cosine в hybrid-search'],
    ['knowledge.searchBm25Weight', envFloat('SEARCH_BM25_WEIGHT', 0.3), 'medium', 'Вес BM25 в hybrid-search'],
    ['knowledge.linkMinConfidence', envFloat('LINK_MIN_CONFIDENCE', 0.5), 'medium', 'Минимальная confidence связи для сохранения'],
    ['knowledge.linkerMinBlocks', envInt('LINKER_MIN_BLOCKS', 3), 'medium', 'Минимум блоков для запуска linker-а'],
    ['knowledge.linkKnnTopK', envInt('LINK_KNN_TOP_K', 20), 'medium', 'KNN top-K для linker'],
    ['knowledge.blockDynamicScoreDecayDays', envInt('BLOCK_DYNAMIC_SCORE_DECAY_DAYS', 30), 'medium', 'Период decay динамического счёта блока (дни)'],
    ['knowledge.entityGraphMinComentions', envInt('ENTITY_GRAPH_MIN_COMENTIONS', 2), 'medium', 'Минимум co-mention'],
    ['knowledge.themeClusteringMinBlocks', envInt('THEME_CLUSTERING_MIN_BLOCKS', 10), 'medium', 'Минимум блоков для кластеризации Theme'],
    ['knowledge.themeClusterMinSize', envInt('THEME_CLUSTER_MIN_SIZE', 3), 'medium', 'Минимум блоков в кластере Theme'],
    ['knowledge.themeCosineThreshold', envFloat('THEME_COSINE_THRESHOLD', 0.75), 'medium', 'Cosine-порог принадлежности к Theme'],
    ['knowledge.cardRollupV2DebounceMs', envInt('CARD_ROLLUP_V2_DEBOUNCE_MS', 60000), 'low', 'Дебаунс card-rollup-v2, мс'],
    ['knowledge.meetingAnalyzeV2DebounceMs', envInt('MEETING_ANALYZE_V2_DEBOUNCE_MS', 5000), 'low', 'Дебаунс meeting-analyze-v2, мс'],
    ['knowledge.v2AgentsEnabled', envBool('KNOWLEDGE_CORE_V2_AGENTS_ENABLED', true), 'high', 'Master-flag knowledge-core v2 агентов'],
    ['knowledge.chatV2Enabled', envBool('CHAT_V2_ENABLED', true), 'high', 'Master-flag ChatV2'],
    ['knowledge.chatV2TopBlocks', envInt('CHAT_V2_TOP_BLOCKS', 20), 'medium', 'ChatV2: top-K блоков'],
    ['knowledge.chatV2GraphHops', envInt('CHAT_V2_GRAPH_HOPS', 2), 'medium', 'ChatV2: количество graph-hops'],
    // Insights / Ideas / Skill / Persona / Curation.
    ['knowledge.insightClusterThreshold', envFloat('INSIGHT_CLUSTER_THRESHOLD', 0.8), 'medium', 'Insights: cosine-порог кластеризации'],
    ['knowledge.insightFrequencyWindowDays', envInt('INSIGHT_FREQUENCY_WINDOW_DAYS', 30), 'medium', 'Insights: окно rolling-частоты, дни'],
    ['knowledge.insightSpikeRatio', envFloat('INSIGHT_SPIKE_RATIO', 2.0), 'medium', 'Insights: ratio для пометки spike'],
    ['knowledge.ideaClusterThreshold', envFloat('IDEA_CLUSTER_THRESHOLD', 0.85), 'medium', 'Ideas: cosine-порог дедупа'],
    ['knowledge.ideaMinSupportersForCluster', envInt('IDEA_MIN_SUPPORTERS_FOR_CLUSTER', 3), 'medium', 'Ideas: минимум supporter-ов для кластера'],
    ['knowledge.skillMinObservations', envInt('SKILL_MIN_OBSERVATIONS', 3), 'medium', 'Skill: минимум наблюдений для trait'],
    ['knowledge.skillTraitSimilarityThreshold', envFloat('SKILL_TRAIT_SIMILARITY_THRESHOLD', 0.85), 'medium', 'Skill: KNN-cosine merge активных traits'],
    ['knowledge.skillLookbackMonths', envInt('SKILL_LOOKBACK_MONTHS', 6), 'medium', 'Skill: окно subject-reasoning блоков, мес'],
    ['knowledge.skillDecayMonths', envInt('SKILL_DECAY_MONTHS', 3), 'medium', 'Skill: порог decay по lastConfirmedAt'],
    ['knowledge.skillArchiveMonths', envInt('SKILL_ARCHIVE_MONTHS', 12), 'medium', 'Skill: порог archive по lastConfirmedAt'],
    ['knowledge.personaMinTraits', envInt('PERSONA_MIN_TRAITS', 5), 'medium', 'Persona: минимум traits для сборки'],
    ['knowledge.personaRoleAggMinPersons', envInt('PERSONA_ROLE_AGG_MIN_PERSONS', 2), 'medium', 'Persona: минимум persons для role-aggregation'],
    ['knowledge.curationAutoThresholdDefault', envFloat('CURATION_AUTO_THRESHOLD_DEFAULT', 0.85), 'medium', 'Curation: auto-canonical порог'],
    ['knowledge.curationDeepReviewThresholdDefault', envFloat('CURATION_DEEP_REVIEW_THRESHOLD_DEFAULT', 0.6), 'medium', 'Curation: deep-review порог'],
    ['knowledge.curationItemExpiryDays', envInt('CURATION_ITEM_EXPIRY_DAYS', 30), 'medium', 'Curation: срок жизни pending-item (дни)'],
    ['knowledge.curationStaleMonthsThreshold', envInt('CARD_STALE_MONTHS_THRESHOLD', 6), 'medium', 'Curation: порог stale по lastConfirmedAt (мес)'],
    ['knowledge.curationStaleDynamicScoreThreshold', envFloat('CARD_STALE_DYNAMIC_SCORE_THRESHOLD', 0.3), 'medium', 'Curation: порог stale по dynamicScore'],
    // Action Center «лестница доверия» A1/A2 — admin-editable дефолты курации.
    ['knowledge.curationProvisionalThresholdDefault', envFloat('CURATION_PROVISIONAL_THRESHOLD_DEFAULT', 0.8), 'medium', 'Курация: порог провизорной AI-канонизации'],
    ['knowledge.curationAiVerifierEnabled', envBool('CURATION_AI_VERIFIER_ENABLED', true), 'medium', 'Курация: включён ли AI-судья для критических типов'],
    ['knowledge.curationAuditSampleRate', envFloat('CURATION_AUDIT_SAMPLE_RATE', 0.05), 'low', 'Курация: доля авто/провизорных решений в аудит-выборку'],
    ['knowledge.curationAutotuneEnabled', envBool('CURATION_AUTOTUNE_ENABLED', false), 'medium', 'Курация: автоподстройка порогов по override-rate'],
    ['knowledge.curationThresholdMin', envFloat('CURATION_THRESHOLD_MIN', 0.6), 'medium', 'Курация: нижняя граница автоподстройки порога'],
    ['knowledge.curationThresholdMax', envFloat('CURATION_THRESHOLD_MAX', 0.97), 'medium', 'Курация: верхняя граница автоподстройки порога'],
    ['knowledge.curationAutotuneStep', envFloat('CURATION_AUTOTUNE_STEP', 0.02), 'low', 'Курация: шаг автоподстройки порога'],
    ['knowledge.curationMinDecisionsForAutotune', envInt('CURATION_MIN_DECISIONS_FOR_AUTOTUNE', 20), 'low', 'Курация: минимум решений до автоподстройки'],
    ['knowledge.curationMaxProvisionalOverride', envFloat('CURATION_MAX_PROVISIONAL_OVERRIDE', 0.2), 'medium', 'Курация: порог override-rate для kill-switch провизорного уровня'],
    ['knowledge.executablePersonaThresholdTraitsCount', envInt('EXECUTABLE_PERSONA_THRESHOLD_TRAITS_COUNT', 10), 'medium', 'ExecutablePersona: порог traits для rebuild'],
    // Kill-switch детерминированной атрибуции авторства IdeaBlock (subject).
    // Дефолт TRUE — атрибуция критична для skill/persona/clone-проекций.
    ['knowledge.subjectAttributionEnabled', envBool('KNOWLEDGE_SUBJECT_ATTRIBUTION_ENABLED', true), 'high', 'Kill-switch атрибуции авторства IdeaBlock (false = subject не проставляется)'],
    // Ф1 (knowledge-access) — расширенная привязка автора на ВСЕ типы знания.
    // Дефолт TRUE — who-ось должна быть непуста и для не-reasoning фактов.
    ['knowledge.subjectAttributionAllTypes', envBool('KNOWLEDGE_SUBJECT_ATTRIBUTION_ALL_TYPES', true), 'high', 'Привязка автора (subject) на ВСЕ типы знания, не только reasoning (false = только reasoning-семейство)'],
    // ТЗ 2026-06-04 meeting-identity-and-clones Ф5.2 — единая видимая задача из
    // встречи. Ship-On (2026-06-08): дефолт TRUE — из встречи рождается только
    // tracker Issue; пользовательский Task для action-items не создаётся,
    // потребители читают Issue. false = legacy (Task создаётся, потребители читают Task).
    ['knowledge.meetingTasksToTrackerOnly', envBool('KNOWLEDGE_MEETING_TASKS_TO_TRACKER_ONLY', true), 'high', 'Единая видимая задача из встречи: true = только tracker Issue (Task не создаётся), false = текущее поведение (Task)'],
    // Ф1 idea direct-path (2026-06-08) — материализация идей напрямую из блока
    // встречи (signalType='idea'), идемпотентно по sourceBlockId. Дефолт TRUE —
    // Идея не должна зависеть на 100% от 2-го LLM-вызова Specialist 3.6.
    ['knowledge.ideaDirectPathEnabled', envBool('KNOWLEDGE_IDEA_DIRECT_PATH_ENABLED', true), 'high', 'Idea direct-path — материализация идей напрямую из блока встречи (kill-switch, дефолт включён)'],
    // МТЗ «разблокировка конвейера» Ф5 — kill-switch записи в граф Apache AGE
    // (false = только Postgres, Cypher-вызовы no-op). Дефолт TRUE — граф критичен.
    ['graph.ageEnabled', envBool('GRAPH_AGE_ENABLED', true), 'high', 'Kill-switch записи в граф AGE (false = только Postgres)'],
  ];
  for (const [key, value, severity, description] of knowledge) {
    out.push({ key, value, category: 'ai', section: 'knowledge-core', severity, description });
  }

  // ── Дедуп задач встречи (meetings.*) — Ф5 Р2 (2026-06-08). ──────────────
  // РИСКОВО (может скрыть задачу) → дефолт FALSE (data-affecting). Non-lossy:
  // удаляется только fast-черновик при совпадении с canonical-задачей.
  // taskDedupeThreshold — KNN cosine-порог уверенного слияния (серая зона
  // [порог-0.07, порог) → LLM-арбитр task-dedupe).
  const meetingsSettings: Array<[string, unknown, Severity, string]> = [
    ['meetings.taskDedupeEnabled', envBool('MEETINGS_TASK_DEDUPE_ENABLED', false), 'high', 'Семантический дедуп задач встречи: при ON fast-черновик удаляется, если дублирует canonical-задачу той же встречи (дефолт выключено)'],
    ['meetings.taskDedupeThreshold', envFloat('MEETINGS_TASK_DEDUPE_THRESHOLD', 0.85), 'medium', 'Порог cosine-сходства заголовков для уверенного слияния fast-черновика в canonical (серая зона ниже порога — через LLM-арбитра)'],
  ];
  for (const [key, value, severity, description] of meetingsSettings) {
    out.push({ key, value, category: 'ai', section: 'meetings', severity, description });
  }

  // ── Эмбеддинги (embeddings.*) — 8.
  const embeddings: Array<[string, unknown, Severity, string]> = [
    ['embeddings.provider', env('EMBEDDING_PROVIDER', 'openai-proxy'), 'high', 'Провайдер эмбеддингов'],
    ['embeddings.model', env('EMBEDDING_MODEL', 'text-embedding-3-small'), 'high', 'Модель эмбеддингов'],
    ['embeddings.dimensions', envInt('EMBEDDING_DIMENSIONS', 1536), 'destructive', 'Размерность вектора — менять только при пересчёте всех embeddings'],
    ['embeddings.proxyEmbeddingsUrl', env('OPENAI_PROXY_EMBEDDINGS_URL', 'https://proxy.agent-lia.ru/v1/embeddings'), 'medium', 'URL endpoint embeddings через прокси'],
    ['embeddings.fallbackLocalUrl', env('EMBEDDING_FALLBACK_LOCAL_URL', ''), 'medium', 'Локальный fallback-URL для эмбеддингов'],
    ['embeddings.batchSize', envInt('EMBEDDING_BATCH_SIZE', 32), 'medium', 'Размер батча'],
    ['embeddings.chunkTargetTokens', envInt('EMBEDDING_CHUNK_TARGET_TOKENS', 600), 'medium', 'Целевой размер чанка в токенах'],
    ['embeddings.chunkOverlapTokens', envInt('EMBEDDING_CHUNK_OVERLAP_TOKENS', 80), 'medium', 'Перекрытие чанков в токенах'],
  ];
  for (const [key, value, severity, description] of embeddings) {
    out.push({ key, value, category: 'ai', section: 'embeddings', severity, description });
  }

  // ── AI feature flags (aiFeatures.*) — 5. Фаза 4 миграции call-sites.
  const aiFeatures: Array<[string, unknown, Severity, string]> = [
    ['aiFeatures.includeRoomChat', envBool('INCLUDE_ROOM_CHAT_IN_AI', true), 'medium', 'Включать room-chat в AI-анализ'],
    ['aiFeatures.transcriptCleaningLlmRefine', envBool('TRANSCRIPT_CLEANING_LLM_REFINE_ENABLED', true), 'medium', 'LLM-refine в transcript-clean (уровень 2)'],
    ['aiFeatures.behaviorMetricsLlmRefine', envBool('BEHAVIOR_METRICS_LLM_REFINE_ENABLED', false), 'medium', 'LLM-refine в behavior-metrics (Фаза B)'],
    ['aiFeatures.promptInjectionGuardEnabled', envBool('PROMPT_INJECTION_GUARD_ENABLED', true), 'high', 'Защита от prompt-injection в customPrompt (F1)'],
    // ТЗ 2026-06-07 agent-chain-overhaul Ф5 / Р6 — legacy summary-агент (MiniMax,
    // 0% кэш). Дефолт ВКЛ — обратимо; false = −1 LLM-вызов, сводка из summaryFast.
    ['aiFeatures.summaryAgentEnabled', envBool('SUMMARY_AGENT_ENABLED', true), 'medium', 'Legacy summary-агент в analyze.worker (false = сводка только из summaryFast / meeting-report-fast)'],
  ];
  for (const [key, value, severity, description] of aiFeatures) {
    out.push({ key, value, category: 'ai', section: 'features', severity, description });
  }

  // ── LLM cache-smoke (llm.*) — Ф6 Часть 3 (2026-06-08). Наблюдаемость доли
  // prompt-cache хитов по DeepSeek. Только лог/метрика, ничего не блокирует.
  const llm: Array<[string, unknown, Severity, string]> = [
    ['llm.cacheSmokeEnabled', envBool('LLM_CACHE_SMOKE_ENABLED', true), 'low', 'Включает smoke-проверку доли prompt-cache хитов DeepSeek в provider-smoke cron (только лог/метрика)'],
    ['llm.cacheHitRatioWarnThreshold', envFloat('LLM_CACHE_HIT_RATIO_WARN_THRESHOLD', 0.6), 'low', 'Порог доли cache-хитов по DeepSeek (0..1): ниже — WARN в логи (возможно taskType ушёл на некэширующий провайдер)'],
  ];
  for (const [key, value, severity, description] of llm) {
    out.push({ key, value, category: 'ai', section: 'features', severity, description });
  }

  // ── Trekker: авто-триаж задач из встреч (tracker.*) — Ф3 agent-chain-overhaul.
  const tracker: Array<[string, unknown, Severity, string]> = [
    ['tracker.autoAcceptConfidenceThreshold', envFloat('AUTO_ACCEPT_CONFIDENCE_THRESHOLD', 0.75), 'high', 'Порог авто-создания Issue из триажа встречи (confidence LLM 0..1). Дефолт 0.75 под живую речь; жёсткие гейты source=meeting+assignee+project остаются страховкой.'],
  ];
  for (const [key, value, severity, description] of tracker) {
    out.push({ key, value, category: 'integrations', section: 'tracker', severity, description });
  }

  // ── Goals: авто-привязка тем к целям (goals.*) — Ф4.2 agent-chain-overhaul.
  const goals: Array<[string, unknown, Severity, string]> = [
    ['goals.themeAutolinkMinWeight', envFloat('GOAL_THEME_AUTOLINK_MIN_WEIGHT', 0.15), 'medium', 'Порог веса авто-привязки темы к цели (провенанс/co-mention)'],
    ['goals.themeAutolinkLlmEnabled', envBool('GOAL_THEME_AUTOLINK_LLM_ENABLED', false), 'medium', 'Вкл LLM-дозор для серой зоны авто-привязки тем к целям'],
    // Ф4.1 agent-chain-overhaul — LLM-арбитр привязки задач встречи к AI-цели.
    // DEFAULT OFF: новый арбитр, риск мис-атрибуции, golden нет. Non-destructive.
    ['goals.goalTaskLinkEnabled', envBool('GOAL_TASK_LINK_ENABLED', false), 'medium', 'Вкл LLM-привязку задач встречи к AI-цели (ставит Issue.goalId только где пусто). Риск мис-атрибуции — по умолчанию выключено'],
  ];
  for (const [key, value, severity, description] of goals) {
    out.push({ key, value, category: 'ai', section: 'goals', severity, description });
  }

  // ── Feature-flags (feature.*) — продуктовые тумблеры.
  // Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema.
  // Ship-On (2026-06-08): дефолт TRUE. Риск галлюцинации схемы смягчён
  // human-gate — Кора показывает превью схемы, пользователь подтверждает
  // создание таблицы; кривое молча не создаётся. Откат — AdminSetting → false.
  const features: Array<[string, unknown, Severity, string]> = [
    [
      'feature.tables_text_to_schema',
      envBool('FEATURE_TABLES_TEXT_TO_SCHEMA', true),
      'medium',
      'Создание Smart-таблиц по текстовому описанию (Text-to-Schema)',
    ],
  ];
  for (const [key, value, severity, description] of features) {
    out.push({ key, value, category: 'platform', section: 'features', severity, description });
  }

  // ── Smart-tables агент (table.agent.*) — Фаза 3 Event-to-Cells. 3 крутилки.
  const tableAgent: Array<[string, unknown, Severity, string]> = [
    [
      'table.agent.confirmation_threshold',
      envFloat('TABLE_AGENT_CONFIRMATION_THRESHOLD', 0.85),
      'medium',
      'Порог уверенности авто-патча ячейки: ≥ порога и ячейка пуста → заполняем; иначе очередь подтверждений',
    ],
    [
      'table.agent.max_concurrent_enrich_jobs_per_org',
      envInt('TABLE_AGENT_MAX_CONCURRENT_ENRICH_JOBS_PER_ORG', 100),
      'medium',
      'Максимум одновременных enrich-задач агента таблиц на одну Org (throttle)',
    ],
    [
      'table.agent.max_daily_tokens',
      envInt('TABLE_AGENT_MAX_DAILY_TOKENS', 1000000),
      'medium',
      'Дневной бюджет LLM-токенов агента таблиц на одну Org',
    ],
  ];
  for (const [key, value, severity, description] of tableAgent) {
    out.push({ key, value, category: 'platform', section: 'features', severity, description });
  }

  // ── Smart-tables импорт из файла (table.import.*) — Фаза 4 Document-to-Table.
  const tableImport: Array<[string, unknown, Severity, string]> = [
    [
      'table.import.dedup_threshold',
      envFloat('TABLE_IMPORT_DEDUP_THRESHOLD', 0.85),
      'medium',
      'Порог cosine-схожести схем при импорте файла: ≥ порога → предлагаем слить с существующей таблицей, иначе создать новую',
    ],
  ];
  for (const [key, value, severity, description] of tableImport) {
    out.push({ key, value, category: 'platform', section: 'features', severity, description });
  }

  // ── Conversational (conversational.*) — 15.
  const conversational: Array<[string, unknown, Severity, string]> = [
    ['conversational.outboundConcurrency', envInt('CONVERSATIONAL_OUTBOUND_CONCURRENCY', 5), 'medium', 'Concurrency outbound-воркера каналов'],
    ['conversational.linkCodeTtlSec', envInt('CONVERSATIONAL_LINK_CODE_TTL_SEC', 900), 'high', 'TTL одноразового link-кода (сек)'],
    ['conversational.quietHoursDefault', env('CONVERSATIONAL_QUIET_HOURS_DEFAULT', '22:00-08:00'), 'medium', 'Дефолтное окно тихих часов'],
    ['conversational.rateLimitDefaultPerHour', envInt('CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR', 20), 'medium', 'Per-user лимит уведомлений в час'],
    ['conversational.emailFromDefault', env('CONVERSATIONAL_EMAIL_FROM_DEFAULT', ''), 'medium', 'Дефолтный From для email-каналов'],
    ['conversational.maxDeliveryAttempts', envInt('CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS', 5), 'medium', 'Максимум попыток доставки'],
    ['conversational.telegramApiBase', env('TELEGRAM_BOT_API_BASE', 'https://api.telegram.org'), 'medium', 'API base Telegram Bot'],
    ['conversational.telegramGlobalRps', envInt('TELEGRAM_BOT_GLOBAL_RPS', 25), 'medium', 'Telegram global RPS'],
    ['conversational.maxBotApiBase', env('MAX_BOT_API_BASE', 'https://api.max.ru'), 'medium', 'API base MAX Bot'],
    ['conversational.maxBotGlobalRps', envInt('MAX_BOT_GLOBAL_RPS', 25), 'medium', 'MAX global RPS'],
    ['conversational.botVoiceEnabled', envBool('BOT_VOICE_ENABLED', true), 'medium', 'Bot voice inbound включён'],
    ['conversational.botDocumentEnabled', envBool('BOT_DOCUMENT_ENABLED', true), 'medium', 'Bot document inbound включён'],
    ['conversational.botIntentClassifierEnabled', envBool('BOT_INTENT_CLASSIFIER_ENABLED', true), 'medium', 'LLM-классификатор intent включён'],
    ['conversational.koraBotUsername', env('KORA_BOT_USERNAME', 'kora_bot'), 'medium', 'Username глобального Telegram-бота'],
    ['conversational.inactiveBindingDays', envInt('INACTIVE_BINDING_DAYS', 30), 'medium', 'Период до пометки binding inactive (дни)'],
  ];
  for (const [key, value, severity, description] of conversational) {
    out.push({ key, value, category: 'integrations', section: 'conversational', severity, description });
  }

  // ── Webhook (webhook.*) — 5.
  const webhook: Array<[string, unknown, Severity, string]> = [
    ['webhook.deliveryTimeoutMs', envInt('WEBHOOK_DELIVERY_TIMEOUT_MS', 10000), 'medium', 'Таймаут доставки webhook (мс)'],
    ['webhook.maxAttempts', envInt('WEBHOOK_MAX_ATTEMPTS', 5), 'medium', 'Максимум попыток доставки webhook'],
    ['webhook.egressAllowedHosts', env('WEBHOOK_EGRESS_ALLOWED_HOSTS', ''), 'destructive', 'CSV-список разрешённых host-ов для webhook egress'],
    ['webhook.hmacPrefix', env('WEBHOOK_HMAC_PREFIX', 'whsec_'), 'medium', 'Префикс HMAC secret-а'],
    ['webhook.retentionDays', envInt('WEBHOOK_DELIVERY_RETENTION_DAYS', 14), 'high', 'Срок хранения журнала доставок (дни)'],
  ];
  for (const [key, value, severity, description] of webhook) {
    out.push({ key, value, category: 'integrations', section: 'webhook', severity, description });
  }

  // ── AI-pipeline (ai.*) — ~20.
  const ai: Array<[string, unknown, Severity, string]> = [
    ['ai.probeDedupTtlHours', envInt('PROBE_DEDUP_TTL_HOURS', 24), 'medium', 'TTL Redis-кеша дедупа probe'],
    ['ai.probeRateLimitPerUserPerHour', envInt('PROBE_RATE_LIMIT_PER_USER_PER_HOUR', 5), 'medium', 'Probe rate-limit per user/hour'],
    ['ai.probeRateLimitPerUserPerDay', envInt('PROBE_RATE_LIMIT_PER_USER_PER_DAY', 20), 'medium', 'Probe rate-limit per user/day'],
    ['ai.probeExpiryDays', envInt('PROBE_EXPIRY_DAYS', 7), 'medium', 'Срок жизни ProbeEvent (дни)'],
    ['ai.probeQuietHoursDefaultTzOffsetMin', envInt('PROBE_QUIET_HOURS_DEFAULT_TZ_OFFSET_MIN', 180), 'medium', 'Дефолтный TZ-сдвиг (мин)'],
    ['ai.probeColdStartModeHours', envInt('PROBE_COLD_START_MODE_HOURS', 24), 'medium', 'Окно cold-start (часы)'],
    ['ai.routerDispatchConcurrency', envInt('ROUTER_DISPATCH_CONCURRENCY', 5), 'medium', 'Router: dispatch concurrency'],
    ['ai.routerMaxSpecialistsPerBlock', envInt('ROUTER_MAX_SPECIALISTS_PER_BLOCK', 4), 'medium', 'Router: max specialists per block'],
    ['ai.searchCosineWeight', envFloat('SEARCH_COSINE_WEIGHT', 0.7), 'medium', 'Search: вес cosine'],
    ['ai.searchBm25Weight', envFloat('SEARCH_BM25_WEIGHT', 0.3), 'medium', 'Search: вес BM25'],
    ['ai.extractionEnableTopLevel', envBool('EXTRACTION_ENABLE_TOP_LEVEL', false), 'destructive', 'Extraction: автоизвлечение Mission/Vision/Strategy'],
    ['ai.extractionTypedEntityMinConfidence', envFloat('EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE', 0.6), 'medium', 'Extraction: нижний порог confidence'],
    ['ai.answerCacheTtlSeconds', envInt('ANSWER_CACHE_TTL_SECONDS', 300), 'low', 'Answer cache TTL (сек)'],
    ['ai.retrievalCacheTtlSeconds', envInt('RETRIEVAL_CACHE_TTL_SECONDS', 60), 'low', 'Retrieval cache TTL (сек)'],
    ['ai.contextualizerConfidenceMin', envFloat('CONTEXTUALIZER_CONFIDENCE_MIN', 0.6), 'medium', 'Contextualizer: нижний порог confidence'],
    ['ai.summarizerMessageThreshold', envInt('SUMMARIZER_MESSAGE_THRESHOLD', 20), 'medium', 'Summarizer: порог количества сообщений'],
    ['ai.dialogSummarizerKeepLast', envInt('DIALOG_SUMMARIZER_KEEP_LAST', 10), 'medium', 'Dialog summarizer: сколько последних сообщений оставлять'],
    ['ai.dialogSummarizerStalenessHours', envInt('DIALOG_SUMMARIZER_STALENESS_HOURS', 24), 'medium', 'Dialog summarizer: порог staleness (часы)'],
    ['ai.multiQueryExpansionEnabled', envBool('MULTI_QUERY_EXPANSION_ENABLED', true), 'medium', 'Multi-query expansion включено'],
    ['ai.promptInjectionGuardEnabled', envBool('PROMPT_INJECTION_GUARD_ENABLED', true), 'high', 'Master-flag защиты от prompt-injection'],
  ];
  for (const [key, value, severity, description] of ai) {
    out.push({ key, value, category: 'ai', section: 'pipeline', severity, description });
  }

  // ── Mail-inbox (mail.*) — 7.
  const mailInbox: Array<[string, unknown, Severity, string]> = [
    ['mail.inboxEnabled', envBool('MAIL_INBOX_ENABLED', false), 'medium', 'Master-flag IMAP-поллинга inbox.kora.app'],
    ['mail.inboxDomain', env('MAIL_INBOX_DOMAIN', 'inbox.kora.app'), 'medium', 'Домен IMAP-инбокса'],
    ['mail.inboxImapHost', env('MAIL_INBOX_IMAP_HOST', ''), 'medium', 'IMAP host'],
    ['mail.inboxImapPort', envInt('MAIL_INBOX_IMAP_PORT', 993), 'medium', 'IMAP port'],
    ['mail.inboxImapTls', envBool('MAIL_INBOX_IMAP_TLS', true), 'medium', 'IMAP TLS'],
    ['mail.inboxImapFolder', env('MAIL_INBOX_IMAP_FOLDER', 'INBOX'), 'low', 'IMAP folder'],
    ['mail.inboxMaxPerRun', envInt('MAIL_INBOX_MAX_PER_RUN', 50), 'medium', 'Максимум писем за один проход'],
  ];
  for (const [key, value, severity, description] of mailInbox) {
    out.push({ key, value, category: 'integrations', section: 'mail-inbox', severity, description });
  }

  // ── Security (security.*) — 10.
  const security: Array<[string, unknown, Severity, string]> = [
    ['security.magicLinkTtlMinutes', envInt('MAGIC_LINK_TTL_MINUTES', 15), 'high', 'TTL magic-link (минуты)'],
    ['security.magicLinkRateLimitPerHour', envInt('MAGIC_LINK_RATE_LIMIT_PER_HOUR', 5), 'high', 'Лимит magic-link на email в час'],
    ['security.inviteTtlDays', envInt('INVITE_TTL_DAYS', 14), 'high', 'TTL приглашения сотрудника (дни)'],
    ['security.inviteReminderDays', envInt('INVITE_REMINDER_DAYS', 7), 'medium', 'День напоминания о приглашении'],
    ['security.cryptoMasterKeyRotationDays', envInt('CRYPTO_MASTER_KEY_ROTATION_DAYS', 365), 'destructive', 'Период ротации master-ключа шифрования'],
    ['security.sessionTtlSeconds', envInt('SESSION_TTL_SECONDS', 2_592_000), 'high', 'TTL сессии (сек)'],
    ['security.deepLinkTtlSeconds', envInt('DEEP_LINK_TTL_SECONDS', 86_400), 'high', 'TTL deep-link (сек)'],
    ['security.adminSessionTtlSeconds', envInt('ADMIN_SESSION_TTL_SECONDS', 14_400), 'destructive', 'TTL админской сессии (сек)'],
    ['security.argonMemoryKb', envInt('ARGON_MEMORY_KB', 65536), 'destructive', 'Argon2: memory KB'],
    ['security.argonIterations', envInt('ARGON_ITERATIONS', 3), 'destructive', 'Argon2: iterations'],
    ['security.argonParallelism', envInt('ARGON_PARALLELISM', 1), 'destructive', 'Argon2: parallelism'],
  ];
  for (const [key, value, severity, description] of security) {
    out.push({ key, value, category: 'platform', section: 'security', severity, description });
  }

  // ── Documents (documents.*) — 5. (ТЗ-4 Ф6: +maxFilesPerUpload +acceptedFormats)
  const documents: Array<[string, unknown, Severity, string]> = [
    ['documents.parseTimeoutMs', envInt('DOCUMENT_PARSE_TIMEOUT_MS', 30000), 'medium', 'Таймаут парсинга документа (мс)'],
    ['documents.maxSizeMb', envInt('DOCUMENT_MAX_SIZE_MB', 50), 'medium', 'Максимальный размер одного документа (МБ)'],
    ['documents.inlineThresholdMb', envInt('DOCUMENT_INLINE_THRESHOLD_MB', 5), 'medium', 'Порог inline-загрузки документа (МБ)'],
    // ТЗ-4 Ф3/Ф6 — multipart-загрузка нескольких файлов.
    ['documents.maxFilesPerUpload', envInt('DOCUMENT_MAX_FILES_PER_UPLOAD', 20), 'medium', 'Максимум файлов в одной операции загрузки'],
    [
      'documents.acceptedFormats',
      parseFormats(env('DOCUMENT_ACCEPTED_FORMATS', 'pdf,docx,xlsx,pptx,md,txt,html,rtf,odt,csv')),
      'medium',
      'Белый список расширений документов, принимаемых при загрузке',
    ],
    // ТЗ-4 Ф7 — массовый импорт ZIP-архива.
    ['documents.maxZipSizeMb', envInt('DOCUMENT_MAX_ZIP_SIZE_MB', 200), 'medium', 'Максимальный размер ZIP-архива при массовом импорте (МБ)'],
  ];
  for (const [key, value, severity, description] of documents) {
    out.push({ key, value, category: 'content', section: 'documents', severity, description });
  }

  // ── Clip/export (clip.*, export.*) — 2. (share.* перенесены в отдельную
  // секцию ниже, потому что allowedExpirationDays теперь хранится как
  // number[] — это формат, который ожидает геттер cfg.share после Фазы 5
  // env-to-admin-setting-call-sites-migration.)
  const clipExport: Array<[string, unknown, Severity, string]> = [
    ['clip.maxDurationSeconds', envInt('CLIP_MAX_DURATION_SECONDS', 600), 'medium', 'Максимум длительности клипа (сек)'],
    ['export.zipMaxMeetings', envInt('EXPORT_ZIP_MAX_MEETINGS', 50), 'medium', 'Максимум встреч в zip-экспорте'],
  ];
  for (const [key, value, severity, description] of clipExport) {
    out.push({ key, value, category: 'content', section: 'share-clip-export', severity, description });
  }

  // ── Crossmark (crossmark.*) — 1. Фаза 5.
  const crossmark: Array<[string, unknown, Severity, string]> = [
    ['crossmark.hmacTimestampWindowSeconds', envInt('CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS', 300), 'high', 'Окно валидности HMAC-timestamp для crossmark API (сек)'],
  ];
  for (const [key, value, severity, description] of crossmark) {
    out.push({ key, value, category: 'integrations', section: 'crossmark', severity, description });
  }

  // ── Share (share.*) — 3. Фаза 5. NB: allowedExpirationDays — number[].
  const share: Array<[string, unknown, Severity, string]> = [
    ['share.tokenLengthBytes', envInt('SHARE_TOKEN_LENGTH_BYTES', 24), 'high', 'Длина share-токена в байтах'],
    ['share.defaultExpirationDays', envInt('SHARE_DEFAULT_EXPIRATION_DAYS', 7), 'medium', 'Дефолтный срок жизни share-ссылки (дни)'],
    ['share.allowedExpirationDays', parseShareDays(env('SHARE_ALLOWED_EXPIRATION_DAYS', '1,7,14')), 'medium', 'Допустимые сроки жизни share-ссылки (массив дней)'],
  ];
  for (const [key, value, severity, description] of share) {
    out.push({ key, value, category: 'media', section: 'share', severity, description });
  }

  // ── Email-fetch (emailFetch.*) — 3. Фаза 5.
  const emailFetch: Array<[string, unknown, Severity, string]> = [
    ['emailFetch.enabled', envBool('EMAIL_FETCH_ENABLED', false), 'medium', 'Master-flag cron email-fetch'],
    ['emailFetch.cron', env('EMAIL_FETCH_CRON', '*/5 * * * *'), 'medium', 'Расписание email-fetch cron'],
    ['emailFetch.maxPerRun', envInt('EMAIL_FETCH_MAX_PER_RUN', 50), 'medium', 'Лимит писем за один проход email-fetch'],
  ];
  for (const [key, value, severity, description] of emailFetch) {
    out.push({ key, value, category: 'integrations', section: 'email-fetch', severity, description });
  }

  // ── Idle-meeting (idle.*) — 2. Фаза 5.
  const idle: Array<[string, unknown, Severity, string]> = [
    ['idle.timeoutMinutes', envInt('IDLE_MEETING_TIMEOUT_MINUTES', 15), 'medium', 'Таймаут idle-встречи до авто-завершения (мин)'],
    ['idle.cron', env('IDLE_MEETING_CRON', '*/1 * * * *'), 'medium', 'Расписание idle-meeting cron'],
  ];
  for (const [key, value, severity, description] of idle) {
    out.push({ key, value, category: 'media', section: 'idle', severity, description });
  }

  // ── Pending-actions «требует действия» (pendingActions.*) — 5. Action Center C2.
  const pendingActions: Array<[string, unknown, Severity, string]> = [
    ['pendingActions.reminderWindowStartHour', envInt('PENDING_ACTIONS_REMINDER_WINDOW_START_HOUR', 9), 'low', 'Напоминания: начало окна слотов (локальный час)'],
    ['pendingActions.reminderWindowEndHour', envInt('PENDING_ACTIONS_REMINDER_WINDOW_END_HOUR', 21), 'low', 'Напоминания: конец окна слотов (локальный час)'],
    ['pendingActions.reminderStepHours', envInt('PENDING_ACTIONS_REMINDER_STEP_HOURS', 3), 'low', 'Напоминания: шаг между слотами (часы)'],
    ['pendingActions.urgentAgeDays', envInt('PENDING_ACTIONS_URGENT_AGE_DAYS', 5), 'low', 'Pending Actions: возраст (дни), с которого item помечается срочным'],
    ['pendingActions.reminderLeadDays', envInt('PENDING_ACTIONS_REMINDER_LEAD_DAYS', 3), 'low', 'Pending Actions: за сколько дней до истечения помечать срочным'],
  ];
  for (const [key, value, severity, description] of pendingActions) {
    out.push({ key, value, category: 'platform', section: 'pending-actions', severity, description });
  }

  // ── Probe-система Фаза 3/5 (probe.*) — батч-дайджест + adaptive fatigue.
  const probe: Array<[string, unknown, Severity, string]> = [
    ['probe.digestTouchCap', envInt('PROBE_DIGEST_TOUCH_CAP', 5), 'low', 'Максимум вопросов в одном батч-дайджесте probe'],
    ['probe.digestHourUtc', envInt('PROBE_DIGEST_HOUR_UTC', 9), 'low', 'Час (UTC) ежедневной отправки дайджеста probe'],
    ['probe.digestEnabled', envBool('PROBE_DIGEST_ENABLED', true), 'low', 'Рубильник батч-дайджеста probe (kill-switch, ON)'],
    ['probe.topicCooldownHours', envInt('PROBE_TOPIC_COOLDOWN_HOURS', 48), 'low', 'Cooldown повтора одной темы probe одному человеку (часы)'],
    ['probe.adaptiveFatigueEnabled', envBool('PROBE_ADAPTIVE_FATIGUE_ENABLED', true), 'low', 'Снижать частоту probe тем, кто не отвечает (kill-switch, ON)'],
  ];
  for (const [key, value, severity, description] of probe) {
    out.push({ key, value, category: 'platform', section: 'probe', severity, description });
  }

  // ── W4.3 (2026-05-25) — DataClass policy floors + channel defaults.
  // Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §4.
  // Эти ключи читаются `DataClassPolicyService.getFloor` и UI `/admin/policy/dataclass`.
  out.push({
    key: 'dataclass_policy:floors',
    value: {
      idea_block: 'public',
      insight: 'internal',
      decision: 'internal',
      card_rollup: 'internal',
      executable_persona: 'internal',
      skill_profile: 'internal',
      skill_trait: 'internal',
      idea: 'internal',
      regulation: 'internal',
      process: 'internal',
      policy: 'internal',
      chat_context: 'public',
      ai_usage_log: 'public',
      conflict_item: 'public',
      probe_event: 'internal',
    },
    category: 'policy',
    section: 'dataclass',
    severity: 'high',
    description:
      'Минимальный DataClass-уровень результата по типу проекции (W4.3). Override default-значений из кода DataClassPolicyService.',
  });
  out.push({
    key: 'dataclass_policy:channel_defaults',
    value: {
      in_app: 'private',
      telegram_dm: 'internal',
      telegram_group: 'public',
      email: 'sensitive',
      public_link: 'public',
    },
    category: 'policy',
    section: 'dataclass',
    severity: 'high',
    description:
      'Дефолтный потолок чувствительности для нового канала по его kind (W4.3). Применяется при создании ChannelBinding. Пользователь может опустить ниже в /me/channels, но не поднять выше.',
  });

  return out;
}

// ─────────────────────────── plans / crons / templates / retention ──────

async function seedPlans(counters: SeedCounters): Promise<void> {
  const plans: Array<{
    id: string;
    displayName: string;
    description: string;
    features: Record<string, boolean>;
    quotas: Record<string, number>;
    monthlyPriceRub: number | null;
    sortOrder: number;
  }> = [
    {
      id: 'tier_basic',
      displayName: 'Basic',
      description: 'Стартовый тариф для команд до 5 человек.',
      features: {
        ai_chat: true,
        employee_clones: false,
        custom_prompt_templates: false,
        knowledge_graph: true,
        proactive_watcher: false,
      },
      quotas: {
        max_meetings_per_day: 20,
        max_chat_tokens_per_day: 200_000,
        max_chat_requests_per_day: 100,
        max_render_jobs_per_hour: 10,
        max_bulk_exports_per_day: 2,
        max_embedding_tokens_per_month_per_user: 2_000_000,
      },
      monthlyPriceRub: 0,
      sortOrder: 1,
    },
    {
      id: 'tier_pro',
      displayName: 'Pro',
      description: 'Профессиональный тариф для команд до 50 человек.',
      features: {
        ai_chat: true,
        employee_clones: true,
        custom_prompt_templates: true,
        knowledge_graph: true,
        proactive_watcher: true,
      },
      quotas: {
        max_meetings_per_day: envInt('MAX_MEETINGS_CREATED_PER_DAY_VIA_API', 100),
        max_chat_tokens_per_day: envInt('MAX_CHAT_TOKENS_PER_DAY', 1_000_000),
        max_chat_requests_per_day: envInt('MAX_CHAT_REQUESTS_PER_DAY', 500),
        max_render_jobs_per_hour: envInt('MAX_RENDER_JOBS_PER_HOUR', 50),
        max_bulk_exports_per_day: envInt('MAX_BULK_EXPORTS_PER_DAY', 5),
        max_embedding_tokens_per_month_per_user: envInt('MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER', 10_000_000),
      },
      monthlyPriceRub: 9900,
      sortOrder: 2,
    },
    {
      id: 'tier_enterprise',
      displayName: 'Enterprise',
      description: 'Корпоративный тариф с расширенным SLA и SSO.',
      features: {
        ai_chat: true,
        employee_clones: true,
        custom_prompt_templates: true,
        knowledge_graph: true,
        proactive_watcher: true,
        sso: true,
        audit_export: true,
      },
      quotas: {
        max_meetings_per_day: 1000,
        max_chat_tokens_per_day: 10_000_000,
        max_chat_requests_per_day: 5000,
        max_render_jobs_per_hour: 500,
        max_bulk_exports_per_day: 50,
        max_embedding_tokens_per_month_per_user: 100_000_000,
      },
      monthlyPriceRub: null,
      sortOrder: 3,
    },
  ];

  for (const p of plans) {
    const existing = await prisma.plan.findUnique({ where: { id: p.id } });
    const data: Prisma.PlanUncheckedCreateInput = {
      id: p.id,
      displayName: p.displayName,
      description: p.description,
      features: p.features as Prisma.InputJsonValue,
      quotas: p.quotas as Prisma.InputJsonValue,
      monthlyPriceRub: p.monthlyPriceRub,
      sortOrder: p.sortOrder,
    };
    if (!existing) {
      await prisma.plan.create({ data });
      counters.plansCreated++;
    } else {
      await prisma.plan.update({
        where: { id: p.id },
        data: {
          displayName: p.displayName,
          description: p.description,
          features: p.features as Prisma.InputJsonValue,
          quotas: p.quotas as Prisma.InputJsonValue,
          monthlyPriceRub: p.monthlyPriceRub,
          sortOrder: p.sortOrder,
        },
      });
      counters.plansUpdated++;
    }
  }
}

async function seedCrons(counters: SeedCounters): Promise<void> {
  // (name, ENV_VAR, fallback, description)
  const crons: Array<[string, string, string, string]> = [
    ['email-fetch', 'EMAIL_FETCH_CRON', '*/15 * * * *', 'IMAP-поллер inbound писем'],
    ['retention-sweep', 'RETENTION_CRON', '0 3 * * *', 'Глобальный retention-sweep'],
    ['idle-meeting', 'IDLE_MEETING_CRON', '*/5 * * * *', 'Завершение idle-встреч'],
    ['entity-resolver', 'ENTITY_RESOLVER_CRON', '0 4 * * *', 'Knowledge: entity-resolver'],
    ['reframing', 'REFRAMING_CRON', '15 4 * * *', 'Knowledge: reframing'],
    ['entity-graph-builder', 'ENTITY_GRAPH_BUILDER_CRON', '30 4 * * *', 'Knowledge: entity-graph-builder'],
    ['theme-clusterer', 'THEME_CLUSTERER_CRON', '45 4 * * *', 'Knowledge: theme-clusterer'],
    ['meeting-analyze-v2', 'MEETING_ANALYZE_V2_CRON', '*/5 * * * *', 'Knowledge: meeting-analyze-v2'],
    ['dialog-summarizer', 'DIALOG_SUMMARIZER_CRON', '0 */6 * * *', 'Dialog summarizer'],
    ['chat-v2-cleanup', 'CHAT_V2_CLEANUP_CRON', '0 3 * * *', 'ChatV2: очистка старых conversation'],
    ['mail-inbox-poll', 'MAIL_INBOX_POLL_CRON', '*/2 * * * *', 'IMAP-поллер mail-inbox'],
    ['insight-cluster', 'INSIGHT_CLUSTER_CRON', '*/30 * * * *', 'Insights clusterer'],
    ['idea-clusterer', 'IDEA_CLUSTERER_CRON', '0 */4 * * *', 'Ideas clusterer'],
    ['knowledge-clone-rebuild', 'KNOWLEDGE_CLONE_REBUILD_CRON', '0 5 * * *', 'Knowledge clone rebuild'],
    ['probe-priority-refresh', 'PROBE_PRIORITY_REFRESH_CRON', '0 */6 * * *', 'Probe priority refresh'],
    ['skill-recalibrate', 'SKILL_RECALIBRATE_CRON', '0 6 * * *', 'Skill recalibrate'],
    ['skill-manager-digest', 'SKILL_MANAGER_DIGEST_CRON', '0 9 * * 1', 'Skill manager digest'],
    ['persona-build', 'PERSONA_BUILD_CRON', '0 5 * * 0', 'Persona weekly build'],
    ['process-template-completeness', 'PROCESS_TEMPLATE_COMPLETENESS_CRON', '0 3 * * *', 'Process template completeness'],
    ['card-stale-detector', 'CARD_STALE_DETECTOR_CRON', '0 4 * * *', 'Card stale detector'],
    ['budget-alert', 'BUDGET_ALERT_CRON', '*/30 * * * *', 'Budget alert cron'],
    ['currency-rate-sync', 'CURRENCY_RATE_SYNC_CRON', '0 7 * * *', 'Currency rate sync'],
    ['provider-smoke-test', 'PROVIDER_SMOKE_TEST_CRON', '*/30 * * * *', 'Provider smoke test'],
    ['daily-cost-aggregator', 'DAILY_COST_AGGREGATOR_CRON', '5 0 * * *', 'Daily cost aggregator'],
    ['org-economics', 'ORG_ECONOMICS_CRON', '15 0 * * *', 'Org economics aggregator'],
  ];

  for (const [name, envKey, fallback, description] of crons) {
    const expression = env(envKey, fallback);
    const existing = await prisma.cronSchedule.findUnique({ where: { name } });
    if (!existing) {
      await prisma.cronSchedule.create({
        data: {
          name,
          expression,
          defaultExpression: expression,
          enabled: true,
          description,
        },
      });
      counters.cronsCreated++;
    } else if (!existing.updatedBy || existing.updatedBy === 'system') {
      // Системная запись — обновляем defaultExpression и description, но
      // expression только если он совпадал с default'ом (т.е. админ не менял).
      const shouldUpdateExpression = existing.expression === existing.defaultExpression;
      await prisma.cronSchedule.update({
        where: { name },
        data: {
          ...(shouldUpdateExpression ? { expression } : {}),
          defaultExpression: expression,
          description,
        },
      });
      counters.cronsUpdated++;
    }
  }
}

async function seedEmailTemplates(counters: SeedCounters): Promise<void> {
  const templates: Array<{
    key: string;
    subject: string;
    body: string;
    variables: Record<string, string>;
    category: string;
  }> = [
    {
      key: 'register_temp_password',
      subject: 'Аккаунт в Z создан',
      body: REGISTER_TEMP_PASSWORD_TEMPLATE,
      variables: {
        name: 'имя получателя',
        to: 'email получателя (для входа)',
        tempPassword: 'временный пароль',
        loginUrl: 'ссылка на страницу входа',
      },
      category: 'transactional',
    },
    {
      key: 'invite_github_style',
      subject: 'Вас приглашают в компанию в Коре',
      body: INVITE_GITHUB_STYLE_TEMPLATE,
      variables: {
        name: 'имя приглашённого',
        inviterName: 'имя пригласившего',
        orgName: 'название компании',
        magicLinkUrl: 'magic-link на вход',
        telegramDeepLink: 'deep-link в Telegram-бота',
        ttlDays: 'срок действия приглашения в днях',
      },
      category: 'transactional',
    },
    {
      key: 'invite_reminder',
      subject: 'Напоминаем о приглашении в Кору',
      body: INVITE_REMINDER_TEMPLATE,
      variables: {
        name: 'имя приглашённого',
        inviterName: 'имя пригласившего',
        orgName: 'название компании',
        daysLeft: 'дней осталось до истечения',
        magicLinkUrl: 'magic-link на вход',
        telegramDeepLink: 'deep-link в Telegram-бота',
      },
      category: 'transactional',
    },
    {
      key: 'invite_director_timeout',
      subject: 'Приглашение сотрудника истекло',
      body: INVITE_DIRECTOR_TIMEOUT_TEMPLATE,
      variables: {
        directorName: 'имя директора',
        employeeName: 'имя сотрудника',
        employeeEmail: 'email сотрудника (опционально)',
        orgName: 'название компании',
        teamPageUrl: 'ссылка на раздел Сотрудники',
      },
      category: 'transactional',
    },
    {
      key: 'password_reset',
      subject: 'Сброс пароля в Z',
      body: PASSWORD_RESET_TEMPLATE,
      variables: {
        name: 'имя получателя',
        resetUrl: 'ссылка на сброс пароля',
        expiresInMinutes: 'TTL ссылки в минутах',
      },
      category: 'transactional',
    },
  ];

  for (const t of templates) {
    const existing = await prisma.emailTemplate.findUnique({ where: { key: t.key } });
    const data: Prisma.EmailTemplateUncheckedCreateInput = {
      key: t.key,
      subject: t.subject,
      body: t.body,
      variables: t.variables as Prisma.InputJsonValue,
      category: t.category,
    };
    if (!existing) {
      await prisma.emailTemplate.create({ data });
      counters.emailTemplatesCreated++;
    } else if (!existing.updatedBy || existing.updatedBy === 'system') {
      await prisma.emailTemplate.update({
        where: { key: t.key },
        data: {
          subject: t.subject,
          body: t.body,
          variables: t.variables as Prisma.InputJsonValue,
          category: t.category,
        },
      });
      counters.emailTemplatesUpdated++;
    }
  }
}

async function seedRetentionPolicies(counters: SeedCounters): Promise<void> {
  const policies: Array<[string, number, string]> = [
    ['default', envInt('DEFAULT_RETENTION_DAYS', 90), 'Дефолтное хранение по умолчанию'],
    ['soft_delete_grace', envInt('SOFT_DELETE_GRACE_DAYS', 30), 'Льготный период после soft-delete'],
    ['webhook_delivery', envInt('WEBHOOK_DELIVERY_RETENTION_DAYS', 14), 'Журнал webhook-доставок'],
    ['share_view', envInt('SHARE_VIEW_RETENTION_DAYS', 90), 'Логи просмотров shared-ссылок'],
    ['api_access_log', envInt('API_ACCESS_LOG_RETENTION_DAYS', 30), 'Журнал API-обращений'],
    ['meeting_recording', envInt('MEETING_RECORDING_RETENTION_DAYS', 90), 'Записи встреч'],
    ['raw_events', envInt('RAW_EVENTS_RETENTION_DAYS', 30), 'Raw-события knowledge-core'],
  ];
  for (const [type, days, description] of policies) {
    const existing = await prisma.retentionPolicy.findUnique({ where: { type } });
    if (!existing) {
      await prisma.retentionPolicy.create({ data: { type, days, description } });
      counters.retentionsCreated++;
    } else if (!existing.updatedBy || existing.updatedBy === 'system') {
      await prisma.retentionPolicy.update({
        where: { type },
        data: { days, description },
      });
      counters.retentionsUpdated++;
    }
  }
}

// ─────────────────────────────── main ────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== seed-admin-settings START ===');

  const counters: SeedCounters = {
    settingsCreated: 0,
    settingsUpdated: 0,
    settingsSkipped: 0,
    plansCreated: 0,
    plansUpdated: 0,
    cronsCreated: 0,
    cronsUpdated: 0,
    emailTemplatesCreated: 0,
    emailTemplatesUpdated: 0,
    retentionsCreated: 0,
    retentionsUpdated: 0,
  };

  const settings = buildSettings();
  console.log(`Загружено ${settings.length} seed-настроек`);

  for (const s of settings) {
    await upsertSetting(s, counters);
  }
  await seedPlans(counters);
  await seedCrons(counters);
  await seedEmailTemplates(counters);
  await seedRetentionPolicies(counters);

  console.log('=== seed-admin-settings SUMMARY ===');
  console.log(
    `settings:           created=${counters.settingsCreated}, updated=${counters.settingsUpdated}, skipped(admin-edited)=${counters.settingsSkipped}`,
  );
  console.log(
    `plans:              created=${counters.plansCreated}, updated=${counters.plansUpdated}`,
  );
  console.log(
    `crons:              created=${counters.cronsCreated}, updated=${counters.cronsUpdated}`,
  );
  console.log(
    `email-templates:    created=${counters.emailTemplatesCreated}, updated=${counters.emailTemplatesUpdated}`,
  );
  console.log(
    `retention-policies: created=${counters.retentionsCreated}, updated=${counters.retentionsUpdated}`,
  );
  console.log(
    `Создано/обновлено: ${counters.settingsCreated + counters.settingsUpdated} settings, ${counters.plansCreated + counters.plansUpdated} plans, ${counters.cronsCreated + counters.cronsUpdated} crons, ${counters.emailTemplatesCreated + counters.emailTemplatesUpdated} email templates, ${counters.retentionsCreated + counters.retentionsUpdated} retention policies.`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('seed-admin-settings: ERROR', err);
    await prisma.$disconnect();
    process.exit(1);
  });
