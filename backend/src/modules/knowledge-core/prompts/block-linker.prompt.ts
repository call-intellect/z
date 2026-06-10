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

import { withConfidenceCalibration } from '../../ai/services/prompts/common';

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

/**
 * Strict JSON Schema для LLM-арбитра. `'none'` — отдельный sentinel.
 *
 * Agents v2 Фаза A1 (2026-05-30) — Bi-temporal edges:
 *   - `validFrom` / `validUntil` — ISO-даты, извлекаемые LLM из явных временных
 *     указателей в исходных блоках («с октября», «до конца квартала»). null,
 *     если такого указателя нет — TemporalConflictService закроет связь
 *     по факту противоречия.
 *   - Поля строго required, тип `['string','null']` под Anthropic JSON Schema dialect.
 */
export const BLOCK_LINKER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'relationType',
    'confidence',
    'explanation',
    'validFrom',
    'validUntil',
  ],
  properties: {
    relationType: {
      type: 'string',
      enum: [...BLOCK_LINK_TYPES, 'none'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 500 },
    // Agents v2 Фаза A1 — bi-temporal hints. Извлекаются из явных временных
    // указателей в блоках. Если ничего не сказано — null.
    validFrom: {
      type: ['string', 'null'],
      maxLength: 40,
      description:
        'Если в блоках явно указано когда факт стал валиден ("с октября", "с 2025-Q3") — ISO date (YYYY-MM-DD / YYYY-MM / YYYY); иначе null.',
    },
    validUntil: {
      type: ['string', 'null'],
      maxLength: 40,
      description:
        'Если связь явно завершена в блоках ("до конца квартала", "до подписания контракта") — ISO date; иначе null (открытый интервал).',
    },
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
  // Agents v2 Фаза A1 — backward-compat: nullable+optional (старые ответы LLM
  // без обновлённого промпта тоже валидны).
  validFrom: z.string().max(40).nullable().optional(),
  validUntil: z.string().max(40).nullable().optional(),
});

// A9 (2026-06-10): `confidence` здесь решает, создавать ли типизированное ребро
// графа (IdeaBlockLink) и с каким весом — поэтому SYSTEM завершается единой
// шкалой уверенности (`withConfidenceCalibration`, дописывается в КОНЕЦ →
// cache-friendly). Локальное правило про «0.9+ только если связь явная»
// остаётся в теле промпта и согласуется со шкалой.
export const BLOCK_LINKER_SYSTEM_PROMPT = withConfidenceCalibration(`Ты — эксперт по связям между знаниями.
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
- "validFrom" / "validUntil" — ISO-дата (YYYY-MM-DD / YYYY-MM / YYYY), если в исходных блоках есть явный временной указатель ("с октября", "до конца квартала", "до подписания контракта"). Если ничего не сказано — null. НЕ ВЫДУМЫВАЙ даты.
- Ответ — строго JSON по схеме. Никакого markdown.`);
