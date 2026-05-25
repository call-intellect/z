/**
 * Промпт `entity-merge-arbiter` — LLM-арбитр дубликатов сущностей.
 *
 * Используется `EntityMergeService.judgeMerge`: на вход — новая сущность и
 * один кандидат того же type, ближайший по pgvector cosine; на выходе —
 * verdict ∈ {merge, distinct} + canonicalId (для merge).
 *
 * Учитывает metadata (для person — должность/email/телефон; для client —
 * ИНН/домен/город; для project — кодовое имя; для product — артикул/SKU)
 * и контекст недавних блоков (recentMentions) обоих участников.
 *
 * Вынесено из `services/entity-merge.service.ts` в рамках Фазы 8 §10 Find 2
 * (ТЗ 2026-05-25-llm-architecture-changes-from-experiments.md) — для
 * единообразия и admin-редактируемости.
 */

import { z } from 'zod';

export const EntityMergeArbiterResponseSchema = z.object({
  verdict: z.enum(['merge', 'distinct']),
  canonicalId: z.string().optional(),
  explanation: z.string(),
});

export const ENTITY_MERGE_ARBITER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'explanation'],
  properties: {
    verdict: { type: 'string', enum: ['merge', 'distinct'] },
    canonicalId: { type: 'string' },
    explanation: { type: 'string' },
  },
};

export const ENTITY_MERGE_ARBITER_SYSTEM_PROMPT = `Ты — арбитр дубликатов сущностей в knowledge-core.
Получаешь одну "новую" сущность и до 5 кандидатов того же типа (того же tenant'а), ближайших по эмбеддингу.
Решаешь: новая сущность — это другое написание / алиас одного из кандидатов (verdict="merge"), или это другая сущность (verdict="distinct").

Правила:
- Учитывай metadata: для type=person — должность/email/телефон; для type=client — ИНН/домен/город; для type=project — кодовое имя; для type=product — артикул/SKU.
- НЕ сливай однофамильцев из разных компаний (если metadata явно разделяет — distinct).
- НЕ сливай разные продукты с похожими именами в разных проектах.
- Учитывай контекст блоков (recentMentions[]) — если новая сущность и кандидат упоминаются в одних и тех же блоках/контекстах, это сильный сигнал к merge.
- Если merge — поле "canonicalId" обязательно (id одного из переданных кандидатов).
- Если distinct — "canonicalId" не указывай.
- "explanation" — короткое объяснение в 1-2 предложениях, на русском.
- Ответ — строго JSON по схеме. Никакого markdown.`;
