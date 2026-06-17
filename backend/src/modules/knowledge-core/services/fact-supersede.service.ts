import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { IdeaBlock, SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { ConflictService } from '../../curation/services/conflict.service';
import {
  FACT_SUPERSEDE_DETECT_JSON_SCHEMA,
  FACT_SUPERSEDE_DETECT_SCHEMA_NAME,
  FACT_SUPERSEDE_DETECT_SYSTEM_PROMPT,
  FACT_SUPERSEDE_DETECT_USER_TEMPLATE,
  type FactSupersedeDetectCandidate,
  type FactSupersedeDetectResponse,
  type FactSupersedeVerdict,
} from '../prompts/fact-supersede-detect.prompt';

@Injectable()
export class FactSupersedeService {
  private readonly logger = new Logger(FactSupersedeService.name);

  private static readonly LOCK_TTL_SECONDS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  async processNewBlock(blockId: string): Promise<{
    verdict:
      | FactSupersedeVerdict
      | 'skip_no_candidates'
      | 'skip_not_fact_signal'
      | 'skip_race_lost'
      | 'skip_llm_error';
    targetId?: string;
    applied: boolean;
  }> {
    const startedAt = Date.now();
    try {
      return await this.processNewBlockInternal(blockId);
    } finally {
      this.metrics.observeKcFactSupersedeLatencyMs(Date.now() - startedAt);
    }
  }

  private async processNewBlockInternal(blockId: string): Promise<{
    verdict:
      | FactSupersedeVerdict
      | 'skip_no_candidates'
      | 'skip_not_fact_signal'
      | 'skip_race_lost'
      | 'skip_llm_error';
    targetId?: string;
    applied: boolean;
  }> {
    const factSignalTypes = this.cfg?.bitemporal.factSignalTypes ?? [];
    const cosineThreshold = this.cfg?.bitemporal.factSupersedeCosineThreshold ?? 0.85;
    const topK = this.cfg?.bitemporal.factSupersedeKnnTopK ?? 5;

    const block = await this.prisma.ideaBlock.findUnique({
      where: { id: blockId },
      include: {
        evidence: { take: 1, orderBy: { sourceTimestamp: 'asc' } },
      },
    });
    if (!block) {
      this.logger.debug({ blockId }, 'fact-supersede: блок не найден — skip');
      return { verdict: 'skip_no_candidates', applied: false };
    }
    if (block.validUntil !== null || block.supersededById !== null) {
      this.logger.debug({ blockId }, 'fact-supersede: блок уже закрыт — skip');
      return { verdict: 'skip_no_candidates', applied: false };
    }
    if (!factSignalTypes.includes(block.signalType)) {
      this.metrics.incKcFactSupersedeVerdict({ verdict: 'skip_not_fact_signal' });
      return { verdict: 'skip_not_fact_signal', applied: false };
    }

    const lockKey = `fact-supersede:${blockId}`;
    const lockClaimed = await this.tryAcquireLock(lockKey);
    if (!lockClaimed) {
      this.metrics.incKcFactSupersedeVerdict({ verdict: 'skip_race_lost' });
      this.logger.debug({ blockId }, 'fact-supersede: lock уже занят другим воркером — skip');
      return { verdict: 'skip_race_lost', applied: false };
    }

    try {
      const candidates = await this.knnCandidates({
        tenantId: block.tenantId,
        blockId: block.id,
        signalType: block.signalType,
        topK,
        threshold: cosineThreshold,
      });
      if (candidates.length === 0) {
        this.metrics.incKcFactSupersedeVerdict({ verdict: 'skip_no_candidates' });
        return { verdict: 'skip_no_candidates', applied: false };
      }

      let verdict: FactSupersedeDetectResponse;
      try {
        verdict = await this.callLlm({
          tenantId: block.tenantId,
          newBlock: block,
          candidates,
        });
      } catch (err) {
        this.metrics.incKcFactSupersedeVerdict({ verdict: 'skip_llm_error' });
        this.logger.warn(
          {
            blockId,
            err: err instanceof Error ? err.message : String(err),
          },
          'fact-supersede: LLM упал — skip',
        );
        return { verdict: 'skip_llm_error', applied: false };
      }

      this.metrics.incKcFactSupersedeVerdict({ verdict: verdict.verdict });

      const targetBlockId = verdict.targetBlockId ?? undefined;
      if (
        verdict.verdict !== 'unrelated' &&
        targetBlockId &&
        !candidates.some((c) => c.id === targetBlockId)
      ) {
        this.logger.warn(
          {
            blockId,
            targetBlockId,
            candidates: candidates.map((c) => c.id),
          },
          'fact-supersede: LLM указал id не из candidates — игнорируем',
        );
        return { verdict: 'unrelated', applied: false };
      }

      if (verdict.verdict === 'unrelated' || verdict.verdict === 'extends') {
        return {
          verdict: verdict.verdict,
          targetId: targetBlockId,
          applied: false,
        };
      }

      if (!targetBlockId) {
        this.logger.warn(
          { blockId, verdict: verdict.verdict },
          'fact-supersede: verdict требует targetBlockId, но он null — skip',
        );
        return { verdict: verdict.verdict, applied: false };
      }

      if (verdict.verdict === 'contradicts') {
        await this.applyContradicts({
          tenantId: block.tenantId,
          newBlockId: block.id,
          targetBlockId,
          confidence: verdict.confidence,
          reason: verdict.reason,
        });
        return {
          verdict: 'contradicts',
          targetId: targetBlockId,
          applied: true,
        };
      }

      const applied = await this.applySupersedes({
        tenantId: block.tenantId,
        newBlockId: block.id,
        targetBlockId,
        confidence: verdict.confidence,
        reason: verdict.reason,
      });
      return {
        verdict: 'supersedes',
        targetId: targetBlockId,
        applied,
      };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  private async knnCandidates(args: {
    tenantId: string;
    blockId: string;
    signalType: SignalType;
    topK: number;
    threshold: number;
  }): Promise<FactSupersedeDetectCandidate[]> {
    interface Row {
      id: string;
      name: string;
      criticalQuestion: string;
      trustedAnswer: string;
      signalType: string;
      validFrom: Date | null;
      similarity: string | number;
    }
    const rows = await this.prisma.$queryRawUnsafe<Row[]>(
      `
      SELECT b.id, b.name, b."criticalQuestion", b."trustedAnswer",
             b."signalType", b."validFrom",
             1 - (b.embedding <=> (
               SELECT embedding FROM "IdeaBlock" WHERE id = $2
             )::vector(1536)) AS similarity
      FROM "IdeaBlock" b
      WHERE b."tenantId" = $1
        AND b."signalType"::text = $3
        AND b.id <> $2
        AND b.embedding IS NOT NULL
        AND b."validUntil" IS NULL
        AND b."mergedIntoId" IS NULL
      ORDER BY b.embedding <=> (
        SELECT embedding FROM "IdeaBlock" WHERE id = $2
      )::vector(1536)
      LIMIT $4
      `,
      args.tenantId,
      args.blockId,
      args.signalType,
      args.topK,
    );
    const out: FactSupersedeDetectCandidate[] = [];
    for (const r of rows) {
      const sim = typeof r.similarity === 'string' ? Number(r.similarity) : r.similarity;
      if (!Number.isFinite(sim)) continue;
      if (sim < args.threshold) continue;
      out.push({
        id: r.id,
        name: r.name,
        criticalQuestion: r.criticalQuestion,
        trustedAnswer: r.trustedAnswer,
        signalType: r.signalType,
        validFrom: r.validFrom ? r.validFrom.toISOString() : null,
        evidenceQuote: null,
      });
    }
    return out;
  }

  private async callLlm(args: {
    tenantId: string;
    newBlock: IdeaBlock & { evidence?: { quote: string }[] };
    candidates: FactSupersedeDetectCandidate[];
  }): Promise<FactSupersedeDetectResponse> {
    const guardOn = this.isPromptInjectionGuardEnabled();
    const evidenceQuote =
      args.newBlock.evidence && args.newBlock.evidence[0] ? args.newBlock.evidence[0].quote : null;
    const userPrompt = FACT_SUPERSEDE_DETECT_USER_TEMPLATE({
      newBlock: {
        id: args.newBlock.id,
        name: args.newBlock.name,
        criticalQuestion: args.newBlock.criticalQuestion,
        trustedAnswer: args.newBlock.trustedAnswer,
        signalType: args.newBlock.signalType,
        validFrom: args.newBlock.validFrom ? args.newBlock.validFrom.toISOString() : null,
        evidenceQuote,
      },
      candidates: args.candidates,
    });

    const result = await this.llm.call({
      taskType: 'fact-supersede-detect',
      tenantId: args.tenantId,
      systemPrompt: guardOn
        ? withInjectionGuard(FACT_SUPERSEDE_DETECT_SYSTEM_PROMPT)
        : FACT_SUPERSEDE_DETECT_SYSTEM_PROMPT,
      userMessage: guardOn ? wrapUserData(userPrompt) : userPrompt,
      responseFormat: {
        type: 'json_schema',
        name: FACT_SUPERSEDE_DETECT_SCHEMA_NAME,
        schema: FACT_SUPERSEDE_DETECT_JSON_SCHEMA,
        strict: true,
      },
      sourceRef: { type: 'idea_block', id: args.newBlock.id },
      dataClass: args.newBlock.dataClass,
    });

    const parsed = JSON.parse(result.text) as Partial<FactSupersedeDetectResponse>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.verdict === undefined ||
      !['unrelated', 'extends', 'contradicts', 'supersedes'].includes(parsed.verdict as string) ||
      typeof parsed.reason !== 'string' ||
      typeof parsed.confidence !== 'number'
    ) {
      throw new Error('fact-supersede-detect: невалидный JSON-ответ LLM');
    }
    return {
      verdict: parsed.verdict as FactSupersedeVerdict,
      targetBlockId: typeof parsed.targetBlockId === 'string' ? parsed.targetBlockId : null,
      reason: parsed.reason,
      confidence: parsed.confidence,
    };
  }

  private async applyContradicts(args: {
    tenantId: string;
    newBlockId: string;
    targetBlockId: string;
    confidence: number;
    reason: string;
  }): Promise<void> {
    try {
      await this.prisma.ideaBlockLink.upsert({
        where: {
          fromBlockId_toBlockId_relationType: {
            fromBlockId: args.newBlockId,
            toBlockId: args.targetBlockId,
            relationType: 'contradicts',
          },
        },
        update: {
          status: 'active',
          confidence: this.clampConfidence(args.confidence),
          explanation: args.reason.slice(0, 2_000),
          deletedAt: null,
          deletedBy: null,
        },
        create: {
          tenantId: args.tenantId,
          fromBlockId: args.newBlockId,
          toBlockId: args.targetBlockId,
          relationType: 'contradicts',
          confidence: this.clampConfidence(args.confidence),
          explanation: args.reason.slice(0, 2_000),
          createdBy: 'linker',
          status: 'active',
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          newBlockId: args.newBlockId,
          targetBlockId: args.targetBlockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'fact-supersede.applyContradicts: upsert link упал — продолжаем',
      );
    }
  }

  private async applySupersedes(args: {
    tenantId: string;
    newBlockId: string;
    targetBlockId: string;
    confidence: number;
    reason: string;
  }): Promise<boolean> {
    const now = new Date();
    let applied = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.ideaBlock.updateMany({
          where: {
            id: args.targetBlockId,
            tenantId: args.tenantId,
            validUntil: null,
          },
          data: {
            validUntil: now,
            supersededAt: now,
            supersededById: args.newBlockId,
          },
        });
        if (updated.count === 0) {
          return;
        }

        await tx.ideaBlockLink.upsert({
          where: {
            fromBlockId_toBlockId_relationType: {
              fromBlockId: args.newBlockId,
              toBlockId: args.targetBlockId,
              relationType: 'supersedes',
            },
          },
          update: {
            status: 'active',
            confidence: this.clampConfidence(args.confidence),
            explanation: args.reason.slice(0, 2_000),
            deletedAt: null,
            deletedBy: null,
          },
          create: {
            tenantId: args.tenantId,
            fromBlockId: args.newBlockId,
            toBlockId: args.targetBlockId,
            relationType: 'supersedes',
            confidence: this.clampConfidence(args.confidence),
            explanation: args.reason.slice(0, 2_000),
            createdBy: 'linker',
            status: 'active',
          },
        });
        applied = true;
      });

      if (!applied) {
        this.logger.debug(
          {
            newBlockId: args.newBlockId,
            targetBlockId: args.targetBlockId,
          },
          'fact-supersede.applySupersedes: target уже закрыт другим процессом — skip',
        );
        return false;
      }

      await this.reportEvolvingConflict({
        tenantId: args.tenantId,
        existingId: args.targetBlockId,
        newId: args.newBlockId,
        reason: args.reason,
        validUntil: now,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        {
          newBlockId: args.newBlockId,
          targetBlockId: args.targetBlockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'fact-supersede.applySupersedes: транзакция упала — skip',
      );
      return false;
    }
  }

  private async reportEvolvingConflict(args: {
    tenantId: string;
    existingId: string;
    newId: string;
    reason: string;
    validUntil: Date;
  }): Promise<void> {
    try {
      await this.conflicts.report({
        tenantId: args.tenantId,
        resourceType: 'idea_block',
        existingId: args.existingId,
        newId: args.newId,
        relationType: 'supersedes',
        detectedBy: 'specialist',
        evidence: {
          source: 'fact-supersede-detect',
          reason: args.reason.slice(0, 1_500),
          suggestedResolution: 'evolving',
          evolvingMeta: {
            existingValidUntil: args.validUntil.toISOString(),
            newValidFrom: args.validUntil.toISOString(),
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          existingId: args.existingId,
          newId: args.newId,
          err: err instanceof Error ? err.message : String(err),
        },
        'fact-supersede.reportEvolvingConflict: ConflictService упал — продолжаем',
      );
    }
  }

  private async tryAcquireLock(lockKey: string): Promise<boolean> {
    try {
      const r = await this.redis.client.set(
        lockKey,
        '1',
        'EX',
        FactSupersedeService.LOCK_TTL_SECONDS,
        'NX',
      );
      return r === 'OK';
    } catch (err) {
      this.logger.debug(
        {
          lockKey,
          err: err instanceof Error ? err.message : String(err),
        },
        'fact-supersede.tryAcquireLock: Redis недоступен — fail-open',
      );
      return true;
    }
  }

  private async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.redis.client.del(lockKey);
    } catch {}
  }

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  private clampConfidence(v: number): string {
    if (!Number.isFinite(v)) return '0.500';
    if (v < 0) return '0.000';
    if (v > 1) return '1.000';
    return v.toFixed(3);
  }
}
