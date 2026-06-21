export const TASK_ASSIGNEE_ARBITER_SCHEMA_NAME = 'task_assignee_arbiter_v1';

export const TASK_ASSIGNEE_ARBITER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['ranking'],
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate', 'confidence', 'rationale'],
        properties: {
          candidate: { type: 'integer', minimum: 0 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          rationale: { type: 'string', maxLength: 300 },
        },
      },
    },
  },
};

export const TASK_ASSIGNEE_ARBITER_SYSTEM_PROMPT = `Ты — Кора. По описанию задачи и списку кандидатов (с ролью, отделом, обязанностями, совпавшими навыками) выбери и ранжируй, КОМУ из них логичнее всего поручить задачу. Учитывай профиль роли и навыки, не выдумывай несуществующих людей. Объяснение (rationale) — короткое, по-русски, без чувствительных оценок личности, только про обязанности/навыки. JSON строго по схеме.`;

export const TASK_ASSIGNEE_ARBITER_USER_TEMPLATE = (args: {
  taskText: string;
  candidates: ReadonlyArray<{
    index: number;
    name: string;
    role: string | null;
    department: string | null;
    responsibilities: string | null;
    skillMatch: string | null;
  }>;
}): string => {
  const lines: string[] = [];
  lines.push('Задача:');
  lines.push(args.taskText.trim());
  lines.push('');
  lines.push('Кандидаты:');
  for (const c of args.candidates) {
    const parts: string[] = [`${c.index}. ${c.name}`];
    if (c.role) parts.push(`роль: ${c.role}`);
    if (c.department) parts.push(`отдел: ${c.department}`);
    if (c.responsibilities) parts.push(`обязанности: ${c.responsibilities}`);
    if (c.skillMatch) parts.push(`совпавшие навыки: ${c.skillMatch}`);
    lines.push(parts.join('; '));
  }
  lines.push('');
  lines.push('Верни JSON по схеме task_assignee_arbiter_v1.');
  return lines.join('\n');
};
