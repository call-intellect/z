/**
 * Промпт `meeting-report-fast` (ТЗ 2026-05-25, Фаза 1).
 *
 * Источник: plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md §4.1.
 * Эталон: backend/scripts/eval/run-variant-b-single.ts — там обкатан
 * системный промпт + tool-схема `submit_meeting_analysis`, экспериментально
 * доказана эффективность (см. SUMMARY-ALL.md).
 *
 * Один LLM-вызов по СЫРОМУ транскрипту выдаёт ОДНОВРЕМЕННО:
 *   1. chapters (главы встречи)
 *   2. tasks (явные поручения / action items)
 *   3. summary_markdown (итоговая сводка ПО ТИПУ встречи)
 *   4. quality_score (оценка качества встречи)
 *
 * Структура промта:
 *   - Builder с параметром `meetingType: MeetingType`.
 *   - Общие 3 секции (chapters, tasks, quality_score) — единые для всех типов.
 *   - Секция summary_markdown — шаблон ЗАВИСИТ от типа встречи.
 *     Шаблоны — в `SUMMARY_TEMPLATE_BY_TYPE`.
 *
 * Code-fallback. Прокачка в admin-editable БД-registry (`PromptTemplate`/
 * `PromptResolverService`) — в Фазе 4 (см. ТЗ §5).
 *
 * Связанный voркер: `MeetingReportFastWorker`
 *   (`backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts`).
 * Связанный route LlmTaskType: `meeting-report-fast` (см. seed-скрипт).
 */

import type { MeetingType } from '@prisma/client';
import { z } from 'zod';

import type { LlmTool } from '../llm.types';

/** taskType для LlmRouter (см. llm-router.service.ts ALL_LLM_TASK_TYPES). */
export const MEETING_REPORT_FAST_TASK_TYPE = 'meeting-report-fast' as const;

/** Имя tool'а для structured output (LLM-tool-use). */
export const MEETING_REPORT_FAST_TOOL_NAME = 'submit_meeting_analysis';

/**
 * Дефолтный лимит выходных токенов. Объединённый вывод (chapters + tasks +
 * summary + quality_score) — большой; для DeepSeek-V4-Pro с thinking стоит
 * 32k (см. `backend/scripts/eval/run-variant-b-single.ts`).
 */
export const MEETING_REPORT_FAST_MAX_TOKENS = 32000;

// ──────────────────────────── Zod-схема ────────────────────────────

const ScoreInt = z.number().int().min(0).max(100);

const RecommendationCategory = z.enum([
  'preparation',
  'structure',
  'clarity',
  'outcomes',
  'engagement',
]);

const RecommendationSeverity = z.enum(['info', 'warning', 'critical']);

export const MeetingReportFastChapterSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
  })
  .strict();

export const MeetingReportFastTaskSchema = z
  .object({
    title: z.string().min(1),
    assigneeRaw: z.string().nullable().optional(),
    dueDateIso: z.string().nullable().optional(),
    sourceQuote: z.string().optional(),
    /**
     * Confidence [0..1] — defensive: НЕ ограничиваем строго .min/.max,
     * caller (worker) обязан clamp'ить перед сохранением. См. F16 / common.ts.
     */
    confidence: z.number(),
  })
  .strict();

export const MeetingReportFastQualityScoreSchema = z
  .object({
    overallScore: ScoreInt,
    categories: z.object({
      preparation: ScoreInt,
      structure: ScoreInt,
      clarity: ScoreInt,
      outcomes: ScoreInt,
      engagement: ScoreInt,
    }),
    recommendations: z
      .array(
        z.object({
          text: z.string().min(1),
          severity: RecommendationSeverity,
          category: RecommendationCategory,
        }),
      )
      .min(1)
      .max(10),
    strengths: z.array(z.string().min(1)).max(8),
  })
  .strict();

export const MeetingReportFastSchema = z
  .object({
    chapters: z.array(MeetingReportFastChapterSchema),
    tasks: z.array(MeetingReportFastTaskSchema),
    summary_markdown: z.string(),
    quality_score: MeetingReportFastQualityScoreSchema,
  })
  .strict();

export type MeetingReportFastOutput = z.infer<typeof MeetingReportFastSchema>;
export type MeetingReportFastChapter = z.infer<typeof MeetingReportFastChapterSchema>;
export type MeetingReportFastTask = z.infer<typeof MeetingReportFastTaskSchema>;
export type MeetingReportFastQualityScore = z.infer<
  typeof MeetingReportFastQualityScoreSchema
>;

// ──────────────────────────── JSON Schema (для tool_use) ────────────────────────────

