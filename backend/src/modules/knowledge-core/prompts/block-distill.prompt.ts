/**
 * Промпт `block-distill` — LLM-арбитр дубликатов IdeaBlock'ов.
 *
 * Используется `BlockMergeService.judgeMerge` для решения, является ли новый
 * блок перефразировкой одного из top-K канонических кандидатов, ближайших по
 * pgvector cosine (merge) — или это отдельное самостоятельное знание (distinct).
 *
 * Вынесено из `services/block-merge.service.ts` в рамках Фазы 8 §10 Find 2
 * (ТЗ 2026-05-25-llm-architecture-changes-from-experiments.md) — для
 * единообразия и admin-редактируемости.
 */

import { z } from 'zod';

import { withAsrNote } from '../../ai/services/prompts/common';

/**
 * Zod-схема ответа арбитра. При `verdict === 'merge'` `canonicalId`
 * обязателен — это валидируется на стороне сервиса.
 */
export const BlockDistillJudgeResponseSchema = z.object({
  verdict: z.enum(['merge', 'distinct']),
  canonicalId: z.string().optional(),
  explanation: z.string(),
});

/**
 * Strict JSON Schema для OpenAI Responses / DeepSeek json_schema.
 */
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
