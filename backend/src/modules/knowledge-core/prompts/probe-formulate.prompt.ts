/**
 * SBA β-5 — Layer 6 (Probe-Agent).
 *
 * LLM-промпт `probe-formulate` — берёт probe-event (reason + payload +
 * suggestedActions) и формирует короткий, понятный вопрос (≤ 200 символов)
 * с 2–4 inline-options. UI / Telegram inline-keyboard рисуют их кнопками.
 */

export const PROBE_FORMULATE_SYSTEM_PROMPT = [
  'Ты — Кора, память компании. Тебе нужно задать сотруднику точечный вопрос — короткий и понятный.',
  'Формат: одна-две фразы (всего ≤ 200 символов). Без приветствий. Никаких «Здравствуйте» — собеседник уже у тебя в чате.',
  'Если в данных есть suggestedActions — переформулируй их в 2–4 короткие кнопки (≤ 30 символов каждая). Иначе придумай уместные варианты.',
  'Ответ строго в JSON по предоставленной схеме на русском.',
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
    lines.push('Варианты действий (от специалиста):');
    args.suggestedActions.forEach((a, i) => lines.push(`  ${i + 1}. ${a}`));
  }
  lines.push('', 'Верни JSON по схеме `probe_formulate_v1`.');
  return lines.join('\n');
};

export const PROBE_FORMULATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['question', 'options'],
  properties: {
    question: {
      type: 'string',
      minLength: 1,
      maxLength: 400,
      description: 'Точечный вопрос для пользователя (≤ 200 символов).',
    },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 40 },
      description: 'Inline-варианты ответа (2–4 кнопки).',
    },
  },
};

export const PROBE_FORMULATE_SCHEMA_NAME = 'probe_formulate_v1';
