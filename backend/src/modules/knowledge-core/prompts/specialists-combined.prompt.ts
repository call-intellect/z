/**
 * specialists-combined.prompt — ТЗ 2026-05-25 llm-architecture-changes §3
 * (Variant Б+).
 *
 * Источник: `plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md`
 * §3.4 + референс-реализация `backend/scripts/eval/run-specialists-b-plus.ts`
 * (строки 29-50 содержат развёрнутую JSON-схему tool'а; строки 52-72 —
 * system-промпт; строка 74-76 — формат сериализации блока).
 *
 * Один LLM-вызов на ВСЕ canonical-блоки одной встречи возвращает ОДНОВРЕМЕННО
 * восемь массивов сущностей через tool `submit_all_8_entities`:
 *   1. decisions          (signalType=decision|rationale|decision_basis)
 *   2. ideas              (signalType=idea|feature_request|suggestion|client_request)
 *   3. insights           (signalType=pain|risk|blocker|inefficiency|churn_risk|objection|team_friction|process_friction|resource_gap)
 *   4. experiments        (signalType=hypothesis|result|lesson)
 *   5. regulations        (signalType=regulation|process_step|methodology_step)
 *   6. knowledge_categories (для employee-Person — эмерджентные категории знаний)
 *   7. skill_traits       (для employee-Person — гипотезные черты подхода к решениям)
 *   8. helpfulness_traits (signalType=help_provided|proactive_hint|mentoring|emotional_support|constructive_feedback)
 *
 * Эксперимент (см. `backend/test/eval/specialists-experiment/`):
 *   Б+ победил 8 раздельных специалистов (Variant Г) 18:13 по качеству судьи
 *   и **в 3.7× дешевле** при равном числе сущностей (41 шт).
 *
 * Code-fallback. На MVP (flag-rollout `SPECIALISTS_COMBINED_ENABLED`) промпт
 * статичный; админ-editable registry — следующая волна.
 *
 * Все строки на русском.
 */

import { z } from 'zod';

import type { LlmTool } from '../../ai/services/llm.types';
import {
  EXTRACTION_STATUS_RU,
  withConfidenceCalibration,
} from '../../ai/services/prompts/common';

// ──────────────────────────── Метаданные ────────────────────────────

/** taskType для LlmRouter (см. llm-router.service.ts LlmTaskType). */
export const SPECIALISTS_COMBINED_TASK_TYPE =
  'knowledge-specialists-combined' as const;

/** Имя tool'а для structured output (LLM tool-use). */
export const SPECIALISTS_COMBINED_TOOL_NAME = 'submit_all_8_entities';

/**
 * Дефолтный лимит выходных токенов. На 55 блоков (типичная встреча) Variant Б+
 * расходует ~5-10k output (включая thinking). Закладываем запас 32k —
 * как и у meeting-report-fast — модели deepseek-v4-pro / gpt-5.4 (через proxy)
 * с thinking поддерживают.
 */
export const SPECIALISTS_COMBINED_MAX_TOKENS = 32_000;

// ──────────────────────────── Zod-схемы парсинга ────────────────────────────

const Confidence01 = z.number(); // clamp на стороне сервиса (см. SpecialistsCombinedService).
const ConfidenceLevel = z.enum(['low', 'medium', 'high']);

export const DecisionDraftSchema = z
  .object({
    sourceBlockId: z.string().min(1),
    statement: z.string().min(1),
    rationale: z.string().nullable().optional(),
    alternatives: z.array(z.string()).optional(),
    decidedBy: z.array(z.string()).optional(),
    status: z
      .enum(['proposed', 'approved', 'rejected', 'implemented'])
      .optional(),
    confidence: Confidence01,
  })
  .strict();
export type DecisionDraft = z.infer<typeof DecisionDraftSchema>;

export const IdeaDraftSchema = z
  .object({
    sourceBlockId: z.string().min(1),
    kind: z.enum(['internal', 'client_request']),
    statement: z.string().min(1),
    rationale: z.string().nullable().optional(),
    confidence: Confidence01,
  })
  .strict();
export type IdeaDraft = z.infer<typeof IdeaDraftSchema>;

