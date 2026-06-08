/**
 * Промпт `theme-classify` — LLM-классификатор тематического кластера
 * IdeaBlock'ов: имя / описание / 12-веточная классификация / теги / weight / confidence.
 *
 * Используется `ThemeClassificationService.classifyTheme` (вызывается
 * `theme-clusterer.cron` по каждому устойчивому кластеру).
 *
 * Вынесено из `services/theme-classification.service.ts` в рамках Фазы 8 §10
 * Find 2 (ТЗ 2026-05-25-llm-architecture-changes-from-experiments.md) —
 * для единообразия и admin-редактируемости.
 *
 * NB: enum `THEME_BRANCH_VALUES` остался публичным экспортом сервиса —
 * это значения, известные снаружи (Prisma ThemeBranch, UI). Реэкспортим
 * его и здесь, чтобы JSON Schema / Zod / сервис ссылались на единый источник.
 */

import { z } from 'zod';

import {
  withAsrNote,
  withConfidenceCalibration,
} from '../../ai/services/prompts/common';

/**
 * 12 веток компании из delivery M-07. В JSON-схеме / Zod к ним добавляется
 * sentinel `'none'` — он маппится в `null` (ветка не определилась) на стороне
 * сервиса.
 */
export const THEME_BRANCH_VALUES = [
  'strategy',
  'clients',
  'sales',
  'marketing',
  'product',
  'operations',
  'team',
  'finance',
  'technology',
  'production',
  'partnerships',
  'legal',
] as const;

export const THEME_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'branch', 'tags', 'weight', 'confidence'],
  properties: {
    name: { type: 'string', maxLength: 100 },
    description: { type: 'string', maxLength: 1000 },
    branch: {
      type: 'string',
      enum: [...THEME_BRANCH_VALUES, 'none'],
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 10,
    },
    weight: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const ThemeClassifyResponseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000),
  branch: z.enum([...THEME_BRANCH_VALUES, 'none']),
  tags: z.array(z.string().trim().min(1)).min(1).max(10),
  weight: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

export const THEME_CLASSIFY_SYSTEM_PROMPT = withAsrNote(
  withConfidenceCalibration(`Ты — аналитик, который называет тематические кластеры IdeaBlock'ов компании.

На вход — N блоков (criticalQuestion + trustedAnswer + signalType + tags) и список упомянутых сущностей.

Твоя задача — дать кластеру:
1. "name" — короткое имя темы (≤100 символов, существительное / именная фраза, без markdown).
2. "description" — описание (≤1000 символов, 2-4 предложения по-русски): что общего у этих блоков.
3. "branch" — одна из 12 веток компании ИЛИ "none" если ни одна не подходит:
   - strategy — стратегия и видение
   - clients — работа с клиентами и аккаунт-менеджмент
   - sales — продажи и сделки
   - marketing — маркетинг и продвижение
   - product — продукт, фичи, бэклог
   - operations — операционка и процессы
   - team — команда, найм, культура
   - finance — финансы и бюджет
   - technology — технологии, инфраструктура
   - production — производство / поставки
   - partnerships — партнёрства
   - legal — юридические вопросы
4. "tags" — 1-10 коротких ключевых слов (каждое ≤30 символов).
5. "weight" — важность темы для бизнеса (0..1; 0.7+ для критичных тем).
6. "confidence" — уверенность в кластере (0..1; 0.8+ для очевидной темы).

Правила:
- Не выдумывай связи. Если блоки разнородные — низкий confidence.
- name на русском, без эмодзи и без кавычек.
- Ответ — строго JSON по схеме.`),
);
