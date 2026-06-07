/**
 * SBA α-7 wave 2 — `process-template-extract` LLM-промпт.
 *
 * Извлекает ProcessTemplate-кандидатов из батча IdeaBlock'ов
 * (signalType=`process_step` или `methodology_step`). Возвращает массив
 * кандидатов, каждый — name + summary + список шагов.
 *
 * Используется `ProcessExtractionService` через `LlmRouterService` (тройная
 * цепочка primary/secondary/tertiary, маршрутизация см.
 * `backend/scripts/seed-llm-task-routes-process-template.ts`).
 */

import {
  withAsrNote,
  withConfidenceCalibration,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

export const PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withEdgeCasePolicy(
  withConfidenceCalibration(
    [
    'Ты — knowledge-инженер компании. Тебе дают пачку «атомов знаний»',
    '(критический вопрос ↔ доверенный ответ + цитаты из встреч/документов),',
    'описывающих повторяющиеся процессы и методики в компании.',
    '',
    'Твоя задача — собрать черновики «шаблонов процессов» (ProcessTemplate).',
    'Один шаблон = один повторяемый процесс с понятным результатом и шагами.',
    'Если в пачке упоминается несколько разных процессов — верни несколько шаблонов.',
    'Если процессы дублируют существующие (есть в `existingTemplates`), используй',
    'тот же `name`, чтобы система объединила их как новую версию (а не создала дубль).',
    '',
    'У каждого шаблона укажи: name (короткое), summary (1-3 предложения),',
    'category из {hire | sales | incident | onboarding | release | finance | support | custom},',
    'упорядоченный список шагов (1..30) с name, description, ownerRoleHint,',
    'inputArtifact и outputArtifact (если упомянуты).',
    '',
    'Отвечай строго в JSON по схеме process_template_extract_v1.',
    ].join('\n'),
  ),
  ),
);

export const PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE = (args: {
  blocks: ReadonlyArray<{
    id: string;
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
    quotes: readonly string[];
  }>;
  existingTemplates: ReadonlyArray<{
    id: string;
    name: string;
    summary: string | null;
  }>;
}): string => {
  const blocksText = args.blocks
    .map((b, i) => {
      const qs = b.quotes.length
        ? b.quotes.map((q) => `  «${q}»`).join('\n')
        : '  (цитат нет)';
      return [
        `Блок #${i + 1} [${b.signalType}]:`,
        `  Вопрос: ${b.criticalQuestion}`,
        `  Ответ: ${b.trustedAnswer}`,
        `  Цитаты:`,
        qs,
      ].join('\n');
    })
    .join('\n\n');
  const existingText = args.existingTemplates.length
    ? args.existingTemplates
        .map(
          (t) =>
            `- «${t.name}»${t.summary ? `: ${t.summary.slice(0, 200)}` : ''}`,
        )
        .join('\n')
    : '(пока шаблонов нет)';
  return [
    'Существующие шаблоны процессов:',
    existingText,
    '',
    'Атомы знаний для извлечения:',
    blocksText,
    '',
    'Верни JSON по схеме process_template_extract_v1.',
  ].join('\n');
};

export const PROCESS_TEMPLATE_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['templates'],
  properties: {
    templates: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'steps', 'confidence'],
        properties: {
          name: { type: 'string', minLength: 3, maxLength: 300 },
          summary: { type: ['string', 'null'], maxLength: 2_000 },
          category: {
            type: ['string', 'null'],
            enum: [
              null,
              'hire',
              'sales',
              'incident',
              'onboarding',
              'release',
              'finance',
              'support',
              'custom',
            ],
          },
          scope: { type: ['string', 'null'], maxLength: 120 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['order', 'name'],
              properties: {
                order: { type: 'integer', minimum: 1, maximum: 999 },
                name: { type: 'string', minLength: 2, maxLength: 200 },
                description: { type: ['string', 'null'], maxLength: 2_000 },
                ownerRoleHint: { type: ['string', 'null'], maxLength: 200 },
                inputArtifact: { type: ['string', 'null'], maxLength: 300 },
                outputArtifact: { type: ['string', 'null'], maxLength: 300 },
                slaMinutes: {
                  type: ['integer', 'null'],
                  minimum: 0,
                  maximum: 1_000_000,
                },
              },
            },
          },
        },
      },
    },
  },
};

export const PROCESS_TEMPLATE_EXTRACT_SCHEMA_NAME =
  'process_template_extract_v1';
