import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type IdeaBlock,
  type IdeaBlockLinkType,
  type IdeaBlockStatus,
  type SignalType,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService, maxDataClass } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  BLOCK_LINK_CONFIRM_SYSTEM_PROMPT,
  parseBlockLinkConfirm,
} from '../prompts/block-link-confirm.prompt';
import {
  BLOCK_LINKER_JSON_SCHEMA,
  BLOCK_LINKER_SYSTEM_PROMPT,
  BlockLinkerResponseSchema,
} from '../prompts/block-linker.prompt';
import { signalTypeLabel } from '../prompts/signal-type-label';

const BLOCK_LINK_CONFIRM_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed', 'reason'],
  properties: {
    confirmed: { type: 'boolean' },
    reason: { type: 'string' },
  },
} as const;

export interface LinkVerdict {
  relationType: IdeaBlockLinkType | null;
  confidence: number;
  explanation: string;
  validFromHint?: string | null;
  validUntilHint?: string | null;
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

const LINK_JSON_SCHEMA = BLOCK_LINKER_JSON_SCHEMA;
const LinkResponseSchema = BlockLinkerResponseSchema;
const LINK_SYSTEM_PROMPT = BLOCK_LINKER_SYSTEM_PROMPT;

@Injectable()
export class BlockLinkService {
  private readonly logger = new Logger(BlockLinkService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

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

    const guardOn = this.isPromptInjectionGuardEnabled();

    const fromId = args.fromBlock.id;
    const toId = args.toBlock.id;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'block-linker',
          tenantId: args.tenantId,
          systemPrompt: guardOn ? withInjectionGuard(LINK_SYSTEM_PROMPT) : LINK_SYSTEM_PROMPT,
          userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
          responseFormat: {
            type: 'json_schema',
            name: 'BlockLinkerVerdict',
            strict: true,
            schema: LINK_JSON_SCHEMA,
          },
          sourceRef: { type: 'idea-block', id: args.fromBlock.id },
          dataClass: maxDataClass([args.fromBlock.dataClass, args.toBlock.dataClass]),
          validate: (text) => this.parseVerdict(text) !== null,
        });
        const parsed = this.parseVerdict(out.text);
        if (parsed) return parsed;
        this.metrics?.incKcBlockLinkerInvalidJson?.({ reason: 'parse' });
        this.logger.warn(
          { fromId, toId, attempt },
          'block-linker: invalid JSON LLM-арбитра — повтор',
        );
      } catch (err) {
        this.metrics?.incKcBlockLinkerInvalidJson?.({ reason: 'llm_error' });
        this.logger.warn(
          {
            fromId,
            toId,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'block-linker: LLM judge упал — повтор',
        );
      }
    }

    this.metrics?.incKcBlockLinkerFallbackNone({ reason: 'exhausted' });
    this.logger.warn({ fromId, toId }, 'block-linker: fallback на none после 2 попыток');
    return { relationType: null, confidence: 0, explanation: 'invalid LLM judge JSON' };
  }

  async confirmRiskLink(args: {
    tenantId: string;
    fromBlock: IdeaBlock;
    toBlock: IdeaBlock;
    relationType: IdeaBlockLinkType;
  }): Promise<boolean> {
    const userPayload = {
      relationType: args.relationType,
      blockA: this.summariseBlock(args.fromBlock),
      blockB: this.summariseBlock(args.toBlock),
    };
    const userMessage = `Предполагаемая связь блока A → блока B: ${args.relationType}. Опровергни или подтверди строго по содержанию.\n\n${JSON.stringify(userPayload, null, 2)}`;
    const guardOn = this.isPromptInjectionGuardEnabled();
    try {
      const out = await this.llm.call({
        taskType: 'block-link-confirm',
        tenantId: args.tenantId,
        systemPrompt: guardOn
          ? withInjectionGuard(BLOCK_LINK_CONFIRM_SYSTEM_PROMPT)
          : BLOCK_LINK_CONFIRM_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'BlockLinkConfirm',
          strict: true,
          schema: BLOCK_LINK_CONFIRM_JSON_SCHEMA,
        },
        sourceRef: { type: 'idea-block', id: args.fromBlock.id },
        dataClass: maxDataClass([args.fromBlock.dataClass, args.toBlock.dataClass]),
        validate: (text) => parseBlockLinkConfirm(tryParseJson(text)) !== null,
      });
      return parseBlockLinkConfirm(tryParseJson(out.text))?.confirmed === true;
    } catch (err) {
      this.logger.warn(
        {
          fromId: args.fromBlock.id,
          toId: args.toBlock.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-link-confirm: скептик упал — fail-closed (риск-ребро отвергнуто)',
      );
      return false;
    }
  }

  private parseVerdict(text: string): LinkVerdict | null {
    const raw = tryParseJson(text);
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
      validFromHint: parsed.data.validFrom ?? null,
      validUntilHint: parsed.data.validUntil ?? null,
    };
  }

  private summariseBlock(b: IdeaBlock): Record<string, unknown> {
    return {
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      // Методология промптов №3 — человеческий ярлык сигнала, не машинный код.
      signalType: signalTypeLabel(b.signalType),
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
