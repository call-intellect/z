/**
 * Admin-redesign Фаза 3 — реестр Zod-схем для AdminSetting-ключей.
 *
 * Назначение:
 *   - Серверный источник правды для валидации `value` при POST /admin/settings/:key
 *     (на будущих фазах подключим через ZodValidationPipe).
 *   - Источник JSON-Schema для фронта: AdminSettingField автогенерирует контрол
 *     (number/integer/boolean/string/enum) по описанию из
 *     `GET /admin/settings/schema/:key`.
 *
 * Конвертация в JSON-Schema — самописная (без зависимости `zod-to-json-schema`).
 * Поддерживаем именно те конструкции, которые реально используются для
 * knowledge.* и embeddings.*: `z.number().min().max()`, `z.number().int().positive()`,
 * `z.boolean()`, `z.string()`, `z.enum([...])`. Для остального — `z.unknown()`
 * → `{ type: 'unknown' }`.
 *
 * Ключи берутся из `backend/scripts/seed-admin-settings.ts` (Фаза 0). Если в
 * сиде появится новый knowledge.X/embeddings.X — он автоматически попадёт
 * в раздел AI админки, но без типизированной схемы (фронт упадёт на
 * JSON-инпут). Чтобы избежать этого — держим эти два модуля
 * синхронизированными.
 */

import { z, type ZodTypeAny } from 'zod';

// ────────────────────────────── helpers ──────────────────────────────────

const POSITIVE_INT = z.number().int().positive();
const NON_NEGATIVE_INT = z.number().int().nonnegative();
const UNIT_INTERVAL = z.number().min(0).max(1);

// ────────────────────────────── registry ─────────────────────────────────

/**
 * Реестр Zod-схем по ключу AdminSetting.
 *
 * ВАЖНО: ключи здесь — те же, что в `seed-admin-settings.ts`
 * (camelCase, prefix `knowledge.` / `embeddings.`).
 */
