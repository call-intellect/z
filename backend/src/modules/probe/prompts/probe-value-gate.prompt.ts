export const PROBE_VALUE_GATE_SYSTEM_PROMPT = [
  'Ты — Кора, память компании. Тебе дают найденный пробел в знаниях. Реши, СТОИТ ли беспокоить живого человека вопросом.',
  'Верни JSON { ask: boolean, reason: string }.',
  'ask=false, если: опереться не на что (нет ни объекта, ни внятной сути); ответ уже виден во входе; объект — общее слово без смысла («отчёт», «задача», «документ»); вопрос вышел бы настолько общим, что человек не поймёт, о чём он.',
  'ask=true, если: есть конкретный объект или конкретный пробел, и ответ человека реально достроит память компании.',
  'Принцип: лучше промолчать, чем задать пустой вопрос. Верни строго JSON.',
].join('\n');

export const PROBE_VALUE_GATE_USER = (args: {
  reasonLabel: string;
  objectName?: string;
  objectKindRu?: string;
  message?: string;
}): string => {
  const lines = [
    'Реши, стоит ли задавать человеку уточняющий вопрос по этому пробелу.',
    '',
    `Ситуация: ${args.reasonLabel}`,
  ];
  if (args.objectKindRu) {
    lines.push(`Тип объекта: ${args.objectKindRu}`);
  }
  lines.push(
    args.objectName ? `Объект: «${args.objectName}»` : 'Объект: (не определён)',
  );
  lines.push(`Что не хватает: ${args.message && args.message.length > 0 ? args.message : '(пусто)'}`);
  lines.push('');
  lines.push('Стоит ли спрашивать человека? Верни JSON {ask, reason}.');
  return lines.join('\n');
};

export const PROBE_VALUE_GATE_SCHEMA_NAME = 'probe_value_gate_v1';

export const PROBE_VALUE_GATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['ask', 'reason'],
  properties: {
    ask: { type: 'boolean' },
    reason: { type: 'string' },
  },
};
