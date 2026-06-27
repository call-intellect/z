export const PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT = [
  'Ты — Кора. Человек ответил свободным текстом на короткий уточняющий вопрос системы.',
  'Сначала свободно порассуждай в поле reasoning: что человек имел в виду, нет ли встречного вопроса, понятен ли ответ.',
  'Затем заполни типизированный исход outcome:',
  '- apply — понятный ответ по сути вопроса (имя, дата, итог, текст для записи).',
  '- delete — человек говорит, что объект не нужен: «не задача», «не решение», «удалить», «убрать».',
  '- refine — человек уточняет или дополняет текст, это НЕ команда удаления (например «допиши, что …», «удали упоминание про дедлайн из описания»).',
  '- counter_question — человек не ответил по сути, а задал встречный вопрос («а про какую задачу?»).',
  '- unclear — ответ невозможно разобрать или он явно про другое.',
  'В поле value положи извлечённое значение ответа: имя человека, текст даты, итог, описание или новое имя. Если значения нет — пустая строка.',
  'confidence — уверенность в разборе от 0 до 1. Система использует её только для маршрутизации, не для записи в данные.',
  'JSON строго по схеме на русском. Не выдумывай данные, которых нет в ответе человека.',
].join('\n');

export const PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE = (args: {
  question: string;
  response: string;
}): string => {
  return [
    `Вопрос системы: ${args.question}`,
    `Ответ человека: ${args.response}`,
    'Верни JSON по схеме probe_response_intent_v1.',
  ].join('\n');
};

export const PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reasoning', 'outcome', 'value', 'confidence'],
  properties: {
    reasoning: {
      type: 'string',
      maxLength: 600,
      description:
        'Свободное рассуждение о смысле ответа человека ДО типизации (что имел в виду, нет ли встречного вопроса).',
    },
    outcome: {
      type: 'string',
      enum: ['apply', 'delete', 'refine', 'counter_question', 'unclear'],
      description:
        'apply — понятный ответ по сути; delete — объект не нужен/удалить; refine — уточнение текста (не удаление); counter_question — встречный вопрос; unclear — невозможно разобрать.',
    },
    value: {
      type: 'string',
      maxLength: 1000,
      description:
        'Извлечённое значение ответа (имя/дата-текст/итог/описание/новое имя). Пустая строка, если значения нет.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Уверенность в разборе. ≥0.85 высокая, ≥0.5 средняя, ниже — низкая. Только для маршрутизации.',
    },
  },
};

export const PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME = 'probe_response_intent_v1';