/**
 * JSON Schema аргументов tool'а `submit_meeting_analysis`. Совпадает с
 * `MeetingReportFastSchema`, но в native-JSON-Schema форме — Anthropic /
 * DeepSeek / OpenAI / Ollama умеют только её.
 *
 * Эталон формата — `run-variant-b-single.ts`. Здесь же по unit-test'у
 * валидируем zod-форму через тот же layout.
 */
export const MEETING_REPORT_FAST_INPUT_SCHEMA: LlmTool['input_schema'] = {
  type: 'object',
  additionalProperties: false,
  required: ['chapters', 'tasks', 'summary_markdown', 'quality_score'],
  properties: {
    chapters: {
      type: 'array',
      description:
        'Главы встречи (5-12 шт). Каждая глава = смысловой сегмент, по которому удобно «прыгать» в плеере. Главы идут подряд, не пересекаются.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'startMs', 'endMs'],
        properties: {
          title: {
            type: 'string',
            maxLength: 200,
            description: 'Короткое название главы, без префикса «Глава N:».',
          },
          summary: {
            type: 'string',
            maxLength: 2000,
            description: '1-3 предложения по существу о чём эта глава.',
          },
          startMs: {
            type: 'integer',
            minimum: 0,
            description: 'Начало главы в миллисекундах от старта встречи.',
          },
          endMs: {
            type: 'integer',
            minimum: 0,
            description: 'Конец главы в миллисекундах.',
          },
        },
      },
    },
    tasks: {
      type: 'array',
      description:
        'Явные поручения / action items. Только то, что прозвучало явно (не пожелания, не идеи). Если нет — пустой массив.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'confidence'],
        properties: {
          title: {
            type: 'string',
            description: 'Глагол + объект («Подготовить договор»).',
          },
          assigneeRaw: {
            type: ['string', 'null'],
            description:
              'Имя или роль исполнителя как прозвучало («Иван», «Маркетинг»). null если не названо.',
          },
          dueDateIso: {
            type: ['string', 'null'],
            description:
              'YYYY-MM-DD если прозвучала конкретная дата. null если относительно («на следующей неделе») или не названо.',
          },
          sourceQuote: {
            type: 'string',
            description:
              'Дословная цитата (или близкая склейка) из транскрипта, обосновывающая задачу.',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Уверенность, что это РЕАЛЬНАЯ задача (0..1).',
          },
        },
      },
    },
    summary_markdown: {
      type: 'string',
      description:
        'Итоговая сводка встречи в формате markdown. Структура зависит от типа встречи (см. system prompt).',
    },
    quality_score: {
      type: 'object',
      additionalProperties: false,
      required: ['overallScore', 'categories', 'recommendations', 'strengths'],
      properties: {
        overallScore: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Общий балл качества (0..100, взвешенное среднее категорий).',
        },
        categories: {
          type: 'object',
          additionalProperties: false,
          required: [
            'preparation',
            'structure',
            'clarity',
            'outcomes',
            'engagement',
          ],
          properties: {
            preparation: { type: 'integer', minimum: 0, maximum: 100 },
            structure: { type: 'integer', minimum: 0, maximum: 100 },
            clarity: { type: 'integer', minimum: 0, maximum: 100 },
            outcomes: { type: 'integer', minimum: 0, maximum: 100 },
            engagement: { type: 'integer', minimum: 0, maximum: 100 },
          },
        },
        recommendations: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'severity', 'category'],
            properties: {
              text: { type: 'string' },
              severity: {
                type: 'string',
                enum: ['info', 'warning', 'critical'],
              },
              category: {
                type: 'string',
                enum: [
                  'preparation',
                  'structure',
                  'clarity',
                  'outcomes',
                  'engagement',
                ],
              },
            },
          },
        },
        strengths: {
          type: 'array',
          maxItems: 8,
          items: { type: 'string' },
        },
      },
    },
  },
};

export const MEETING_REPORT_FAST_TOOL: LlmTool = {
  name: MEETING_REPORT_FAST_TOOL_NAME,
  description:
    'Отдать полный анализ встречи: главы, явные задачи, итоговая сводка по типу встречи, оценка качества.',
  input_schema: MEETING_REPORT_FAST_INPUT_SCHEMA,
};

// ──────────────────────────── Шаблоны summary_markdown по типу ────────────────────────────

/**
 * Шаблон секции "summary_markdown" для каждого `MeetingType`.
 *
 * 3 первые секции (chapters, tasks, quality_score) — общие.
 * Секция summary_markdown — единственное, что отличается по типу:
 * структура markdown-а ориентирована на формат встречи.
 *
 * Все 12 значений `MeetingType` из schema.prisma поддержаны явно
 * (защита от пропуска при добавлении нового типа — см. assertExhaustive).
 */