const registry = new Map<string, ZodTypeAny>([
  // ── knowledge-core: пороги [0..1] ─────────────────────────────────────
  ['knowledge.distillMergeThreshold', UNIT_INTERVAL],
  ['knowledge.entityMergeThreshold', UNIT_INTERVAL],
  ['knowledge.themeCosineThreshold', UNIT_INTERVAL],
  ['knowledge.ideaClusterThreshold', UNIT_INTERVAL],
  ['knowledge.insightClusterThreshold', UNIT_INTERVAL],
  ['knowledge.searchCosineWeight', UNIT_INTERVAL],
  ['knowledge.searchBm25Weight', UNIT_INTERVAL],
  ['knowledge.linkMinConfidence', UNIT_INTERVAL],
  ['knowledge.skillTraitSimilarityThreshold', UNIT_INTERVAL],
  ['knowledge.curationAutoThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationDeepReviewThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationStaleDynamicScoreThreshold', UNIT_INTERVAL],
  // Action Center «лестница доверия» A1/A2 — пороги [0..1].
  ['knowledge.curationProvisionalThresholdDefault', UNIT_INTERVAL],
  ['knowledge.curationAuditSampleRate', UNIT_INTERVAL],
  ['knowledge.curationThresholdMin', UNIT_INTERVAL],
  ['knowledge.curationThresholdMax', UNIT_INTERVAL],
  ['knowledge.curationAutotuneStep', UNIT_INTERVAL],
  ['knowledge.curationMaxProvisionalOverride', UNIT_INTERVAL],
  ['knowledge.insightSpikeRatio', z.number().min(0).max(100)],

  // ── knowledge-core: целые положительные ───────────────────────────────
  ['knowledge.distillDebounceMs', POSITIVE_INT],
  ['knowledge.distillKnnTopK', POSITIVE_INT],
  ['knowledge.blockIngestWindowSegments', POSITIVE_INT],
  ['knowledge.blockIngestMaxTokensPerSegment', POSITIVE_INT],
  ['knowledge.linkerMinBlocks', POSITIVE_INT],
  ['knowledge.linkKnnTopK', POSITIVE_INT],
  ['knowledge.blockDynamicScoreDecayDays', POSITIVE_INT],
  ['knowledge.entityGraphMinComentions', POSITIVE_INT],
  ['knowledge.themeClusteringMinBlocks', POSITIVE_INT],
  ['knowledge.themeClusterMinSize', POSITIVE_INT],
  ['knowledge.cardRollupV2DebounceMs', POSITIVE_INT],
  ['knowledge.meetingAnalyzeV2DebounceMs', POSITIVE_INT],
  ['knowledge.chatV2TopBlocks', POSITIVE_INT],
  ['knowledge.chatV2GraphHops', POSITIVE_INT],
  ['knowledge.insightFrequencyWindowDays', POSITIVE_INT],
  ['knowledge.ideaMinSupportersForCluster', POSITIVE_INT],
  ['knowledge.skillMinObservations', POSITIVE_INT],
  ['knowledge.skillLookbackMonths', POSITIVE_INT],
  ['knowledge.skillDecayMonths', POSITIVE_INT],
  ['knowledge.skillArchiveMonths', POSITIVE_INT],
  ['knowledge.personaMinTraits', POSITIVE_INT],
  ['knowledge.personaRoleAggMinPersons', POSITIVE_INT],
  ['knowledge.curationItemExpiryDays', POSITIVE_INT],
  ['knowledge.curationStaleMonthsThreshold', POSITIVE_INT],
  ['knowledge.curationMinDecisionsForAutotune', POSITIVE_INT],
  ['knowledge.executablePersonaThresholdTraitsCount', POSITIVE_INT],

  // ── knowledge-core: master-flag ──────────────────────────────────────
  ['knowledge.v2AgentsEnabled', z.boolean()],
  ['knowledge.chatV2Enabled', z.boolean()],
  // Action Center «лестница доверия» A1/A2 — булевы флаги.
  ['knowledge.curationAiVerifierEnabled', z.boolean()],
  ['knowledge.curationAutotuneEnabled', z.boolean()],
  // Kill-switch детерминированной атрибуции авторства IdeaBlock (subject).
  ['knowledge.subjectAttributionEnabled', z.boolean()],
  // Ф1 (knowledge-access) — привязка автора (subject) на ВСЕ типы знания,
  // не только reasoning-семейство (false = только reasoning).
  ['knowledge.subjectAttributionAllTypes', z.boolean()],
  // Поэтапная раскатка (ТЗ 2026-06-04 meeting-identity-and-clones Ф5.2):
  // true = из встречи рождается ТОЛЬКО tracker Issue (видимый артефакт),
  // пользовательский Task для action-items НЕ создаётся, а потребители
  // читают задачи встречи из Issue. Дефолт FALSE — текущее поведение (Task).
  ['knowledge.meetingTasksToTrackerOnly', z.boolean()],
  // Ф1 idea direct-path (2026-06-08) — kill-switch материализации Idea
  // напрямую из блока встречи (signalType='idea') в block-ingest.
  ['knowledge.ideaDirectPathEnabled', z.boolean()],

  // ── семантический дедуп задач встречи (Ф5 Р2, 2026-06-08) ─────────────
  // taskDedupeEnabled — флаг (дефолт FALSE, data-affecting); taskDedupeThreshold
  // — KNN cosine-порог уверенного слияния fast-черновика в canonical.
  ['meetings.taskDedupeEnabled', z.boolean()],
  ['meetings.taskDedupeThreshold', UNIT_INTERVAL],

  // ── граф Apache AGE: kill-switch (МТЗ «разблокировка конвейера» Ф5) ────
  ['graph.ageEnabled', z.boolean()],

  // ── AI feature-flags (aiFeatures.*) ──────────────────────────────────
  // ТЗ 2026-06-07 agent-chain-overhaul Ф5 / Р6 — флаг legacy summary-агента
  // (analyze.worker runSummary, MiniMax). Дефолт TRUE — обратимо; false = −1
  // LLM-вызов, каноническая сводка из summaryFast (meeting-report-fast).
  ['aiFeatures.summaryAgentEnabled', z.boolean()],

  // ── LLM cache-smoke (llm.*) — Ф6 Часть 3, наблюдаемость ───────────────
  // cacheSmokeEnabled — включает smoke-проверку доли cache-хитов в cron'е.
  // cacheHitRatioWarnThreshold — порог [0..1]: ниже → WARN в логи.
  ['llm.cacheSmokeEnabled', z.boolean()],
  ['llm.cacheHitRatioWarnThreshold', UNIT_INTERVAL],

  // ── embeddings ───────────────────────────────────────────────────────
  ['embeddings.provider', z.string().trim().min(1)],
  ['embeddings.model', z.string().trim().min(1)],
  ['embeddings.dimensions', POSITIVE_INT],
  ['embeddings.fallbackLocalUrl', z.string()],
  ['embeddings.batchSize', POSITIVE_INT],
  ['embeddings.chunkTargetTokens', POSITIVE_INT],
  ['embeddings.chunkOverlapTokens', NON_NEGATIVE_INT],

  // ── feature-flags (feature.*) ────────────────────────────────────────
  // Smart-tables auto-creation (2026-06-02, Фаза 1) — Text-to-Schema.
  ['feature.tables_text_to_schema', z.boolean()],

  // ── Smart-tables агент (table.agent.*) — Фаза 3 Event-to-Cells ────────
  // Порог confidence: ≥ порога и ячейка пуста → авто-патч; иначе очередь.
  ['table.agent.confirmation_threshold', UNIT_INTERVAL],
  // Throttle: max одновременных enrich-job на Org (Redis-счётчик).
  ['table.agent.max_concurrent_enrich_jobs_per_org', POSITIVE_INT],
  // Дневной бюджет токенов агента таблиц на Org.
  ['table.agent.max_daily_tokens', POSITIVE_INT],

  // ── Smart-tables импорт из файла (table.import.*) — Фаза 4 Document-to-Table
  // Порог cosine-схожести схем: ≥ порога → предлагаем «слить» с таблицей.
  ['table.import.dedup_threshold', UNIT_INTERVAL],

  // ── Trekker: авто-триаж задач из встреч (tracker.*) ──────────────────
  // Ф3 agent-chain-overhaul (2026-06-07): порог авто-создания Issue из триажа.
  // Дефолт 0.75 (живая речь). Жёсткие гейты source=meeting+assignee+project.
  ['tracker.autoAcceptConfidenceThreshold', UNIT_INTERVAL],

  // ── Goals OKR v2 Фаза 4 — еженедельный пульс целей (goals.pulse.*) ────
  ['goals.pulse.enabled', z.boolean()],
  ['goals.pulse.deliver_to_telegram', z.boolean()],

  // ── Agent-chain overhaul Фаза 4.2 — авто-привязка тем к целям (goals.*) ──
  ['goals.themeAutolinkMinWeight', UNIT_INTERVAL],
  ['goals.themeAutolinkLlmEnabled', z.boolean()],

  // ── Agent-chain overhaul Фаза 4.1 — авто-привязка задач к целям (goals.*) ──
  ['goals.goalTaskLinkEnabled', z.boolean()],

  // ── TZ-1 Ф3.D (daily-value-engine) — фиксы достоверности агентов ──────
  // goal-vector: мин. покрытие commitmentAuthorPersonId для атрибуции автору.
  ['goals.author_coverage_min', UNIT_INTERVAL],
  // надёжность обещаний: мин. знаменатель, ниже которого «мало данных».
  ['reliability.min_denominator', POSITIVE_INT],
  // probe-триггеры burnout-детектора (пороги детекции).
  ['probe.reply_latency_rise.factor', z.number().positive()],
  ['probe.workload_overload.load_percent', POSITIVE_INT],
  ['probe.meeting_noshows.count', POSITIVE_INT],

  // ── billing: tier_standard ───────────────────────────────────────────
  ['billing.baseMonthlyKopecks', NON_NEGATIVE_INT],
  ['billing.perExtraSeatKopecks', NON_NEGATIVE_INT],
  ['billing.yearlyDiscountRate', UNIT_INTERVAL],
  ['billing.baseSeatsIncluded', POSITIVE_INT],
  ['billing.baseMeetingsGrant', NON_NEGATIVE_INT],
  ['billing.perExtraSeatMeetingsGrant', NON_NEGATIVE_INT],

  // ── TZ-1 Фаза 0 (daily-value-engine) — дневной бюджет уведомлений ──────
  ['notifications.daily_budget.per_person', POSITIVE_INT],
  ['notifications.quiet_hours.start', z.number().int().min(0).max(23)],
  ['notifications.quiet_hours.end', z.number().int().min(0).max(23)],
  ['notifications.daily_budget.enabled', z.boolean()],
  ['notifications.binding_campaign.enabled', z.boolean()],

  // ── TZ-1 Фаза 1 (daily-value-engine) — радар клиентов под риском ──────
  ['customer_risk.window_days', POSITIVE_INT],
  ['customer_risk.weight.churn_risk', NON_NEGATIVE_INT],
  ['customer_risk.weight.objection', NON_NEGATIVE_INT],
  ['customer_risk.weight.pain', NON_NEGATIVE_INT],
  ['customer_risk.weight.feature_request', NON_NEGATIVE_INT],
  ['customer_risk.threshold.critical', NON_NEGATIVE_INT],
  ['customer_risk.threshold.warning', NON_NEGATIVE_INT],
  ['operations.customer_risk_radar.enabled', z.boolean()],

  // ── pending-actions «требует действия» (Action Center C2) ─────────────
  // Окно/шаг слот-часов Telegram-напоминаний + пороги срочности.
  ['pendingActions.reminderWindowStartHour', z.number().int().min(0).max(23)],
  ['pendingActions.reminderWindowEndHour', z.number().int().min(0).max(23)],
  ['pendingActions.reminderStepHours', POSITIVE_INT],
  ['pendingActions.urgentAgeDays', POSITIVE_INT],
  ['pendingActions.reminderLeadDays', POSITIVE_INT],
]);

