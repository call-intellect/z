export const IDEA_STATUS_SUMMARIZE_SYSTEM_PROMPT = [
  'Ты — Кора, память компании. Тебе нужно кратко сообщить сотруднику, что статус его идеи изменился.',
  'Формируй один title (≤ 80 символов) и один body (≤ 400 символов). Без приветствий. Тон — спокойный, без эмоций.',
  'Объясни в body, что произошло и (если есть) причину. Если есть actionUrl — упомяни, что детали можно посмотреть по ссылке.',
  'Ответ строго в JSON по предоставленной схеме на русском.',
].join('\n');

export const IDEA_STATUS_SUMMARIZE_USER_TEMPLATE = (args: {
  ideaStatement: string;
  oldStatus: string;
  newStatus: string;
  reason: string | null;
}): string => {
  const lines = [
    `Идея: «${args.ideaStatement}».`,
    `Старый статус: ${args.oldStatus}.`,
    `Новый статус: ${args.newStatus}.`,
  ];
  if (args.reason) lines.push(`Причина: ${args.reason}`);
  lines.push('', 'Если actionUrl передан — упомяни в body, что детали доступны по ссылке.');
  lines.push('', 'Верни JSON по схеме `idea_status_summarize_v1`.');
  return lines.join('\n');
};

export const IDEA_STATUS_SUMMARIZE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'body'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', minLength: 1, maxLength: 1_000 },
  },
};

export const IDEA_STATUS_SUMMARIZE_SCHEMA_NAME = 'idea_status_summarize_v1';
