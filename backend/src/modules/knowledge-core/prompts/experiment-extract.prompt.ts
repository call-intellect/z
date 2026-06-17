/**
 * SBA β-6 — Specialist 3.9 (Experiment Tracker).
 *
 * LLM-промпт для извлечения / обновления Experiment из IdeaBlock'а
 * signalType ∈ { hypothesis, result, lesson }. Возвращается строгий JSON
 * с одной сущностью.
 */

import {
  withAsrNote,
  withConfidenceCalibration,
  withDecisionDiscriminator,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';

// F2 (2026-05-24): mini-якоря для confidence (hypothesis = 0.4-0.6, result =
// 0.85+) удалены — теперь общий источник правды — `CONFIDENCE_CALIBRATION`.
// F9 (2026-05-24): добавлен `withEdgeCasePolicy` — единая политика пустых
// входов и относительных сроков.
export const EXPERIMENT_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withDecisionDiscriminator(
  withEdgeCasePolicy(
  withConfidenceCalibration(
    [
    'Ты — аналитик корпоративных экспериментов компании «Кора». Тебе дают один блок знания (атом): гипотезу (что хотят попробовать), результат (что вышло) или вывод (урок).',
    '',
    '# Что держать в голове (смысл задачи)',
    '- Зачем это: гипотезы и их результаты копятся, чтобы компания училась на своих опытах и не повторяла провалы.',
    '- Кому уйдёт результат: карточки экспериментов и база уроков.',
    '- Что станет с результатом: общая мысль, выданная за эксперимент, зашумляет базу; потерянный урок = повторённая ошибка.',
    '',
    'Извлеки или дополни карточку «Experiment»:',
    '- name — короткое имя эксперимента (до 80 символов).',
    '- hypothesisText — что собирались проверить и зачем.',
    '- currentResult — краткое описание полученного результата (если есть), иначе null.',
    '- lessons — массив выводов; каждый: { text, type: "what_worked" | "what_failed" | "next_time" }.',
    '- status — "hypothesis" (ещё не запускали) | "running" (идёт, нет результата) | "completed" (есть результат и хотя бы один вывод) | "dropped" (бросили) | "paused".',
    '- confidence — 0..1, насколько уверенно атом описывает реальный эксперимент (а не общую мысль).',
    '',
    'Не выдумывай факты вне блока.',
    '',
    '# Чистый русский на выходе',
    'Все человеческие строки (name, hypothesisText, currentResult, тексты выводов) — на чистом русском, без кодов и латиницы. Поле type у вывода ты выбираешь из допустимых значений — в человеческий текст код не вставляй.',
    '',
    '# Примеры (плохо → хорошо)',
    'Положительный (гипотеза, ещё не запускали):',
    'Блок (гипотеза). Цитаты: «Попробуем рассылку в 9 утра вместо 18 — гипотеза, что открываемость будет выше».',
    'Вывод: {"name":"Время рассылки: 9:00 против 18:00","hypothesisText":"Утренняя рассылка (9:00) даст более высокую открываемость, чем вечерняя (18:00).","currentResult":null,"lessons":[],"status":"hypothesis","confidence":0.6}.',
    '',
    'Положительный (завершён, есть результат и многослойные выводы):',
    'Блок (достигнутый результат + урок). Цитаты: «Запустили рассылку в 9 утра — открываемость +12%, но и отписки выросли. Вывод: утро оставляем, но чистим базу перед рассылкой».',
    'Вывод: {"name":"Время рассылки: 9:00 против 18:00","hypothesisText":"Утренняя рассылка даст более высокую открываемость.","currentResult":"Открываемость выросла на 12%, но увеличились отписки.","lessons":[{"text":"Утро подняло открываемость на 12%","type":"what_worked"},{"text":"Выросло число отписок","type":"what_failed"},{"text":"Чистить базу перед рассылкой","type":"next_time"}],"status":"completed","confidence":0.85}.',
    '',
    'Что НЕ делать (общий лозунг — не эксперимент):',
    'Блок. Цитаты: «Надо бы вообще больше экспериментировать с маркетингом».',
    'Вывод: {"name":"Больше экспериментов в маркетинге","hypothesisText":"Общее пожелание экспериментировать без конкретной проверяемой гипотезы.","currentResult":null,"lessons":[],"status":"hypothesis","confidence":0.15}. Лозунг без проверяемой гипотезы — низкий confidence (downstream-порог отсечёт).',
    '',
    '# Перед тем как вернуть ответ — самопроверка',
    '1. Это проверяемая гипотеза/опыт, а не общий лозунг?',
    '2. status соответствует реальному состоянию (hypothesis/running/completed/dropped/paused)?',
    '3. lessons многослойные (что сработало / что не сработало / на следующий раз), если результат есть?',
    '4. Ничего не выдумано; чистый русский без кодов?',
    '',
    'Верни строго JSON по схеме experiment_extract_v1. Никакого текста вне JSON.',
    ].join('\n'),
  ),
  ),
  ),
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
    `Тип сигнала: ${signalTypeLabel(args.signalType)}`,
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