/**
 * Возвращает Zod-схему для ключа, либо `z.unknown()` если ключ не описан.
 * Используем для serverside-валидации (на будущих фазах) и для генерации
 * JSON-Schema под фронт.
 */
export function getSchemaForKey(key: string): ZodTypeAny {
  return registry.get(key) ?? z.unknown();
}

export function hasSchemaForKey(key: string): boolean {
  return registry.has(key);
}

// ─────────────────────── Zod → simplified JSON-Schema ───────────────────

/**
 * Облегчённый JSON-Schema-эквивалент, рассчитан под форму
 * `AdminSettingField` на фронте:
 *   - `type`: 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'unknown'
 *   - `min` / `max` (опционально) для number/integer
 *   - `enumValues` для enum
 *
 * Стандартное `zod-to-json-schema` в проекте не подключено (см. комментарий
 * в шапке файла). Инспектим `_def` рекурсивно, разворачивая обёртки
 * Default/Optional/Effects.
 */
export interface SimpleJsonSchema {
  type: 'number' | 'integer' | 'boolean' | 'string' | 'enum' | 'unknown';
  min?: number;
  max?: number;
  enumValues?: ReadonlyArray<string>;
}

/**
 * Внутренняя структура `_def` в Zod v4 (упрощённая под наши нужды):
 *   { type: 'number'|'boolean'|'string'|'enum'|'optional'|'default'|'nullable'|'pipe',
 *     checks?: Array<{ _zod?: { def?: { check: string, value?: unknown,
 *                                       inclusive?: boolean, format?: string } } }>,
 *     entries?: Record<string, string>,     // для enum
 *     innerType?: ZodTypeAny,               // для optional/default/nullable
 *     in?/out?: ZodTypeAny,                 // для pipe
 *   }
 *
 * Используем именно эту схему, потому что `zod-to-json-schema` в проект
 * не добавляем (см. комментарий в шапке файла).
 */
