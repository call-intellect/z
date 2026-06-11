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

import { meetingTypeLabelRu, withAsrNote, withConfidenceCalibration } from './common';

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
      .max(7),
    strengths: z.array(z.string().min(1)).max(4),
  })
  .strict();

export const MeetingReportFastSchema = z
  .object({
    chapters: z.array(MeetingReportFastChapterSchema),
    tasks: z.array(MeetingReportFastTaskSchema),
    summary_markdown: z.string(),
    quality_score: MeetingReportFastQualityScoreSchema,
    /**
     * Заметка о полноте/надёжности входного транскрипта (1-2 фразы) или null.
     * ADDITIVE / optional — обратная совместимость со старыми результатами.
     */
    data_quality: z.string().nullable().optional(),
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
  required: [
    'chapters',
    'tasks',
    'summary_markdown',
    'quality_score',
    'data_quality',
  ],
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
          maxItems: 7,
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
          maxItems: 4,
          items: { type: 'string' },
        },
      },
    },
    data_quality: {
      type: ['string', 'null'],
      description:
        'Заметка о полноте/надёжности транскрипта (1-2 фразы): обрывы записи, неразборчивые места, неопределённые/несопоставленные спикеры, ненадёжные числа и имена. null, если транскрипт полный и претензий нет.',
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
- Следующие шаги.
Различай НАШУ сторону и сторону клиента; реплику без атрибуции — «сторона не определена», не угадывай.`,
  custdev: `Markdown-сводка custdev-интервью. Структура:
- Гипотеза, которую проверяли.
- Боли и потребности респондента (что узнали нового).
- Подтверждённые / опровергнутые предположения.
- Открытые вопросы для следующих интервью.
- Следующие шаги.
Различай НАШУ сторону и сторону клиента; реплику без атрибуции — «сторона не определена», не угадывай.`,
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
- Следующая контрольная точка.
Разводи отдельными разделами «### Идеи и предложения (не ставшие задачами)» и «### Задачи»: идея/пожелание без обязательства идёт в идеи, а не в задачи. Если ответственный или срок не назван — пиши «не уточнено».`,
  team: `Markdown-сводка командной встречи. Структура:
- Обсуждённые темы (короткими тезисами).
- Принятые решения с ответственными.
- Открытые вопросы.
- Договорённости и следующие шаги.
Разводи отдельными разделами «### Идеи и предложения (не ставшие задачами)» и «### Задачи»: идея/пожелание без обязательства идёт в идеи, а не в задачи. Если ответственный или срок не назван — пиши «не уточнено».`,
  plan_fact: `Markdown-сводка встречи план-факт. Структура:
- Что планировалось на период.
- Что фактически сделано.
- Расхождения план/факт и их причины.
- Меры по корректировке плана.
- Следующая точка проверки.
Разводи отдельными разделами «### Идеи и предложения (не ставшие задачами)» и «### Задачи»: идея/пожелание без обязательства идёт в идеи, а не в задачи. Если ответственный или срок не назван — пиши «не уточнено».`,
  project: `Markdown-сводка проектной встречи. Структура:
- Текущий статус проекта (что готово, что в работе).
- Риски и проблемы.
- Зависимости и блокеры.
- Решения и договорённости с ответственными.
- Следующие шаги и сроки.
Разводи отдельными разделами «### Идеи и предложения (не ставшие задачами)» и «### Задачи»: идея/пожелание без обязательства идёт в идеи, а не в задачи. Если ответственный или срок не назван — пиши «не уточнено».`,
  partner: `Markdown-сводка встречи с партнёром. Структура:
- Текущий статус партнёрства / обсуждаемой инициативы.
- Договорённости и совместные обязательства.
- Открытые коммерческие или юридические вопросы.
- Точки синхронизации.
- Следующие шаги.
Различай НАШУ сторону и сторону партнёра; реплику без атрибуции — «сторона не определена», не угадывай.`,
  customer_success: `Markdown-сводка встречи с действующим клиентом (customer success). Структура:
- Удовлетворённость использованием (что работает / что нет).
- Запросы на функционал и улучшения.
- Риски оттока (churn risk) и факторы лояльности.
- Возможности upsell/cross-sell.
- Следующие шаги (помощь, материалы, обучение).
Различай НАШУ сторону и сторону клиента; реплику без атрибуции — «сторона не определена», не угадывай.`,
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
  sprint_review: `Markdown-сводка итогов спринта (sprint review). Структура:
- Цель спринта (если её озвучили на встрече).
- Что было запланировано (главные ставки, на которые шли).
- Что выполнено (с краткими комментариями, что именно сделали).
- Что не выполнено и причины (нагрузка, блокеры, изменение приоритетов).
- Решения о переносах в следующий спринт.
- Уроки и идеи на будущее (короткие пункты).
- План следующего спринта (если уже обсудили) или открытые кандидаты задач.`,
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
  const label = meetingTypeLabelRu(args.meetingType);
  const base = `Ты — аналитик деловых встреч в Коре, памяти компании. Получаешь транскрипт встречи (тип: ${label}) и возвращаешь полный разбор через инструмент ${MEETING_REPORT_FAST_TOOL_NAME}.

Зачем это и для кого. Этот разбор — то, что команда увидит ВМЕСТО часовой записи. Второго разбора не будет: ты единственный, кто превращает встречу в понятный итог. Поэтому осторожность важнее полноты — лучше честно отметить нехватку данных, чем додумать. Куда идёт результат:
- задачи станут карточками в трекере с ответственным — ложная задача даёт людям работу впустую;
- главы станут кнопками навигации в видеоплеере;
- резюме прочитает тот, кого на встрече не было;
- оценка качества помогает команде проводить встречи лучше.

═══ Различай сущности (не путай их) ═══

Перед тем как отнести реплику, спроси себя: есть ли обязательство? зафиксирован ли выбор? согласны ли обе стороны?

- ЗАДАЧА (поручение) — конкретное действие, которое кто-то будет делать. Признак: глагол действия + (обычно) исполнитель + подразумевается выполнение. → в tasks. Пример: «Аня, подготовь договор к среде» · «Я возьму на себя тесты».
- ИДЕЯ / ПРЕДЛОЖЕНИЕ — мысль «можно / стоило бы», без обязательства и без владельца. Признак: сослагательность, «на будущее», «может, стоит». → в summary, «Идеи и предложения». НЕ в tasks. Пример: «Хорошо бы потом сделать экспорт в таблицу» · «Может, нам нанять дизайнера».
- РЕШЕНИЕ — зафиксированный выбор, часто из вариантов («решили / договорились, что»). Решение = ЧТО выбрали; задача = КТО что делает (одно решение может породить задачи). → в summary, «Принятые решения». Пример: «Решили запускать на следующей неделе, а не сегодня».
- ДОГОВОРЁННОСТЬ — взаимное согласие двух+ сторон о порядке или условиях. Признак: совместность, обе стороны согласны. → в summary, «Договорённости». Пример: «Договорились созваниваться по понедельникам в 10:00».
- ОТКРЫТЫЙ ВОПРОС — подняли, но не решили; требует решения позже. Признак: нет ответа, «надо подумать», «не определились». → в summary, «Открытые вопросы». Пример: «Не определились, какой бюджет закладывать — вернёмся к этому».
- РИСК / ПРОБЛЕМА — то, что мешает или может помешать: угроза, препятствие, узкое место. Признак: называется опасность или помеха («боюсь, не успеем», «у нас проблема с…», «есть риск, что…»). → в summary, «Риски и проблемы» (или «Открытые вопросы», если такого раздела у типа нет). Риск часто ПОРОЖДАЕТ задачу (устранить) или открытый вопрос (как решать), но сам по себе — отдельная сущность, не действие и не решение. Пример: «Боюсь, не успеем к сроку — подрядчик задерживает» · «Нет доступа к серверу».

Если в одной реплике несколько сущностей — раздели их. Если статус неясен (прозвучало, но без обязательства и без фиксации) — это НЕ задача: в сомнении относи к идее или открытому вопросу. Ложная задача дороже пропущенной идеи.

Анализ состоит из 5 секций. Все 5 — обязательны.

═══ Секция 1: chapters (главы встречи) ═══

Разбей встречу на 5-12 смысловых глав. Глава = группа подряд идущих обсуждений по одной теме.
- title: короткое название (≤200 символов), без «Глава N:».
- summary: 1-3 предложения по существу.
- Таймкоды: в транскрипте каждая реплика помечена как [мм:сс-мм:сс], отсчёт от старта встречи = 0. startMs = начало ПЕРВОЙ реплики главы (в миллисекундах), endMs = конец ПОСЛЕДНЕЙ реплики главы.
- Главы идут подряд, не пересекаются.

═══ Секция 2: tasks (явные поручения) ═══

Найди только явно прозвучавшие задачи: кто что должен сделать.
- Если поручений нет — пустой массив. Не выдумывай.
- НЕ задача: вежливые обороты («может, стоит…», «было бы здорово…»), идеи на будущее, общие намерения без обязательства.
- title: глагол + объект («Подготовить договор»).
- assigneeRaw: имя/роль как прозвучало. null, если не названо.
- dueDateIso: YYYY-MM-DD только если прозвучала конкретная дата. null для относительных («на следующей неделе») — их разрешает дата встречи в конце сообщения.
- sourceQuote: дословная цитата из транскрипта, обосновывающая задачу.
- confidence: по шкале в конце сообщения.

═══ Секция 3: summary_markdown (итоговая сводка) ═══

${summaryTemplate}

По существу, без воды. Только то, что есть в транскрипте — не дополняй внешними знаниями.

═══ Секция 4: quality_score (оценка качества встречи) ═══

Оцени встречу по 5 категориям (0..100):
- preparation — была ли в первые минуты озвучена цель/повестка?
- structure — есть ли структура (введение → обсуждение → итоги)?
- clarity — конкретны ли формулировки решений?
- outcomes — есть ли конкретные решения с ответственными и сроками?
- engagement — активны ли все участники?

overallScore — взвешенное среднее.

recommendations (3-7): ДЕЙСТВИЯ «как сделать встречу лучше» («Озвучить повестку в первые 5 минут»), а НЕ диагнозы. severity:
- info — наблюдение, можно лучше, но не критично.
- warning — заметная проблема: исправление существенно улучшит будущие встречи.
- critical — серьёзный провал (overall ≤ 40 или явный антипаттерн).

strengths (2-4): что было хорошо. Не добивай список ради числа.

═══ Секция 5: data_quality (надёжность входных данных) ═══

1-2 фразы о полноте и надёжности транскрипта: обрывы записи, неразборчивые места, неопределённые или несопоставленные со списком участников спикеры, ненадёжно распознанные числа/имена/термины. Это сигнал для читателя отчёта, насколько можно доверять выводам. Верни null, если транскрипт полный, связный и претензий к качеству нет.

═══ Лестница по качеству входа ═══

- Полный транскрипт → обычный разбор.
- Частичный / шумный → разбор + честные оговорки в data_quality.
- Мусор / обрыв записи / слишком коротко → пустые массивы, summary честно о нехватке данных, причина в data_quality. Не достраивай.

═══ Имена участников ═══

Имена участников бери ТОЛЬКО из переданного в конце сообщения списка участников. Если говорящий не сопоставляется со списком — пиши роль/«участник», НЕ выдумывай имя и НЕ транскрибируй как звучит.

═══ Язык ═══

- Все строки на русском.
- В summary_markdown — ни одного английского слова или технического кода, даже если они звучали в транскрипте: переводи на русский («дедлайн» → «срок», «таска» → «задача», «Excel» → «таблица»).
- Не выдумывай данных, которых нет в транскрипте.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «[00:10-00:14] Сергей: Запускаем доработку оплаты к пятнице. [00:18-00:20] Аня: Я возьму тесты. [00:25-00:30] Сергей: Можно потом сделать ещё экспорт в Excel, но это идея на будущее.». Спикеры покрывают примерно 60% реплик.
Вывод (фрагмент): {"tasks": [{"title": "Запустить доработку оплаты", "assigneeRaw": "Сергей", "dueDateIso": null, "sourceQuote": "Запускаем доработку оплаты к пятнице", "confidence": 0.85}, {"title": "Провести тестирование", "assigneeRaw": "Аня", "dueDateIso": null, "sourceQuote": "Я возьму тесты", "confidence": 0.6}], "summary_markdown": "Договорились запустить доработку оплаты к пятнице; тестирование за Аней.", "data_quality": "Спикеры распознаны примерно для 60% реплик; часть имён не атрибутирована."}. Пояснение: «решили ≠ обсудили» — в summary только принятое; «идея ≠ задача» — экспорт в таблицу озвучен как идея на будущее, поэтому в tasks НЕ попадает; «оплата к пятнице» — есть владелец и срок → confidence 0.85; «тесты» — владелец есть, срока нет → 0.6 (по шкале); англицизм «Excel» в summary не тащим.

Что НЕ делать (edge case — бедный/обрезанный транскрипт и чужое имя):
Транскрипт-фрагмент: «[00:03-00:05] Участник: …поэтому давайте Олег займётся отчётом. [запись обрывается]». В переданном списке участников Олега НЕТ.
Вывод (фрагмент): {"tasks": [], "summary_markdown": "Запись слишком короткая для анализа.", "data_quality": "Транскрипт обрезан в начале, запись оборвана; спикеры не сопоставлены со списком участников, имена ненадёжны."}. Пояснение: честная пустота вместо выдумки — задачу не приписываем человеку, которого нет в переданном списке участников; при обрыве записи tasks = [], summary честно про нехватку данных, а оговорки уходят в data_quality.

Перед вызовом инструмента проверь себя:
1) каждая задача — реальное обязательство с цитатой, а не пожелание или идея;
2) ни одного имени вне списка участников;
3) в summary_markdown нет английских слов и кодов;
4) если входных данных мало — массивы пустые, причина в data_quality;
5) заполнены все 5 секций.

ВАЖНО: верни результат строго через вызов инструмента ${MEETING_REPORT_FAST_TOOL_NAME}. Не пиши ничего вне tool_use.`;
  return withAsrNote(withConfidenceCalibration(base));
}

