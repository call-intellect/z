export const PROBE_DRAFT_FROM_MEMORY_SYSTEM_PROMPT = [
  'Ты помогаешь руководителю сформулировать ЧЕРНОВИК на основе зафиксированных в памяти компании фактов.',
  'Не выдумывай факты, которых нет в данных. Если сигналов мало — честно отметь, чего не хватает.',
  'Это черновик для правки человеком. Пиши по-русски, кратко, без английских слов.',
  'Верни JSON строго по схеме probe_draft_from_memory_v1, без пояснений вне JSON.',
].join('\n');

export const PROBE_DRAFT_FROM_MEMORY_USER_TEMPLATE = (args: {
  kindLabel: string;
  question: string;
  facts: string;
}): string => {
  return [
    `Тип черновика: ${args.kindLabel}.`,
    'Собери черновик ответа на вопрос ниже, опираясь ТОЛЬКО на факты из памяти.',
    'Если фактов мало — всё равно дай аккуратный черновик и отметь в missingNote, чего не хватило.',
    '',
    `Вопрос: ${args.question}`,
    '',
    'Факты из памяти:',
    args.facts,
  ].join('\n');
};

export const PROBE_DRAFT_FROM_MEMORY_SCHEMA_NAME = 'probe_draft_from_memory_v1';

export const PROBE_DRAFT_FROM_MEMORY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['draftAnswer', 'missingNote'],
  properties: {
    draftAnswer: { type: 'string' },
    missingNote: { type: 'string' },
  },
};
