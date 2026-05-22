/**
 * SBA β-5 — Specialist 3.6 (Ideas Collector).
 *
 * LLM-промпт `idea-cluster-merge` — арбитр кластеризации идей: для новой Idea
 * принимает решение `{ 'new_cluster' | 'add_to_existing' | 'standalone' }` на
 * основании ближайших IdeaCluster'ов.
 *
 * TODO(owner-product): согласовать финальный текст промпта.
 */

export const IDEA_CLUSTER_MERGE_SYSTEM_PROMPT = [
  'Ты — knowledge-куратор. Тебе дают новую идею и список ближайших кластеров идей компании.',
  'Реши, добавлять идею в один из существующих кластеров (add_to_existing), создавать новый кластер (new_cluster) или оставить идею одиночной (standalone).',
  'Кластер должен объединять идеи о близкой смысловой области (UX, performance, integrations, и т.п.). Не объединяй идеи только потому, что они затрагивают один и тот же продукт.',
  'Отвечай строго в формате JSON по предоставленной схеме на русском языке.',
].join('\n');

export const IDEA_CLUSTER_MERGE_USER_TEMPLATE = (args: {
  ideaStatement: string;
  ideaRationale: string | null;
  candidates: ReadonlyArray<{
    id: string;
    name: string;
    description: string | null;
    sampleStatements: readonly string[];
  }>;
}): string => {
  const lines = ['Идея:', `«${args.ideaStatement}»`];
  if (args.ideaRationale) lines.push(`Обоснование: ${args.ideaRationale}`);
  lines.push('', 'Кандидаты-кластеры:');
  if (args.candidates.length === 0) {
    lines.push('  (нет — реши: new_cluster или standalone)');
  } else {
    args.candidates.forEach((c, idx) => {
      lines.push(`  ${idx + 1}. [${c.id}] «${c.name}»`);
      if (c.description) lines.push(`     ${c.description}`);
      if (c.sampleStatements.length > 0) {
        lines.push(`     Примеры идей: ${c.sampleStatements.slice(0, 3).join(' / ')}`);
      }
    });
  }
  lines.push('', 'Верни JSON по схеме `idea_cluster_merge_v1`.');
  return lines.join('\n');
};

export const IDEA_CLUSTER_MERGE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['new_cluster', 'add_to_existing', 'standalone'],
    },
    /** id выбранного кластера (только при add_to_existing). */
    targetClusterId: { type: ['string', 'null'] },
    /** Имя нового кластера (только при new_cluster). */
    newClusterName: { type: ['string', 'null'], maxLength: 200 },
    /** Описание нового кластера. */
    newClusterDescription: { type: ['string', 'null'], maxLength: 2_000 },
    reasoning: { type: ['string', 'null'], maxLength: 2_000 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const IDEA_CLUSTER_MERGE_SCHEMA_NAME = 'idea_cluster_merge_v1';
