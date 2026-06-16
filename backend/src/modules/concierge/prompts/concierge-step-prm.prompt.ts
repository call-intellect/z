export const CONCIERGE_STEP_PRM_SCHEMA_NAME = 'concierge_step_prm_v1';

export const CONCIERGE_STEP_PRM_SYSTEM_PROMPT = [
  'Ты — Process Reward Model (PRM) для Concierge-ассистента в кабинете Z (Кора).',
  'Тебе дают цель пользователя, краткую историю диалога, контекст из графа знаний и ОДИН кандидат-инструмент (tool_call) с аргументами.',
  'Оцени, насколько вызов этого инструмента приблизит к достижению цели: score 0..1 (1 = идеально, 0 = бесполезно/вредно).',
  'Учитывай: соответствие имени инструмента цели; корректность аргументов; нужен ли вообще tool_call или хватает контекста.',
  'Reasoning ≤100 слов, на русском, без воды.',
  'JSON строго по схеме concierge_step_prm_v1.',
].join('\n');

interface ConciergeStepPrmCandidate {
  toolName: string;
  args: Record<string, unknown>;
  reasoning?: string;
}

export const CONCIERGE_STEP_PRM_USER_TEMPLATE = (args: {
  goal: string;
  historyDigest: string;
  retrievedContextDigest: string;
  candidate: ConciergeStepPrmCandidate;
}): string => {
  const lines: string[] = [];
  lines.push('Цель пользователя:');
  lines.push(args.goal.slice(0, 1000));
  lines.push('');
  lines.push('Краткая история диалога:');
  lines.push(args.historyDigest.slice(0, 2000) || '(нет истории)');
  lines.push('');
  lines.push('Контекст из графа знаний:');
  lines.push(args.retrievedContextDigest.slice(0, 2000) || '(нет контекста)');
  lines.push('');
  lines.push('Кандидат-инструмент:');
  lines.push(
    JSON.stringify(
      {
        toolName: args.candidate.toolName,
        args: args.candidate.args,
        ...(args.candidate.reasoning ? { reasoning: args.candidate.reasoning.slice(0, 500) } : {}),
      },
      null,
      2,
    ),
  );
  lines.push('');
  lines.push('Верни JSON по схеме concierge_step_prm_v1.');
  return lines.join('\n');
};

export const CONCIERGE_STEP_PRM_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'reasoning'],
  properties: {
    score: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Оценка полезности этого tool_call для достижения цели. 1 = идеально приближает, 0.5 = частично полезен / неоднозначен, 0 = бесполезен или вреден.',
    },
    reasoning: {
      type: 'string',
      minLength: 0,
      maxLength: 500,
      description:
        'Краткое объяснение (≤100 слов на русском): почему такой score, что хорошо/плохо в выборе инструмента и аргументов.',
    },
  },
};