interface CheckDef {
  check?: string;
  value?: unknown;
  inclusive?: boolean;
  format?: string;
}
interface ZodCheck {
  _zod?: { def?: CheckDef };
}
interface ZodDef {
  type?: string;
  checks?: ReadonlyArray<ZodCheck>;
  entries?: Record<string, string>;
  innerType?: ZodTypeAny;
  in?: ZodTypeAny;
  out?: ZodTypeAny;
}

function getDef(schema: ZodTypeAny): ZodDef {
  return (schema as unknown as { _def: ZodDef })._def ?? {};
}

/**
 * Снимает обёртки optional/default/nullable/pipe, чтобы добраться до
 * базового типа (number/boolean/string/enum). Поддерживаем рекурсию до
 * 10 уровней — этого хватает для всех практических цепочек.
 */
function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = schema;
  for (let i = 0; i < 10; i++) {
    const def = getDef(current);
    if (
      def.type === 'optional' ||
      def.type === 'default' ||
      def.type === 'nullable'
    ) {
      const inner = def.innerType;
      if (!inner) break;
      current = inner;
      continue;
    }
    if (def.type === 'pipe') {
      const inner = def.out ?? def.in;
      if (!inner) break;
      current = inner;
      continue;
    }
    break;
  }
  return current;
}

export function zodToSimpleSchema(schema: ZodTypeAny): SimpleJsonSchema {
  const unwrapped = unwrap(schema);
  const def = getDef(unwrapped);
  const type = def.type;

  if (type === 'number') {
    let isInt = false;
    let min: number | undefined;
    let max: number | undefined;
    for (const check of def.checks ?? []) {
      const cdef = check._zod?.def;
      if (!cdef) continue;
      if (cdef.check === 'number_format') {
        // safeint/int32/int64 = целое число
        if (
          cdef.format === 'safeint' ||
          cdef.format === 'int32' ||
          cdef.format === 'int64'
        ) {
          isInt = true;
        }
      }
      if (cdef.check === 'greater_than' && typeof cdef.value === 'number') {
        // Для строгого '>' (positive) увеличиваем нижний bound на eps в
        // случае целого — но для нашей UI-формы достаточно вернуть 0.
        const candidate = cdef.inclusive ? cdef.value : cdef.value;
        min = min === undefined ? candidate : Math.max(min, candidate);
      }
      if (cdef.check === 'less_than' && typeof cdef.value === 'number') {
        const candidate = cdef.value;
        max = max === undefined ? candidate : Math.min(max, candidate);
      }
    }
    const out: SimpleJsonSchema = { type: isInt ? 'integer' : 'number' };
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
    return out;
  }

  if (type === 'boolean') {
    return { type: 'boolean' };
  }

  if (type === 'string') {
    return { type: 'string' };
  }

  if (type === 'enum') {
    const values = def.entries ? Object.values(def.entries) : [];
    return {
      type: 'enum',
      enumValues: values,
    };
  }

  return { type: 'unknown' };
}
