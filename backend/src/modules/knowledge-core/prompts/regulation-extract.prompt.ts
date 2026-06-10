/**
 * SBA α-7 — Specialist 3.1 (Regulations).
 *
 * LLM-промпт `regulation-extract` — из IdeaBlock с `signalType='regulation'`
 * (или `'process_step'`, или `'policy'`) извлекает структурированный черновик
 * под нужную сущность (Process / Regulation / Policy).
 *
 * Возвращаемый JSON Schema strict — см. `REGULATION_EXTRACT_SCHEMA`. На входе
 * — текст блока (criticalQuestion + trustedAnswer + теги + цитаты).
 *
 * Цель: 1 блок → 1 черновик карточки, в краткой и последовательной форме.
 */

import {
  withAsrNote,
  withConfidenceCalibration,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

export const REGULATION_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withEdgeCasePolicy(
  withConfidenceCalibration(
    [
    'Ты — knowledge-инженер. Тебе дают один IdeaBlock из встречи / документа, в котором упомянут регламент / процесс / политика компании.',
    'Твоя задача — извлечь структурированный черновик нужной сущности на русском языке. Отвечай строго в формате JSON по предоставленной схеме.',
    'Не выдумывай факты вне блока. Если в блоке нет нужного поля — оставь его null.',
    '',
    'Различай:',
    '- regulation — формальное правило / норматив компании (например, «все договоры с подрядчиком должны проходить юр.проверку»).',
    '- process — последовательность шагов (например, «онбординг клиента» с этапами).',
    '- policy — политика с уровнем строгости (рекомендация / обязательная / критическая) — например, политика отпусков.',
    '- standard — внешний стандарт (например, ISO 9001), на который ссылается регламент.',
    '',
    'Если блок описывает шаг процесса, верни kind="process" и заполни поле processStepHint.',
    '',
    'Чего НЕ извлекать как орг-документ:',
    '- чужие практики (как делают у конкурентов / в Google / «в больших компаниях») — это не регламент компании;',
    '- гипотетику («если бы сделать как…», «можно было бы») — это не действующая норма;',
    '- голое упоминание документа без его содержания: если документ лишь упомянут (есть, но что в нём — не раскрыто), это existence-сигнал с НИЗКИМ confidence — тело не извлекай.',
    'Калибровка confidence: есть шаги / роли / сроки → 0.9; только голое упоминание документа → 0.5.',
    ].join('\n'),
  ),
  ),
);

export const REGULATION_EXTRACT_USER_TEMPLATE = (args: {
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
}): string => {
  const quotes = args.evidenceQuotes.length
    ? args.evidenceQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (цитат нет)';
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  return [
    `Блок «${args.blockName}» (signalType=${args.signalType}).`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    `Цитаты-источники:`,
    quotes,
    '',
    'Верни JSON-объект по схеме `regulation_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `regulation-extract`. Поддерживается DeepSeek V4 и
 * OpenAI Responses API; Ollama (qwen3) фоллбэк падает с
 * `LlmFormatNotSupportedError` — роутер переходит к secondary/primary.
 */
export const REGULATION_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'name', 'statement', 'confidence'],
  properties: {
    kind: {
      type: 'string',
      enum: ['regulation', 'process', 'policy', 'standard'],
    },
    name: { type: 'string', minLength: 3, maxLength: 300 },
    statement: { type: 'string', minLength: 5, maxLength: 4_000 },
    scope: {
      type: ['string', 'null'],
      description:
        "'org' | 'department:<id>' | 'role:<id>' | 'project:<id>' — кому регламент адресован",
    },
    ownerHint: {
      type: ['string', 'null'],
      maxLength: 300,
      description: 'Текстовая подсказка про ответственного (имя/роль).',
    },
    severity: {
      type: ['string', 'null'],
      enum: [null, 'advisory', 'mandatory', 'blocking'],
      description: 'Только для kind=policy.',
    },
    category: {
      type: ['string', 'null'],
      enum: [null, 'regulation', 'standard'],
      description: 'Только для kind=regulation/standard.',
    },
    processStepHint: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        processName: { type: 'string', minLength: 2, maxLength: 300 },
        stepName: { type: 'string', minLength: 2, maxLength: 300 },
        stepOrder: { type: ['integer', 'null'], minimum: 1, maximum: 999 },
        stepDescription: { type: ['string', 'null'], maxLength: 2_000 },
      },
      required: ['processName', 'stepName'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const REGULATION_EXTRACT_SCHEMA_NAME = 'regulation_extract_v1';
