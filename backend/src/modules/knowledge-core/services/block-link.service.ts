import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type IdeaBlock,
  type IdeaBlockLinkType,
  type IdeaBlockStatus,
  type SignalType,
} from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';

/**
 * Результат LLM-арбитра типизированной связи между двумя блоками.
 *
 *   - Если LLM ответил `'none'` — связи нет, поле `relationType = null`.
 *   - Иначе — конкретный тип из enum'а IdeaBlockLinkType.
 */
export interface LinkVerdict {
  relationType: IdeaBlockLinkType | null;
  confidence: number;
  explanation: string;
}

interface RawLinkCandidateRow {
  id: string;
  tenantId: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: string[];
  signalType: string;
  confidence: string | number;
  dataClass: string;
  status: string;
  mergedIntoId: string | null;
  evidenceCount: number;
  dynamicScore: string | number;
  createdAt: Date;
  updatedAt: Date;
  similarity: string | number;
}

const LINK_TYPES: IdeaBlockLinkType[] = [
  'develops',
  'contradicts',
  'causes',
  'consequences_of',
  'shares_topic',
  'shares_entity',
  'question_answered_by',
];

/** Strict JSON Schema для LLM-арбитра. `'none'` — отдельный sentinel. */
const LINK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['relationType', 'confidence', 'explanation'],
  properties: {
    relationType: {
      type: 'string',
      enum: [...LINK_TYPES, 'none'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 500 },
  },
};

const LinkResponseSchema = z.object({
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

const LINK_SYSTEM_PROMPT = `Ты — эксперт по связям между знаниями.
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

/**
 * BlockLinkService — KNN-кандидаты + LLM-арбитр для `block-linker.worker`.
 *
 *   - `findLinkCandidates`: top-K ближайших canonical-блоков того же tenant'а
 *     по cosine. Без threshold — отбор по похожести делает LLM.
 *   - `judgeLink`: один LLM-вызов на одну пару (block, candidate). Возвращает
 *     `relationType` ∈ enum + 'none', confidence, explanation.
 */
@Injectable()
export class BlockLinkService {
  private readonly logger = new Logger(BlockLinkService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async findLinkCandidates(args: {
    tenantId: string;
    blockId: string;
    topK: number;
  }): Promise<Array<{ candidate: IdeaBlock; similarity: number }>> {
    // Фильтр такой же, как в BlockMergeService.knnCandidates, но без
    // threshold — кандидатов отсеивает LLM.
    const rows = await this.prisma.$queryRawUnsafe<RawLinkCandidateRow[]>(
      `
      SELECT b.id, b."tenantId", b.name, b."criticalQuestion", b."trustedAnswer",
             b.tags, b."signalType", b.confidence, b."dataClass", b.status,
             b."mergedIntoId", b."evidenceCount", b."dynamicScore",
             b."createdAt", b."updatedAt",
             1 - (b.embedding <=> (
               SELECT embedding FROM "IdeaBlock" WHERE id = $2
             )::vector(1536)) AS similarity
      FROM "IdeaBlock" b
      WHERE b."tenantId" = $1
        AND b.status = 'canonical'
        AND b.id <> $2
        AND b.embedding IS NOT NULL
        AND b."mergedIntoId" IS NULL
      ORDER BY b.embedding <=> (
        SELECT embedding FROM "IdeaBlock" WHERE id = $2
      )::vector(1536)
      LIMIT $3
      `,
      args.tenantId,
      args.blockId,
      args.topK,
    );
    return rows
      .map((r) => {
        const sim = typeof r.similarity === 'string' ? Number(r.similarity) : r.similarity;
        return {
          candidate: this.rowToIdeaBlock(r),
          similarity: Number.isFinite(sim) ? sim : 0,
        };
      })
      .filter((c) => Number.isFinite(c.similarity));
  }

  async judgeLink(args: {
    tenantId: string;
    fromBlock: IdeaBlock;
    toBlock: IdeaBlock;
  }): Promise<LinkVerdict> {
    const userPayload = {
      blockA: this.summariseBlock(args.fromBlock),
      blockB: this.summariseBlock(args.toBlock),
    };
    const userMessage = `Блок A и блок B ниже. Определи тип связи (или "none").\n\n${JSON.stringify(userPayload, null, 2)}`;

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (блоки) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    try {
      const out = await this.llm.call({
        taskType: 'block-linker',
        tenantId: args.tenantId,
        systemPrompt: guardOn
          ? withInjectionGuard(LINK_SYSTEM_PROMPT)
          : LINK_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'BlockLinkerVerdict',
          strict: true,
          schema: LINK_JSON_SCHEMA,
        },
        sourceRef: { type: 'idea-block', id: args.fromBlock.id },
        // Фаза 11: max(fromBlock, toBlock).dataClass.
        dataClass: maxDataClass([
          args.fromBlock.dataClass,
          args.toBlock.dataClass,
        ]),
      });
      const parsed = this.parseVerdict(out.text);
      if (parsed) return parsed;
      this.logger.warn(
        { fromId: args.fromBlock.id, toId: args.toBlock.id },
        'block-linker: invalid JSON LLM-арбитра — fallback на none',
      );
      return { relationType: null, confidence: 0, explanation: 'invalid LLM judge JSON' };
    } catch (err) {
      this.logger.warn(
        {
          fromId: args.fromBlock.id,
          toId: args.toBlock.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-linker: LLM judge упал — fallback на none',
      );
      return { relationType: null, confidence: 0, explanation: 'LLM judge call failed' };
    }
  }

  // ─────────────────────────── helpers ─────────────────────────────────────

  private parseVerdict(text: string): LinkVerdict | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = LinkResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.relationType === 'none') {
      return {
        relationType: null,
        confidence: parsed.data.confidence,
        explanation: parsed.data.explanation,
      };
    }
    return {
      relationType: parsed.data.relationType,
      confidence: parsed.data.confidence,
      explanation: parsed.data.explanation,
    };
  }

  private summariseBlock(b: IdeaBlock): Record<string, unknown> {
    return {
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
    };
  }

  private rowToIdeaBlock(r: RawLinkCandidateRow): IdeaBlock {
    return {
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      criticalQuestion: r.criticalQuestion,
      trustedAnswer: r.trustedAnswer,
      tags: r.tags,
      signalType: r.signalType as SignalType,
      confidence: r.confidence as unknown as IdeaBlock['confidence'],
      dataClass: r.dataClass as DataClass,
      embedding: null,
      status: r.status as IdeaBlockStatus,
      mergedIntoId: r.mergedIntoId,
      evidenceCount: r.evidenceCount,
      dynamicScore: r.dynamicScore as unknown as IdeaBlock['dynamicScore'],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    } as unknown as IdeaBlock;
  }
}
