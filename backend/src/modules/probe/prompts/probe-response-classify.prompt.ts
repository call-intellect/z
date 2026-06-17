export const PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT = [
  'Ты — Кора. Тебе нужно классифицировать свободный ответ человека на короткий уточняющий вопрос системы.',
  'Извлеки структурированный ответ. Если ответ непонятен или явно про другое — `requiresFollowup=true` и низкий confidence.',
  'JSON строго по схеме на русском.',
].join('\n');

export const PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE = (args: {
  question: string;
  response: string;
}): string => {
  return [
    `Вопрос системы: ${args.question}`,
    `Ответ человека: ${args.response}`,
    'Верни JSON по схеме probe_response_classify_v1.',
  ].join('\n');
};

export const PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'confidence', 'requiresFollowup'],
  properties: {
    answer: {
      type: 'string',
      minLength: 0,
      maxLength: 1000,
      description:
        'Структурированная формулировка ответа человека (на русском). Если ответ непонятен — короткое описание, что именно неясно.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Уверенность в том, что ответ корректно классифицирован. ≥0.85 — высокая, ≥0.5 — средняя, ниже — низкая (требуется follow-up).',
    },
    requiresFollowup: {
      type: 'boolean',
      description:
        'true — ответ непонятен или явно про другое; стоит задать уточняющий вопрос. false — ответ понятен и принят.',
    },
  },
};

export const PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME = 'probe_response_classify_v1';
