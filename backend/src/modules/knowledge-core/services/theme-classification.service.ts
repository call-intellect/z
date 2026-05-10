import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Entity, IdeaBlock, ThemeBranch } from '@prisma/client';
import { z } from 'zod';

import { LlmRouterService } from '../../ai/services/llm-router.service';

/**
 * 12 веток компании из delivery M-07 + 'none' (LLM использует, если ветка
 * не определилась). Маппим 'none' → null в результате.
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

const THEME_CLASSIFY_JSON_SCHEMA: Record<string, unknown> = {
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

const ThemeClassifyResponseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000),
  branch: z.enum([...THEME_BRANCH_VALUES, 'none']),
  tags: z.array(z.string().trim().min(1)).min(1).max(10),
  weight: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `Ты — аналитик, который называет тематические кластеры IdeaBlock'ов компании.

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
- Ответ — строго JSON по схеме.`;

export interface ThemeClassificationInput {
  tenantId: string;
  blocks: Pick<
    IdeaBlock,
    'id' | 'name' | 'criticalQuestion' | 'trustedAnswer' | 'signalType' | 'tags'
  >[];
  entities: Pick<Entity, 'id' | 'canonicalName' | 'type'>[];
}

export interface ThemeClassificationResult {
  name: string;
  description: string;
  branch: ThemeBranch | null;
  tags: string[];
  weight: number;
  confidence: number;
}

/**
 * ThemeClassificationService — LLM-классификатор тематического кластера
 * (taskType `theme-classify`). Возвращает имя/описание/ветку/теги.
 *
 * Используется `theme-clusterer.cron`'ом по каждому устойчивому кластеру.
 */
@Injectable()
export class ThemeClassificationService {
  private readonly logger = new Logger(ThemeClassificationService.name);

  constructor(@Inject(LlmRouterService) private readonly llm: LlmRouterService) {}

  async classifyTheme(
    input: ThemeClassificationInput,
  ): Promise<ThemeClassificationResult | null> {
    const { tenantId, blocks, entities } = input;
    if (blocks.length === 0) return null;

    const userPayload = {
      blocks: blocks.map((b) => ({
        id: b.id,
        name: b.name,
        criticalQuestion: b.criticalQuestion,
        trustedAnswer: b.trustedAnswer,
        signalType: b.signalType,
        tags: b.tags,
      })),
      entities: entities.map((e) => ({
        id: e.id,
        type: e.type,
        canonicalName: e.canonicalName,
      })),
    };
    const userMessage = `Кластер из ${blocks.length} блоков:\n\n${JSON.stringify(userPayload, null, 2)}`;

    const out = await this.llm.call({
      taskType: 'theme-classify',
      tenantId,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      responseFormat: {
        type: 'json_schema',
        name: 'ThemeClassification',
        strict: true,
        schema: THEME_CLASSIFY_JSON_SCHEMA,
      },
      sourceRef: { type: 'theme-classify', id: tenantId },
    });

    return this.parse(out.text);
  }

  private parse(text: string): ThemeClassificationResult | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.logger.warn('theme-classify: ответ LLM не валидный JSON');
      return null;
    }
    const parsed = ThemeClassifyResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        { issues: parsed.error.issues.map((i) => i.message) },
        'theme-classify: ответ LLM не прошёл schema',
      );
      return null;
    }
    const branch: ThemeBranch | null =
      parsed.data.branch === 'none' ? null : (parsed.data.branch as ThemeBranch);
    return {
      name: parsed.data.name,
      description: parsed.data.description,
      branch,
      tags: parsed.data.tags,
      weight: parsed.data.weight,
      confidence: parsed.data.confidence,
    };
  }
}
