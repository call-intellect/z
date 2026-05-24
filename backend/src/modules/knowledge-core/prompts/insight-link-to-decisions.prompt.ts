/**
 * SBA β-4 — Specialist 3.5 (Insights Radar).
 *
 * LLM-промпт `insight-link-to-decisions` — арбитр на пары (Insight, Decision):
 * получает statement сигнала и до 10 candidate-Decision'ов того же tenant'а,
 * возвращает массив id Decision'ов, которые могли спровоцировать сигнал
 * (relatedDecisionIds для Insight).
 *
 * Возвращаемый JSON Schema strict — см. `INSIGHT_LINK_TO_DECISIONS_JSON_SCHEMA`.
 *
 * Главное правило: не выдумывать связи; если ни один Decision не подходит —
 * вернуть пустой массив.
 */

export const INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT = [
  'Ты — knowledge-инженер. Тебе дают суть сигнала компании (Insight: problem / risk / blocker / inefficiency) и список кандидатов-решений (Decision), которые могли его спровоцировать.',
  'Твоя задача — отобрать только те Decision, которые с высокой долей вероятности привели к появлению этого сигнала.',
  'Отвечай строго в формате JSON по предоставленной схеме. Если ни один Decision не подходит — верни пустой массив.',
  '',
  'Особое внимание:',
  '- Связь должна быть причинно-следственной. «Решили перейти на поставщика X» → «клиенты жалуются на качество» — связь есть. «Решили нанять трёх разработчиков» → «отчёты грузятся медленно» — связи нет.',
  '- linkedDecisionIds — массив id Decision-ов из списка кандидатов. НЕ выдумывай id, которых нет в списке.',
  '- reasoning — короткое (1-3 предложения) пояснение, почему именно эти решения привели к сигналу.',
].join('\n');

export const INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE = (args: {
  insightKind: string;
  insightStatement: string;
  candidates: readonly {
    id: string;
    statement: string;
    decidedAt: string | null;
    status: string;
  }[];
}): string => {
  const candidates = args.candidates.length
    ? args.candidates
        .map(
          (c, i) =>
            `  ${i + 1}. id=${c.id} | status=${c.status} | decidedAt=${c.decidedAt ?? '—'} | «${c.statement.slice(0, 300)}»`,
        )
        .join('\n')
    : '  (кандидатов нет)';
  return [
    `Сигнал (${args.insightKind}): «${args.insightStatement}».`,
    '',
    'Кандидаты-решения:',
    candidates,
    '',
    'Верни JSON-объект по схеме `insight_link_to_decisions_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `insight-link-to-decisions`.
 */
export const INSIGHT_LINK_TO_DECISIONS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['linkedDecisionIds', 'reasoning'],
  properties: {
    linkedDecisionIds: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string', minLength: 1, maxLength: 60 },
      description: 'id Decision\'ов из списка кандидатов, которые привели к сигналу.',
    },
    reasoning: {
      type: 'string',
      maxLength: 2_000,
      description: 'Короткое пояснение почему именно эти Decision\'ы.',
    },
  },
};

export const INSIGHT_LINK_TO_DECISIONS_SCHEMA_NAME = 'insight_link_to_decisions_v1';