export const InsightDraftSchema = z
  .object({
    sourceBlockId: z.string().min(1),
    kind: z.enum(['problem', 'risk', 'blocker', 'inefficiency']),
    statement: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    causeCategory: z.enum([
      'process_gap',
      'tooling',
      'role_skill',
      'communication',
      'priority',
      'resource_constraint',
      'external',
      'unknown',
    ]),
    mitigationSuggestion: z.string().nullable().optional(),
    confidence: Confidence01,
  })
  .strict();
export type InsightDraft = z.infer<typeof InsightDraftSchema>;

export const ExperimentLessonSchema = z
  .object({
    text: z.string().min(1),
    type: z.enum(['what_worked', 'what_failed', 'next_time']),
  })
  .strict();
export type ExperimentLesson = z.infer<typeof ExperimentLessonSchema>;

export const ExperimentDraftSchema = z
  .object({
    sourceBlockId: z.string().min(1),
    name: z.string().min(1),
    hypothesisText: z.string().min(1),
    currentResult: z.string().nullable().optional(),
    lessons: z.array(ExperimentLessonSchema).optional(),
    status: z.enum(['hypothesis', 'running', 'completed', 'dropped', 'paused']),
    confidence: Confidence01,
  })
  .strict();
export type ExperimentDraft = z.infer<typeof ExperimentDraftSchema>;

export const RegulationDraftSchema = z
  .object({
    sourceBlockId: z.string().min(1),
    kind: z.enum(['regulation', 'process', 'policy', 'standard', 'instruction']),
    name: z.string().min(1),
    statement: z.string().min(1),
    severity: z.enum(['advisory', 'mandatory', 'blocking']).optional(),
    // A12 (Волна 6) — извлечение «Инструкции». Все опциональные/nullable:
    // обратная совместимость со старыми моделями, которые их не вернут.
    extractionStatus: z
      .enum(['существует', 'нужен', 'обсуждается'])
      .nullable()
      .optional(),
    roles: z.array(z.string()).optional(),
    evidenceQuote: z.string().nullable().optional(),
    confidence: Confidence01,
  })
  .strict();
export type RegulationDraft = z.infer<typeof RegulationDraftSchema>;

export const KnowledgeCategoryDraftSchema = z
  .object({
    personName: z.string().min(1),
    category: z.string().min(1),
    confidence: ConfidenceLevel,
    sampleStatements: z.array(z.string()).optional(),
    sourceBlockIds: z.array(z.string()).optional(),
  })
  .strict();
export type KnowledgeCategoryDraft = z.infer<
  typeof KnowledgeCategoryDraftSchema
>;

export const SkillTraitDraftSchema = z
  .object({
    personName: z.string().min(1),
    category: z.string().min(1),
    statement: z.string().min(1),
    confidence: ConfidenceLevel,
    sourceBlockIds: z.array(z.string()).optional(),
  })
  .strict();
export type SkillTraitDraft = z.infer<typeof SkillTraitDraftSchema>;

export const HelpfulnessTraitDraftSchema = z
  .object({
    sourceBlockId: z.string().min(1),
    traitType: z.enum([
      'help_provided',
      'proactive_hint',
      'mentoring',
      'emotional_support',
      'constructive_feedback',
    ]),
    helperUserHint: z.string().min(1),
    recipientUserHint: z.string().nullable().optional(),
    topicHint: z.string().min(1),
    intensity: z.number(),
    evidenceQuote: z.string().min(1),
    confidence: Confidence01,
  })
  .strict();
export type HelpfulnessTraitDraft = z.infer<typeof HelpfulnessTraitDraftSchema>;

/**
 * Полный output одного LLM-вызова. Все 8 массивов обязательны (могут быть
 * пустыми). См. `SUBMIT_ALL_8_ENTITIES_TOOL` ниже — те же 8 ключей в required.
 */
export const SpecialistsCombinedOutputSchema = z
  .object({
    decisions: z.array(DecisionDraftSchema),
    ideas: z.array(IdeaDraftSchema),
    insights: z.array(InsightDraftSchema),
    experiments: z.array(ExperimentDraftSchema),
    regulations: z.array(RegulationDraftSchema),
    knowledge_categories: z.array(KnowledgeCategoryDraftSchema),
    skill_traits: z.array(SkillTraitDraftSchema),
    helpfulness_traits: z.array(HelpfulnessTraitDraftSchema),
  })
  .strict();
