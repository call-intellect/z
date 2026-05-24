/**
 * SBA β-6 — Specialist 3.9 (Experiment Tracker).
 *
 * LLM-промпт для извлечения / обновления Experiment из IdeaBlock'а
 * signalType ∈ { hypothesis, result, lesson }. Возвращается строгий JSON
 * с одной сущностью.
 */

import { withConfidenceCalibration } from '../../ai/services/prompts/common';

// F2 (2026-05-24): mini-якоря для confidence (hypothesis = 0.4-0.6, result =
// 0.85+) удалены — теперь общий источник правды — `CONFIDENCE_CALIBRATION`.
export const EXPERIMENT_EXTRACT_SYSTEM_PROMPT = withConfidenceCalibration(
  [
    'Ты — аналитик корпоративных экспериментов. Тебе дают один атом знаний (IdeaBlock).',
    'Атом может быть: hypothesis (что хотят попробовать), result (что вышло), lesson (вывод).',
    'Твоя задача — извлечь или дополнить «Experiment»-карточку, которая фиксирует:',
    '  - name: короткое имя эксперимента (до 80 символов),',
    '  - hypothesisText: текст гипотезы — что собирались проверить и зачем,',
    '  - currentResult: краткое описание полученного результата (если есть),',
    '  - lessons: массив выводов (если есть). Каждый lesson — объект',
    '    { text: string, type: "what_worked" | "what_failed" | "next_time" }.',
    '  - status: один из "hypothesis" | "running" | "completed" | "dropped" | "paused".',
    '    hypothesis = ещё не запускали; running = идёт, нет результата;',
    '    completed = есть результат и есть хотя бы один lesson; dropped = бросили.',
    '  - confidence: 0..1 — насколько уверенно атом описывает реальный эксперимент',
    '    (а не общую мысль). Якоря шкалы — ниже.',
    '',
    'Отвечай СТРОГО валидным JSON по схеме. Никакого текста снаружи.',
  ].join('\n'),
);

export const EXPERIMENT_EXTRACT_USER_TEMPLATE = (args: {
  signalType: string;
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
}): string => {
  const lines: string[] = [
    `signalType: ${args.signalType}`,
    `Заголовок блока: ${args.blockName}`,
    `Главный вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
  ];
  if (args.tags.length > 0) {
    lines.push(`Теги: ${args.tags.join(', ')}`);
  }
  if (args.evidenceQuotes.length > 0) {
    lines.push('Цитаты-доказательства:');
    for (const q of args.evidenceQuotes.slice(0, 4)) {
      lines.push(`  • «${q.slice(0, 220)}»`);
    }
  }
  return lines.join('\n');
};

export const EXPERIMENT_EXTRACT_SCHEMA_NAME = 'experiment_extract_v1';

/**
 * JSON Schema для structured output. ID полей синхронизирован с
 * Specialist39ExperimentsService.processBlock.
 */
export const EXPERIMENT_EXTRACT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'hypothesisText', 'status', 'confidence'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    hypothesisText: { type: 'string', minLength: 1, maxLength: 4000 },
    currentResult: {
      type: ['string', 'null'],
      maxLength: 4000,
    },
    lessons: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'type'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 1000 },
          type: {
            type: 'string',
            enum: ['what_worked', 'what_failed', 'next_time'],
          },
        },
      },
    },
    status: {
      type: 'string',
      enum: ['hypothesis', 'running', 'completed', 'dropped', 'paused'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;