const SUMMARY_TEMPLATE_BY_TYPE: Record<MeetingType, string> = {
  sales: `Markdown-сводка продажной встречи. Структура:
- Стадия сделки или разговора (lead → discovery → demo → negotiation → close).
- Боли клиента (что озвучил).
- Возражения (открытые и снятые).
- Договорённости и зоны согласия.
- Следующие шаги.`,
  custdev: `Markdown-сводка custdev-интервью. Структура:
- Гипотеза, которую проверяли.
- Боли и потребности респондента (что узнали нового).
- Подтверждённые / опровергнутые предположения.
- Открытые вопросы для следующих интервью.
- Следующие шаги.`,
  interview: `Markdown-сводка собеседования. Структура:
- Релевантный опыт кандидата (короткие пункты).
- Сильные стороны.
- Зоны риска и гэпы.
- Соответствие роли (low/medium/high и почему).
- Решение или следующий этап (next round / offer / reject).`,
  standup: `Markdown-сводка планёрки (standup). Структура:
- Что сделано за период.
- Что планируется на ближайший день/неделю.
- Блокеры участников.
- Вопросы, требующие решения руководителя.
- Следующая контрольная точка.`,
  team: `Markdown-сводка командной встречи. Структура:
- Обсуждённые темы (короткими тезисами).
- Принятые решения с ответственными.
- Открытые вопросы.
- Договорённости и следующие шаги.`,
  plan_fact: `Markdown-сводка встречи план-факт. Структура:
- Что планировалось на период.
- Что фактически сделано.
- Расхождения план/факт и их причины.
- Меры по корректировке плана.
- Следующая точка проверки.`,
  project: `Markdown-сводка проектной встречи. Структура:
- Текущий статус проекта (что готово, что в работе).
- Риски и проблемы.
- Зависимости и блокеры.
- Решения и договорённости с ответственными.
- Следующие шаги и сроки.`,
  partner: `Markdown-сводка встречи с партнёром. Структура:
- Текущий статус партнёрства / обсуждаемой инициативы.
- Договорённости и совместные обязательства.
- Открытые коммерческие или юридические вопросы.
- Точки синхронизации.
- Следующие шаги.`,
  customer_success: `Markdown-сводка встречи с действующим клиентом (customer success). Структура:
- Удовлетворённость использованием (что работает / что нет).
- Запросы на функционал и улучшения.
- Риски оттока (churn risk) и факторы лояльности.
- Возможности upsell/cross-sell.
- Следующие шаги (помощь, материалы, обучение).`,
  review: `Markdown-сводка обзорной встречи (review). Структура:
- Что обсуждали / какой материал ревьюили.
- Ключевые наблюдения и оценки.
- Сильные стороны и зоны роста.
- Договорённости и action items.
- Следующие шаги.`,
  retrospective: `Markdown-сводка ретроспективы. Структура:
- Что работало хорошо (практики и решения, которые стоит сохранить).
- Что не работало (повторяющиеся проблемы).
- Эксперименты, которые команда решила попробовать.
- Action items с ответственными.
- Общее настроение команды.`,
  task_discussion: `Markdown-сводка обсуждения конкретной задачи (task discussion). Структура:
- Контекст задачи (что обсуждали и почему).
- Принятые технические или продуктовые решения.
- Изменения в требованиях / scope.
- Открытые вопросы.
- Следующие шаги с ответственными.`,
};

/**
 * Compile-time exhaustiveness check: если в `MeetingType` добавили новое
 * значение — здесь будет ошибка тайпчека (никаких лежачих типов).
 */
function assertExhaustiveSummaryTemplates(): void {
  const _check: Record<MeetingType, string> = SUMMARY_TEMPLATE_BY_TYPE;
  void _check;
}
assertExhaustiveSummaryTemplates();

// ──────────────────────────── System prompt builder ────────────────────────────

/**
 * Возвращает текст шаблона summary_markdown для указанного типа.
 * Экспортируется для тестов и для прокидывания в БД-registry на Фазе 4.
 */
export function getSummaryTemplateForType(type: MeetingType): string {
  return SUMMARY_TEMPLATE_BY_TYPE[type];
}

interface BuildSystemPromptArgs {
  meetingType: MeetingType;
}

/**
 * Строит system-промпт для `meeting-report-fast`. Идентичен по структуре
 * проверенному в эксперименте `run-variant-b-single.ts`, но секция
 * summary_markdown инжектится из шаблона по `meetingType`.
 */
