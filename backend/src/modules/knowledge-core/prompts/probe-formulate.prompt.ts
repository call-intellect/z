/**
 * SBA β-5 — Layer 6 (Probe-Agent).
 *
 * LLM-промпт `probe-formulate` — берёт probe-event (reason + payload +
 * suggestedActions) и формирует короткий, понятный уточняющий вопрос
 * (≤ 200 символов). Без вариантов ответа: ЦА — не разработчики, и
 * ответ ожидается в свободной форме (текст или голос, ASR на этапе 0.3).
 *
 * Истоки решения «без кнопок» — Agents v2 Фаза 0 (см. ТЗ
 * plans/tz/2026-05-29-agents-v2-umbrella.md §«Probe без кнопок»):
 *   - кнопки «Да/Нет/Свой вариант» обедняют ответ и заставляют людей
 *     выбирать «то, что ближе», вместо реального ответа;
 *   - в Telegram и веб-чате ввод текста и голос одинаково естественны.
 *
 * `suggestedActions` ОСТАЁТСЯ как контекст для модели (что специалист
 * хотел узнать) — но человеку их НЕ предлагают; задача LLM — задать
 * вопрос так, чтобы человек ответил своими словами.
 *
 * Совместимость с prompt caching:
 *   - SYSTEM стабилен (одна строка, без переменных) → ловит cache hit
 *     у DeepSeek/OpenAI-proxy/MiniMax с экономией ≈99%.
 *   - Все переменные данные — в USER в конце сообщения, чтобы prefix
 *     SYSTEM не ломал кэш между вызовами.
 *
 * Версия schema поднята до v2: `options` удалены, остался только
 * `question`. Schema name = 'probe_formulate_v2' — следует за версией
 * UI/каналов, которые рисуют ответ без кнопок.
 */

export const PROBE_FORMULATE_SYSTEM_PROMPT = [
  'Ты — Кора, память компании. Сформулируй короткий уточняющий вопрос для человека — без вариантов ответа.',
  'Ожидаем свободный ответ текстом или голосом. Одна-две фразы, ≤200 символов. Без приветствий.',
  'Ответ строго в JSON по предоставленной схеме на русском.',
  'Пиши простым человеческим русским. Не используй технические коды, идентификаторы (длинные наборы букв/цифр), логины и английские названия систем/сущностей (Document, Role, CompanyProfile, knowledge_profile и т.п.) — заменяй их понятными словами.',
].join('\n');

export const PROBE_FORMULATE_USER_TEMPLATE = (args: {
  emittedByService: string;
  reason: string;
  message: string;
  suggestedActions: readonly string[];
  contextCard?: { kind: string; title: string } | null;
}): string => {
  const lines = [
    `Источник: специалист ${args.emittedByService}.`,
    `Причина: ${args.reason}.`,
    `Что нашли: ${args.message}`,
  ];
  if (args.contextCard) {
    lines.push(`Контекст: ${args.contextCard.kind} «${args.contextCard.title}»`);
  }
  if (args.suggestedActions.length > 0) {
    lines.push(
      'Подсказки (что специалист хотел узнать) — НЕ перечисляй их человеку, задай вопрос так, чтобы он ответил своими словами:',
    );
    args.suggestedActions.forEach((a, i) => lines.push(`  ${i + 1}. ${a}`));
  }
  lines.push('', 'Верни JSON по схеме `probe_formulate_v2`.');
  return lines.join('\n');
};

export const PROBE_FORMULATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['question'],
  properties: {
    question: {
      type: 'string',
      minLength: 1,
      maxLength: 400,
      description: 'Точечный уточняющий вопрос для человека (≤ 200 символов).',
    },
  },
};

export const PROBE_FORMULATE_SCHEMA_NAME = 'probe_formulate_v2';
