import type { IdeaBlockLinkType } from '@prisma/client';
import { z } from 'zod';

import { withConfidenceCalibration } from '../../ai/services/prompts/common';

export const BLOCK_LINK_TYPES: IdeaBlockLinkType[] = [
  'develops',
  'contradicts',
  'causes',
  'consequences_of',
  'shares_topic',
  'shares_entity',
  'question_answered_by',
];

export const BLOCK_LINKER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['relationType', 'confidence', 'explanation', 'validFrom', 'validUntil'],
  properties: {
    relationType: {
      type: 'string',
      enum: [...BLOCK_LINK_TYPES, 'none'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 500 },
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
  validFrom: z.string().max(40).nullable().optional(),
  validUntil: z.string().max(40).nullable().optional(),
});

export const BLOCK_LINKER_SYSTEM_PROMPT =
  withConfidenceCalibration(`Ты — эксперт по связям между знаниями.
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
