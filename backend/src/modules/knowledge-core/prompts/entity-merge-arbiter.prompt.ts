import { z } from 'zod';

import { withAsrNote } from '../../ai/services/prompts/common';

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

export const ENTITY_MERGE_ARBITER_SYSTEM_PROMPT =
  withAsrNote(`Ты — арбитр дубликатов сущностей в knowledge-core.
Получаешь одну «новую» сущность и одного кандидата того же типа (того же tenant'а), ближайшего по эмбеддингу. Реши, один и тот же ли это объект.
Решаешь: новая сущность — это другое написание / алиас кандидата (verdict="merge"), или это другая сущность (verdict="distinct").

Правила:
- Учитывай metadata: для type=person — должность/email/телефон; для type=client — ИНН/домен/город; для type=project — кодовое имя; для type=product — артикул/SKU.
- НЕ сливай однофамильцев из разных компаний (если metadata явно разделяет — distinct).
- НЕ сливай разные продукты с похожими именами в разных проектах.
- Учитывай контекст блоков (recentMentions[]) — если новая сущность и кандидат упоминаются в одних и тех же блоках/контекстах, это сильный сигнал к merge.
- Если merge — поле "canonicalId" обязательно (id переданного кандидата).
- Если distinct — "canonicalId" не указывай.
- "explanation" — короткое объяснение в 1-2 предложениях, на русском.

При противоречии источников (metadata/контекст) бери более позднее / актуальное; устаревшие данные сущности считай заменёнными, не смешивай старую и новую редакцию в одну.
- Ответ — строго JSON по схеме. Никакого markdown.`);