export type SpecialistsCombinedOutput = z.infer<
  typeof SpecialistsCombinedOutputSchema
>;

// ──────────────────────────── Tool schema (LlmTool) ────────────────────────────

/**
 * Tool `submit_all_8_entities` — JSON Schema копия (1-в-1) из
 * `backend/scripts/eval/run-specialists-b-plus.ts` строки 29-50. На том же
 * формате эксперимент дал победу 18:13 vs Variant Г и в 3.7× дешевле.
 *
 * Все строки на русском (description, перечисления enum остаются техническими
 * — это контракт парсинга, не текст для пользователя).
 */
export const SUBMIT_ALL_8_ENTITIES_TOOL: LlmTool = {
  name: SPECIALISTS_COMBINED_TOOL_NAME,
  description:
    'Извлечь все восемь типов сущностей знаний из набора блоков одной встречи за один проход.',
  input_schema: {
    type: 'object',
    required: [
      'decisions',
      'ideas',
      'insights',
      'experiments',
      'regulations',
      'knowledge_categories',
      'skill_traits',
      'helpfulness_traits',
    ],
    additionalProperties: false,
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['sourceBlockId', 'statement', 'confidence'],
          properties: {
            sourceBlockId: { type: 'string' },
            statement: { type: 'string' },
            rationale: { type: ['string', 'null'] },
            alternatives: { type: 'array', items: { type: 'string' } },
            decidedBy: { type: 'array', items: { type: 'string' } },
            status: {
              type: 'string',
              enum: ['proposed', 'approved', 'rejected', 'implemented'],
            },
            confidence: { type: 'number' },
          },
        },
      },
      ideas: {
        type: 'array',
        items: {
          type: 'object',
          required: ['sourceBlockId', 'kind', 'statement', 'confidence'],
          properties: {
            sourceBlockId: { type: 'string' },
            kind: { type: 'string', enum: ['internal', 'client_request'] },
            statement: { type: 'string' },
            rationale: { type: ['string', 'null'] },
            confidence: { type: 'number' },
          },
        },
      },
      insights: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'sourceBlockId',
            'kind',
            'statement',
            'severity',
            'causeCategory',
            'confidence',
          ],
          properties: {
            sourceBlockId: { type: 'string' },
            kind: {
              type: 'string',
              enum: ['problem', 'risk', 'blocker', 'inefficiency'],
            },
            statement: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            causeCategory: {
              type: 'string',
              enum: [
                'process_gap',
                'tooling',
                'role_skill',
                'communication',
                'priority',
                'resource_constraint',
                'external',
                'unknown',
              ],
            },
            mitigationSuggestion: { type: ['string', 'null'] },
            confidence: { type: 'number' },
          },
        },
      },
      experiments: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'sourceBlockId',
            'name',
            'hypothesisText',
            'status',
            'confidence',
          ],
          properties: {
            sourceBlockId: { type: 'string' },
            name: { type: 'string' },
            hypothesisText: { type: 'string' },
            currentResult: { type: ['string', 'null'] },
            lessons: {
              type: 'array',
              items: {
                type: 'object',
                required: ['text', 'type'],
                properties: {
                  text: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['what_worked', 'what_failed', 'next_time'],
                  },
                },
              },
            },
            status: {
              type: 'string',
              enum: [
                'hypothesis',
                'running',
                'completed',
                'dropped',
                'paused',
              ],
            },
            confidence: { type: 'number' },
          },
        },
      },
      regulations: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'sourceBlockId',
            'kind',
            'name',
            'statement',
            'confidence',
          ],
          properties: {
            sourceBlockId: { type: 'string' },
            kind: {
              type: 'string',
              enum: [
                'regulation',
                'process',
                'policy',
                'standard',
                'instruction',
              ],
            },
            name: { type: 'string' },
            statement: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['advisory', 'mandatory', 'blocking'],
            },
            extractionStatus: {
              type: ['string', 'null'],
              enum: [null, 'существует', 'нужен', 'обсуждается'],
            },
            roles: { type: 'array', items: { type: 'string' } },
            evidenceQuote: { type: ['string', 'null'] },
            confidence: { type: 'number' },
          },
        },
      },
      knowledge_categories: {
        type: 'array',
        items: {
          type: 'object',
          required: ['personName', 'category', 'confidence'],
          properties: {
            personName: { type: 'string' },
            category: { type: 'string' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            sampleStatements: { type: 'array', items: { type: 'string' } },
            sourceBlockIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      skill_traits: {
        type: 'array',
        items: {
          type: 'object',
          required: ['personName', 'category', 'statement', 'confidence'],
          properties: {
            personName: { type: 'string' },
            category: { type: 'string' },
            statement: { type: 'string' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            sourceBlockIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      helpfulness_traits: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'sourceBlockId',
            'traitType',
            'helperUserHint',
            'topicHint',
            'intensity',
            'confidence',
          ],
          properties: {
            sourceBlockId: { type: 'string' },
            traitType: {
              type: 'string',
              enum: [
                'help_provided',
                'proactive_hint',
                'mentoring',
                'emotional_support',
                'constructive_feedback',
              ],
            },
            helperUserHint: { type: 'string' },
            recipientUserHint: { type: ['string', 'null'] },
            topicHint: { type: 'string' },
            intensity: { type: 'number' },
            evidenceQuote: { type: 'string' },
            confidence: { type: 'number' },
          },
        },
      },
    },
  },
};

// ──────────────────────────── System prompt ────────────────────────────

/**
 * Системный промпт. Копия из `run-specialists-b-plus.ts` строки 52-72 +
 * усиление контрактных требований по tool-use (DeepSeek-V4-Pro с thinking
 * НЕ поддерживает `tool_choice='required'`, поэтому полагаемся на жёсткую
 * формулировку в system и user).
 */
export function buildSpecialistsCombinedSystemPrompt(): string {
  // A9 (2026-06-10): у каждой извлечённой сущности есть `confidence`, которая
  // течёт в вес/порог downstream (canonical draft → проекции). Единая шкала
  // уверенности (`withConfidenceCalibration`) дописывается в КОНЕЦ SYSTEM
  // (cache-friendly). Локальная калибровка confidence для regulations
  // (голое упоминание → 0.5, шаги/роли/сроки → 0.9) остаётся в теле и не
  // конфликтует с общей шкалой — это частный якорь для одного типа.
  const body = [
    'Ты — knowledge-инженер компании Кора. Получаешь все блоки одной встречи. Извлекаешь ВОСЕМЬ типов сущностей за один проход через инструмент submit_all_8_entities.',
    '',
    'Маршрутизация по signalType:',
    '- decision/rationale/decision_basis → decisions[] (объединяй decision + соседний rationale в одну запись)',
    '- idea/feature_request/suggestion/client_request → ideas[] (kind=internal или client_request)',
    '- pain/risk/blocker/churn_risk/objection/inefficiency/team_friction/process_friction/resource_gap → insights[] (с severity, causeCategory, mitigationSuggestion)',
    '- hypothesis/result/lesson → experiments[] (объединяй блоки одного эксперимента в одну запись)',
    '- regulation/process_step/methodology_step → regulations[]',
    '- expertise/experience/competence/reasoning (по человеку) → knowledge_categories[] (per person: 1-3 эмерджентные категории знаний)',
    '- reasoning/methodology_step (≥3 на одного человека) → skill_traits[] (гипотезные черты подхода к решениям)',
    '- help_provided/proactive_hint/mentoring/emotional_support/constructive_feedback → helpfulness_traits[]',
    '- fact и прочие → пропускай',
    '',
    'Жёсткие требования к глубине:',
    '- decisions: ОБЯЗАТЕЛЬНО rationale (ищи в соседних блоках), alternatives (если упоминались).',
    '- insights: ОБЯЗАТЕЛЬНО mitigationSuggestion (или null если действительно нет).',
    '- experiments: lessons[] должны быть многослойные (что сработало / не сработало / next_time).',
    '- knowledge_categories: эмерджентные имена, не enum.',
    '- skill_traits: формулировки ГИПОТЕЗНЫЕ ("Похоже, склонен..."), не приговорные.',
    '',
    'Не выдумывай факты вне блоков. sourceBlockId обязательно для всех сущностей кроме knowledge_categories/skill_traits (там — список sourceBlockIds[]). Все строки на русском.',
    '',
    'regulations — различай kind:',
    '- regulation — формальное правило/норматив компании; process — последовательность шагов СКВОЗЬ несколько ролей (есть передача работы между ролями); policy — политика со строгостью; standard — внешний стандарт (ISO и т.п.);',
    '- instruction — пошаговое «как сделать X» для ОДНОЙ роли (single-role): все шаги выполняет один исполнитель/должность, передачи работы между ролями НЕТ (например, «как менеджеру оформить возврат»). Если работа передаётся между ролями — это process, НЕ instruction. Для instruction заполни roles (затронутая роль).',
    `- extractionStatus (статус существования документа): ${EXTRACTION_STATUS_RU.join(' | ')}. «существует» — документ уже есть и действует; «нужен» — заявлена потребность, документа ещё нет; «обсуждается» — не финализирован. Извлечённый из разговора ≠ подтверждённый: не ставь «существует» только потому, что тему упомянули.`,
    '- roles — список ролей/должностей, которых касается норма; evidenceQuote — дословная опора (≤15-20 слов).',
    'regulations — чего НЕ извлекать как орг-документ:',
    '- чужие практики (как делают у конкурентов / в Google / «в больших компаниях») — это не регламент компании;',
    '- гипотетику («если бы сделать как…», «можно было бы») — это не действующая норма;',
    '- голое упоминание документа без его содержания: если документ лишь упомянут (есть, но что в нём — не раскрыто), это existence-сигнал с НИЗКИМ confidence — тело не извлекай.',
    'Калибровка confidence для regulations: есть шаги / роли / сроки → 0.9; только голое упоминание документа → 0.5.',
    '',
    `ВАЖНО: верни результат строго через вызов инструмента \`${SPECIALISTS_COMBINED_TOOL_NAME}\`. Не пиши ничего вне tool_use. Все 8 массивов обязательны — если в встрече нечего извлекать по типу, верни пустой массив.`,
  ].join('\n');
  return withConfidenceCalibration(body);
}

// ──────────────────────────── User message ────────────────────────────

/** Минимальное представление блока, нужное для сериализации в user-сообщение. */
export interface CombinedInputBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  /** Список имён участников, упомянутых в блоке (для knowledge_categories / skill_traits). */
  personNames: string[];
  /** Главная цитата блока. */
  evidence: {
    quote: string;
    speaker: string;
  };
}

/**
 * Сериализация блока в формат, который дал лучший результат в эксперименте
 * (см. `plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md` §3.5
 * и `run-specialists-b-plus.ts` строка 74-76).
 *
 *   [BLOCK:blk_006] (signalType=decision, persons=Иван Соколов,Анна Мехова)
 *     <name>
 *     В: <criticalQuestion>
 *     О: <trustedAnswer>
 *     Цитата (<speaker>): «<quote>»
 */
export function formatBlockForCombined(block: CombinedInputBlock): string {
  const persons =
    block.personNames.length > 0 ? block.personNames.join(',') : '-';
  return [
    `[BLOCK:${block.id}] (signalType=${block.signalType}, persons=${persons})`,
    `  ${block.name}`,
    `  В: ${block.criticalQuestion}`,
    `  О: ${block.trustedAnswer}`,
    `  Цитата (${block.evidence.speaker}): «${block.evidence.quote}»`,
  ].join('\n');
}

/**
 * Полное user-сообщение для одного LLM-вызова. На вход — `meetingTitle` +
 * массив сериализуемых блоков. На 55 блоков ~22k input-токенов (см. §3.5 ТЗ),
 * с большим запасом по контексту deepseek-v4-pro.
 */
export function buildSpecialistsCombinedUserMessage(args: {
  meetingTitle: string;
  blocks: CombinedInputBlock[];
}): string {
  const header = `Все блоки встречи «${args.meetingTitle}» (${args.blocks.length} шт):`;
  const body = args.blocks.map(formatBlockForCombined).join('\n\n');
  const footer = `Важно: верни через инструмент ${SPECIALISTS_COMBINED_TOOL_NAME}. Все 8 массивов обязательны (пустой массив, если по типу нечего извлекать).`;
  return `${header}\n\n${body}\n\n${footer}`;
}
