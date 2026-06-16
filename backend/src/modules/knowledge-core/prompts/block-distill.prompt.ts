import { z } from 'zod';

import { withAsrNote } from '../../ai/services/prompts/common';

export const BlockDistillJudgeResponseSchema = z.object({
  verdict: z.enum(['merge', 'distinct']),
  canonicalId: z.string().optional(),
  explanation: z.string(),
});

export const BLOCK_DISTILL_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'explanation'],
  properties: {
    verdict: { type: 'string', enum: ['merge', 'distinct'] },
    canonicalId: { type: 'string' },
    explanation: { type: 'string' },
  },
};

export const BLOCK_DISTILL_SYSTEM_PROMPT = withAsrNote(`Ты — арбитр дубликатов знания.
Получаешь один новый IdeaBlock и до 5 кандидатов-канонических блоков, ближайших к нему по эмбеддингу.
Решаешь: новый блок — это перефразировка одного из кандидатов (verdict="merge"), или это отдельное самостоятельное знание (verdict="distinct").

Правила:
- merge только если новый блок ОТВЕЧАЕТ НА ТОТ ЖЕ ВОПРОС, что и кандидат, и trustedAnswer семантически совместим.
- Разные signalType (например, fact vs pain) — почти всегда distinct.
- Разные сущности (разные клиенты/проекты) — distinct, даже при похожем тексте.
- Если merge — поле "canonicalId" обязательно (id одного из переданных кандидатов).
- Если distinct — "canonicalId" не указывай.
- "explanation" — короткое объяснение в 1-2 предложениях, на русском.
- Источник: report — вторичный, transcript — первичный. При выборе canonical между report и transcript canonical ВСЕГДА transcript; report сливается в него.

При противоречии источников бери более позднее / актуальное знание; устаревшую формулировку считай заменённой, не смешивай старую и новую редакцию ответа в одну.
- Ответ — строго JSON по схеме. Никакого markdown.`);