// ──────────────────────────── User prompt builder ────────────────────────────

export interface MeetingReportFastUserContext {
  /** Например, `team — Sync 2026-05-21`. */
  meetingTitle: string;
  /** Полный транскрипт встречи (склейка `[mm:ss-mm:ss] Speaker: text`). */
  transcript: string;
  /**
   * C6 (анти-галлюцинация имён) — отображаемые имена участников встречи.
   * Подаются в КОНЦЕ user-сообщения (переменные данные, cache-friendly).
   * Пустой массив → «список участников недоступен».
   */
  participants: readonly string[];
  /**
   * C2 (meetingDateIso) — дата встречи в формате ISO (YYYY-MM-DD) для
   * разрешения относительных сроков. null если неизвестна.
   */
  meetingDateIso: string | null;
}

/**
 * User-сообщение LLM. Передаёт заголовок встречи + полный транскрипт, а в
 * самом КОНЦЕ — переменный блок с участниками и датой встречи (cache-friendly:
 * стабильный SYSTEM, переменные данные только в хвосте user).
 *
 * ВАЖНО: воркер ДОЛЖЕН обернуть результат в `wrapUserData(...)` из
 * `common.ts` (защита от prompt-injection — F1.2). Здесь возвращаем
 * текст без маркеров — добавление маркеров — ответственность воркера.
 */
