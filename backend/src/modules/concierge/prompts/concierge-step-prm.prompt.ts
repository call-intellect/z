/**
 * Agents v2 Фаза B2 (2026-05-30) — Concierge PRM step-scorer.
 *
 * После того как ConciergeService LLM выбрал tool_call (top-1), для shadow-режима
 * генерируется top-K кандидатов и каждый оценивается этим промптом — насколько
 * данный конкретный candidate приблизит к цели пользователя.
 *
 * Используется в `ConciergeStepScorerService.scoreStep`:
 *   - один LLM-вызов через `LlmRouterService.call({taskType:'concierge-step-prm'})`.
 *   - Output JSON Schema strict: `{score: number 0..1, reasoning: string ≤500 chars}`.
 *
 * Совместимость с prompt caching:
 *   - SYSTEM стабилен (одна строка, без runtime-переменных) → cache hit у
 *     DeepSeek / OpenAI-via-proxy / MiniMax с экономией ≈99%.
 *   - Все переменные данные — в конце USER. Префикс SYSTEM не меняется
 *     между вызовами, поэтому KV-cache переиспользуется.
 *
 * Источник доказательств: AgentPRM (arxiv 2511.08325), MASPRM (2510.24803),
 * PRIME-RL 2025. См. plans/tz/2026-05-29-agents-v2-umbrella.md §B2.
 */

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
  // Переменные данные — в самом конце user-сообщения. Так префикс
  // SYSTEM + начало USER остаются стабильными для prompt caching.
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
        ...(args.candidate.reasoning
          ? { reasoning: args.candidate.reasoning.slice(0, 500) }
          : {}),
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