export function buildMeetingReportFastSystemPrompt(
  args: BuildSystemPromptArgs,
): string {
  const summaryTemplate = getSummaryTemplateForType(args.meetingType);
  return `Ты — аналитик деловых видеовстреч. Получаешь транскрипт встречи типа «${args.meetingType}» и возвращаешь полный комплексный анализ через инструмент ${MEETING_REPORT_FAST_TOOL_NAME}.

Анализ состоит из 4 секций. Все 4 — обязательны.

═══ Секция 1: chapters (главы встречи) ═══

Разбей встречу на 5-12 смысловых глав. Глава = группа подряд идущих обсуждений по одной теме.
- title: короткое название (≤200 символов), без «Глава N:».
- summary: 1-3 предложения по существу.
- startMs / endMs: таймкоды в миллисекундах. Считай от первой реплики транскрипта = 0.
  Используй временные метки [mm:ss] из транскрипта.
- Главы идут подряд, не пересекаются.

═══ Секция 2: tasks (явные поручения) ═══

Найди EXPLICIT задачи: кто что должен сделать.
- Не выдумывай. Если поручений нет — пустой массив.
- НЕ выдавай вежливые формулировки («может быть стоит…», «было бы здорово…») — это не задачи.
- title: глагол + объект («Подготовить договор»).
- assigneeRaw: имя/роль как прозвучало. null если не названо.
- dueDateIso: YYYY-MM-DD только если конкретная дата. null для «на следующей неделе».
- sourceQuote: дословная цитата из транскрипта.
- confidence: 0..1 — насколько уверен, что это РЕАЛЬНАЯ задача, а не пожелание.

═══ Секция 3: summary_markdown (итоговая сводка) ═══

${summaryTemplate}

По существу, без воды. Только то, что есть в транскрипте — не дополняй контекстом.

═══ Секция 4: quality_score (оценка качества встречи) ═══

Оцени встречу по 5 категориям (0..100):
- preparation — была ли озвучена повестка, цель встречи в первые 5 минут?
- structure — есть ли структура (введение → обсуждение → итоги)?
- clarity — конкретны ли формулировки решений?
- outcomes — есть ли конкретные решения с ответственными и сроками?
- engagement — активны ли все участники?

overallScore — взвешенное среднее.

recommendations: 3-7 действий «как сделать встречу лучше». severity:
- info — наблюдение, можно лучше, но не критично.
- warning — заметная проблема: исправление существенно улучшит будущие встречи.
- critical — серьёзный провал (overall ≤ 40 или явный антипаттерн).

strengths: 2-4 пункта что было хорошо.

═══ Тон и язык ═══

- Все строки на русском.
- Рекомендации — ДЕЙСТВИЯ («Озвучить повестку в первые 5 минут»), а НЕ диагнозы.
- Не выдумывай данных, которых нет в транскрипте.

ВАЖНО: верни результат строго через вызов инструмента ${MEETING_REPORT_FAST_TOOL_NAME}. Не пиши ничего вне tool_use.`;
}

// ──────────────────────────── User prompt builder ────────────────────────────

export interface MeetingReportFastUserContext {
  /** Например, `team — Sync 2026-05-21`. */
  meetingTitle: string;
  /** Полный транскрипт встречи (склейка `[mm:ss-mm:ss] Speaker: text`). */
  transcript: string;
}

/**
 * User-сообщение LLM. Передаёт заголовок встречи + полный транскрипт.
 *
 * ВАЖНО: воркер ДОЛЖЕН обернуть результат в `wrapUserData(...)` из
 * `common.ts` (защита от prompt-injection — F1.2). Здесь возвращаем
 * текст без маркеров — добавление маркеров — ответственность воркера.
 */
export function buildMeetingReportFastUserPrompt(
  ctx: MeetingReportFastUserContext,
): string {
  return [
    `Заголовок встречи: ${ctx.meetingTitle}`,
    '',
    'Транскрипт:',
    ctx.transcript,
    '',
    `Верни полный анализ через инструмент ${MEETING_REPORT_FAST_TOOL_NAME}.`,
  ].join('\n');
}

/**
 * Полный вызов (system + user) — удобный wrapper для тестов и для воркера.
 */
export function buildMeetingReportFastPrompt(args: {
  meetingType: MeetingType;
  meetingTitle: string;
  transcript: string;
}): { system: string; user: string } {
  return {
    system: buildMeetingReportFastSystemPrompt({ meetingType: args.meetingType }),
    user: buildMeetingReportFastUserPrompt({
      meetingTitle: args.meetingTitle,
      transcript: args.transcript,
    }),
  };
}
