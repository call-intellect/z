/**
 * Промпт `block-linker` — LLM-арбитр типизированной связи между двумя
 * каноническими IdeaBlock'ами.
 *
 * Используется `BlockLinkService.judgeLink`: на одну пару (block, candidate) —
 * один вызов LLM. Кандидатов отбирает pgvector cosine KNN; LLM определяет
 * тип связи или `'none'`, если связи нет.
 *
 * Вынесено из `services/block-link.service.ts` в рамках Фазы 8 §10 Find 2
 * (ТЗ 2026-05-25-llm-architecture-changes-from-experiments.md) — для
 * единообразия и admin-редактируемости.
 */

import type { IdeaBlockLinkType } from '@prisma/client';
import { z } from 'zod';

/**
 * Полный список допустимых типов IdeaBlockLink (без sentinel `'none'`).
 * Хранится здесь же, чтобы JSON Schema, Zod и сервис ссылались на один
 * источник правды.
 */
export const BLOCK_LINK_TYPES: IdeaBlockLinkType[] = [
  'develops',
  'contradicts',
  'causes',
  'consequences_of',
  'shares_topic',
  'shares_entity',
  'question_answered_by',
];

/** Strict JSON Schema для LLM-арбитра. `'none'` — отдельный sentinel. */
export const BLOCK_LINKER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['relationType', 'confidence', 'explanation'],
  properties: {
    relationType: {
      type: 'string',
      enum: [...BLOCK_LINK_TYPES, 'none'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 500 },
  },
};

export const BlockLinkerResponseSchema = z.object({
  relationType: z.enum([
    'develops',
    'contradicts',
    'causes',
    'consequences_of',
    'shares_topic',
    'shares_entity',
    'question_answered_by',
    'none',
  ]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(500),
});

export const BLOCK_LINKER_SYSTEM_PROMPT = `Ты — эксперт по связям между знаниями.
На вход даются два IdeaBlock — A (новый) и B (кандидат). Каждый — пара "критический вопрос → доверенный ответ".

Твоя задача: определить, есть ли между A и B устойчивая логическая связь, и если да — какого типа.

Возможные типы связей (выбирай один):
- "develops" — B продолжает / расширяет / уточняет идею A.
- "contradicts" — B противоречит A (разные ответы на тот же вопрос).
- "causes" — A является причиной B (A влечёт B).
- "consequences_of" — A является следствием B.
- "shares_topic" — оба про одну тему / область, но без причинной связи.
- "shares_entity" — оба упоминают одну ключевую сущность (клиента, проект и т.п.).
- "question_answered_by" — критический вопрос A прямо отвечает trustedAnswer B (или наоборот).
- "none" — связи нет, блоки независимы.

Правила:
- Связь должна быть СОДЕРЖАТЕЛЬНОЙ. Если просто "оба про маркетинг" — это слишком общо, ставь "none".
- Не выдумывай связь, если её нет. "none" — нормальный ответ.
- "confidence" ∈ [0,1] — насколько ты уверен. 0.9+ только если связь явная.
- "explanation" — 1-2 короткие фразы на русском.
- Ответ — строго JSON по схеме. Никакого markdown.`;