export function buildMeetingReportFastUserPrompt(
  ctx: MeetingReportFastUserContext,
): string {
  const participantsLine =
    ctx.participants.length > 0
      ? ctx.participants.join(', ')
      : 'список участников недоступен';
  return [
    `Заголовок встречи: ${ctx.meetingTitle}`,
    '',
    'Транскрипт:',
    ctx.transcript,
    '',
    `Верни полный анализ через инструмент ${MEETING_REPORT_FAST_TOOL_NAME}.`,
    '',
    '---',
    `Участники встречи (используй ТОЛЬКО эти имена): ${participantsLine}`,
    `Дата встречи (ISO): ${ctx.meetingDateIso ?? 'неизвестна'}`,
  ].join('\n');
}

/**
 * Полный вызов (system + user) — удобный wrapper для тестов и для воркера.
 */
export function buildMeetingReportFastPrompt(args: {
  meetingType: MeetingType;
  meetingTitle: string;
  transcript: string;
  participants: readonly string[];
  meetingDateIso: string | null;
}): { system: string; user: string } {
  return {
    system: buildMeetingReportFastSystemPrompt({ meetingType: args.meetingType }),
    user: buildMeetingReportFastUserPrompt({
      meetingTitle: args.meetingTitle,
      transcript: args.transcript,
      participants: args.participants,
      meetingDateIso: args.meetingDateIso,
    }),
  };
}
