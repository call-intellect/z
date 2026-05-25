/**
 * SBA α-7 — Specialist 3.1 (Regulations).
 *
 * LLM-промпт `process-steps-extract` — отдельный проход поверх блоков
 * `signalType='process_step'`, упомянутых рядом с одним и тем же Process'ом.
 * Возвращает упорядоченный массив шагов с `name`, `order`, `description`,
 * `slaMinutes`, `roleHint`.
 *
 * Используется Specialist31Service.processProcessStepBlock — после того как
 * блок ассоциирован с Process'ом (по name-match или LLM-арбитру), мы
 * извлекаем нормализованные шаги для записи в ProcessStep.
 */

import { withEdgeCasePolicy } from '../../ai/services/prompts/common';

export const PROCESS_STEPS_EXTRACT_SYSTEM_PROMPT = withEdgeCasePolicy(
  [
    'Ты — knowledge-инженер. Тебе дают набор блоков (вопрос ↔ ответ + цитаты), описывающих шаги одного процесса в компании.',
    'Извлеки нормализованный упорядоченный список шагов на русском. Один шаг = одно действие с явным результатом.',
    'Пример (один шаг): «обзвонить клиента и зафиксировать ответ» — это один шаг (один',
    'ответственный, один результат).',
    'Пример (три шага): «согласовать сроки, подписать контракт, отправить документ» —',
    'это 3 разных шага (разные ответственные/артефакты).',
    'Если порядок не задан явно — нумеруй по логической последовательности. Если SLA не упомянут — оставь slaMinutes=null.',
    'Отвечай строго в формате JSON по схеме process_steps_extract_v1.',
  ].join('\n'),
);

export const PROCESS_STEPS_EXTRACT_USER_TEMPLATE = (args: {
  processName: string;
  blocks: ReadonlyArray<{
    criticalQuestion: string;
    trustedAnswer: string;
    quotes: readonly string[];
  }>;
}): string => {
  const blocksText = args.blocks
    .map((b, i) => {
      const qs = b.quotes.length
        ? b.quotes.map((q) => `  «${q}»`).join('\n')
        : '  (цитат нет)';
      return [
        `Блок #${i + 1}:`,
        `  Вопрос: ${b.criticalQuestion}`,
        `  Ответ: ${b.trustedAnswer}`,
        `  Цитаты:`,
        qs,
      ].join('\n');
    })
    .join('\n\n');
  return `Процесс: «${args.processName}»\n\n${blocksText}\n\nВерни JSON по схеме process_steps_extract_v1.`;
};

export const PROCESS_STEPS_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['order', 'name'],
        properties: {
          order: { type: 'integer', minimum: 1, maximum: 999 },
          name: { type: 'string', minLength: 3, maxLength: 300 },
          description: { type: ['string', 'null'], maxLength: 2_000 },
          slaMinutes: { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000 },
          roleHint: { type: ['string', 'null'], maxLength: 300 },
        },
      },
    },
  },
};

export const PROCESS_STEPS_EXTRACT_SCHEMA_NAME = 'process_steps_extract_v1';
