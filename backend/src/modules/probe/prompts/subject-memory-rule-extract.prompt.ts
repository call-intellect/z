export const SUBJECT_MEMORY_RULE_EXTRACT_SYSTEM_PROMPT = [
  'Ты — Кора. По паре (уточняющий вопрос системы → ответ человека) извлеки ПЕРЕИСПОЛЬЗУЕМОЕ правило о компании,',
  'которое позволит впредь НЕ переспрашивать: термин/аббревиатуру (term), разрешённую неоднозначность (disambiguation)',
  'или предпочтение (preference).',
  'Если ответ одноразовый и не обобщается — isReusable=false.',
  'contextText = по какому вопросу/ситуации правило применимо (для последующего поиска).',
  'ruleText = что подставлять вместо вопроса.',
  'JSON строго по схеме, на русском.',
].join('\n');

export const SUBJECT_MEMORY_RULE_EXTRACT_USER_TEMPLATE = (args: {
  question: string;
  answer: string;
}): string => {
  return [
    `Вопрос системы: ${args.question}`,
    `Ответ человека: ${args.answer}`,
    'Верни JSON по схеме subject_memory_rule_extract_v1.',
  ].join('\n');
};

export const SUBJECT_MEMORY_RULE_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['isReusable', 'kind', 'contextText', 'ruleText', 'confidence'],
  properties: {
    isReusable: {
      type: 'boolean',
      description:
        'true — ответ обобщается в переиспользуемое правило; false — одноразовый, правило не выводим.',
    },
    kind: {
      type: 'string',
      enum: ['term', 'disambiguation', 'preference'],
      description:
        'term — термин/аббревиатура; disambiguation — разрешённая неоднозначность; preference — предпочтение.',
    },
    contextText: {
      type: 'string',
      maxLength: 500,
      description:
        'По какому вопросу/ситуации правило применимо (ключ для последующего семантического поиска).',
    },
    ruleText: {
      type: 'string',
      maxLength: 1000,
      description: 'Что подставлять вместо вопроса (выученный ответ/правило).',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Уверенность в выведенном правиле 0..1.',
    },
  },
};

export const SUBJECT_MEMORY_RULE_EXTRACT_SCHEMA_NAME =
  'subject_memory_rule_extract_v1';
