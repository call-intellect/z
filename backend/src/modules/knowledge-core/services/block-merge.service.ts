import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type IdeaBlock,
  type IdeaBlockStatus,
  type SignalType,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService, maxDataClass } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  BLOCK_DISTILL_JSON_SCHEMA,
  BLOCK_DISTILL_SYSTEM_PROMPT,
  BlockDistillJudgeResponseSchema,
} from '../prompts/block-distill.prompt';

export interface MergeCandidate {
  candidate: IdeaBlock;
  similarity: number;
}

export type MergeVerdict =
  | { verdict: 'merge'; canonicalId: string; explanation: string }
  | { verdict: 'distinct'; explanation: string };

interface RawCandidateRow {
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
  primarySource: string | null;
  createdAt: Date;
  updatedAt: Date;
  similarity: string | number;
}

const JudgeResponseSchema = BlockDistillJudgeResponseSchema;
const JUDGE_JSON_SCHEMA = BLOCK_DISTILL_JSON_SCHEMA;
const JUDGE_SYSTEM_PROMPT = BLOCK_DISTILL_SYSTEM_PROMPT;

@Injectable()
export class BlockMergeService {
  private readonly logger = new Logger(BlockMergeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async knnCandidates(args: {
    tenantId: string;
    blockId: string;
    topK: number;
    threshold: number;
  }): Promise<MergeCandidate[]> {
    const rows = await this.prisma.$queryRawUnsafe<RawCandidateRow[]>(
      `
      SELECT b.id, b."tenantId", b.name, b."criticalQuestion", b."trustedAnswer",
             b.tags, b."signalType", b.confidence, b."dataClass", b.status,
             b."mergedIntoId", b."evidenceCount", b."dynamicScore",
             b."primarySource",
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
    const result: MergeCandidate[] = [];
    for (const r of rows) {
      const sim = typeof r.similarity === 'string' ? Number(r.similarity) : r.similarity;
      if (!Number.isFinite(sim)) continue;
      if (sim <= args.threshold) continue;
      result.push({
        candidate: this.rowToIdeaBlock(r),
        similarity: sim,
      });
    }
    return result;
  }

  async judgeMerge(args: {
    tenantId: string;
    blockId: string;
    newBlock: IdeaBlock;
    candidates: IdeaBlock[];
  }): Promise<MergeVerdict> {
    if (args.candidates.length === 0) {
      return { verdict: 'distinct', explanation: 'Нет кандидатов выше порога' };
    }

    const userPayload = {
      newBlock: this.summariseBlock(args.newBlock),
      candidates: args.candidates.map((c) => this.summariseBlock(c)),
    };
    const userMessage = `Новый блок и кандидаты ниже. Реши verdict.\n\n${JSON.stringify(userPayload, null, 2)}`;

    const guardOn = this.isPromptInjectionGuardEnabled();
    try {
      const out = await this.llm.call({
        taskType: 'block-distill',
        tenantId: args.tenantId,
        systemPrompt: guardOn ? withInjectionGuard(JUDGE_SYSTEM_PROMPT) : JUDGE_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'BlockDistillVerdict',
          strict: true,
          schema: JUDGE_JSON_SCHEMA,
        },
        sourceRef: { type: 'idea-block', id: args.blockId },
        dataClass: maxDataClass([
          args.newBlock.dataClass,
          ...args.candidates.map((c) => c.dataClass),
        ]),
      });
      const parsed = this.parseVerdict(out.text, args.candidates);
      if (parsed) return parsed;
      this.logger.warn(
        { blockId: args.blockId },
        'block-distill: invalid judge JSON — fallback на distinct',
      );
      return {
        verdict: 'distinct',
        explanation: 'invalid LLM judge JSON',
      };
    } catch (err) {
      this.logger.warn(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-distill: LLM judge упал — fallback на distinct',
      );
      return {
        verdict: 'distinct',
        explanation: 'LLM judge call failed',
      };
    }
  }

  private parseVerdict(text: string, candidates: IdeaBlock[]): MergeVerdict | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = JudgeResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.verdict === 'distinct') {
      return { verdict: 'distinct', explanation: parsed.data.explanation };
    }
    const canonicalId = parsed.data.canonicalId;
    if (!canonicalId) return null;
    if (!candidates.some((c) => c.id === canonicalId)) {
      this.logger.warn(
        { canonicalId, candidateIds: candidates.map((c) => c.id) },
        'block-distill: LLM выбрал id не из списка — трактуем как distinct',
      );
      return null;
    }
    return {
      verdict: 'merge',
      canonicalId,
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
      primarySource: b.primarySource ?? 'transcript',
    };
  }

  private rowToIdeaBlock(r: RawCandidateRow): IdeaBlock {
    return {
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      criticalQuestion: r.criticalQuestion,
      trustedAnswer: r.trustedAnswer,
      tags: r.tags,
      signalType: r.signalType as SignalType,
      confidence: this.toDecimal(r.confidence),
      dataClass: r.dataClass as DataClass,
      embedding: null,
      status: r.status as IdeaBlockStatus,
      mergedIntoId: r.mergedIntoId,
      evidenceCount: r.evidenceCount,
      dynamicScore: this.toDecimal(r.dynamicScore),
      primarySource: r.primarySource,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    } as unknown as IdeaBlock;
  }

  private toDecimal(v: string | number): unknown {
    return typeof v === 'string' ? v : v;
  }
}
