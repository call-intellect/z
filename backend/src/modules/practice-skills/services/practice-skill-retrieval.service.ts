import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PracticeSkill } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { buildVectorLiteral } from '../../embeddings/services/vector-literal.util';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';

@Injectable()
export class PracticeSkillRetrievalService {
  private readonly logger = new Logger(PracticeSkillRetrievalService.name);

  private static readonly DEFAULT_TOP_K = 3;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async retrieveForCloneRespond(args: {
    tenantId: string;
    scope: 'person' | 'role' | 'org';
    scopeRefId: string;
    question: string;
    conversationId: string | null;
    topK?: number;
  }): Promise<PracticeSkill[]> {
    if (!this.cfg.practiceSkills.enabled) return [];
    const trimmed = args.question.trim();
    if (trimmed.length === 0) return [];

    let queryVec: number[] | null;
    try {
      queryVec = await this.embedder.embedQuery(trimmed);
    } catch (err) {
      this.logger.debug(
        `practice-skills.retrieval: embedQuery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    if (!queryVec) return [];

    // Класс G2 — guard pgvector-литерала query-вектора. При reject (смена модели
    // → другая размерность; битый вектор → NaN/Infinity) деградируем на [] (как
    // при embed-failure выше), не валя оператор `<=>`.
    const expectedDim = this.cfg.ai?.embeddings?.dimensions ?? 768;
    const guard = buildVectorLiteral(queryVec, expectedDim);
    if (guard.literal === null) {
      this.logger.debug(
        `practice-skills.retrieval: query-вектор отвергнут guard-ом (${guard.rejectReason}, actualDim=${queryVec.length}, expectedDim=${expectedDim}) — []`,
      );
      return [];
    }
    const vecLiteral = guard.literal;

    const topK = args.topK ?? PracticeSkillRetrievalService.DEFAULT_TOP_K;
    const limit = Math.max(topK * 4, 8);
    const minDistance = 1 - this.cfg.practiceSkills.knnRetrievalThreshold;

    let candidateIds: string[];
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; dist: number }>>(
        `SELECT id, ("triggerEmbedding" <=> $1::vector) AS dist
           FROM "practice_skills"
          WHERE "triggerEmbedding" IS NOT NULL
            AND "tenantId" = $2
            AND "scope"::text = $3
            AND "scopeRefId" = $4
            AND "status"::text NOT IN ('archived', 'deprecated')
            AND ("triggerEmbedding" <=> $1::vector) <= $5
          ORDER BY dist ASC
          LIMIT ${limit}`,
        vecLiteral,
        args.tenantId,
        args.scope,
        args.scopeRefId,
        minDistance,
      );
      candidateIds = rows.map((r) => r.id);
    } catch (err) {
      this.logger.debug(
        `practice-skills.retrieval: KNN query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    if (candidateIds.length === 0) return [];

    const candidates = await this.prisma.practiceSkill.findMany({
      where: { id: { in: candidateIds } },
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const ordered = candidateIds
      .map((id) => byId.get(id))
      .filter((s): s is PracticeSkill => Boolean(s));

    const conversationKey = args.conversationId ?? 'no_conversation';
    const sampled = ordered.filter((skill) => {
      if (skill.status === 'active') return true;
      if (skill.status === 'shadow') {
        return this.deterministicShouldInclude(conversationKey, skill.id, skill.trafficShare);
      }
      return false;
    });

    sampled.sort((a, b) => {
      if (a.pinned === b.pinned) return 0;
      return a.pinned ? -1 : 1;
    });

    const result = sampled.slice(0, topK);
    if (result.length > 0) {
      try {
        this.metrics.incPracticeSkillsRetrievalHit({ scope: args.scope });
      } catch {}
    }
    return result;
  }

  async recordUsages(args: {
    tenantId: string;
    conversationId: string;
    messageId: string;
    skills: ReadonlyArray<{ id: string; status: string }>;
  }): Promise<void> {
    if (args.skills.length === 0) return;
    try {
      await this.prisma.skillUsage.createMany({
        data: args.skills.map((s) => ({
          tenantId: args.tenantId,
          practiceSkillId: s.id,
          conversationId: args.conversationId,
          messageId: args.messageId,
          wasUsed: true,
          outcome: 'pending',
        })),
        skipDuplicates: true,
      });
      const now = new Date();
      await this.prisma.practiceSkill.updateMany({
        where: { id: { in: args.skills.map((s) => s.id) } },
        data: { lastUsed: now },
      });
      for (const s of args.skills) {
        const statusLabel = s.status === 'active' ? 'active' : 'shadow';
        try {
          this.metrics.incPracticeSkillsRun({ status: statusLabel });
        } catch {}
      }
    } catch (err) {
      this.logger.warn(
        `practice-skills.recordUsages: failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private deterministicShouldInclude(
    conversationKey: string,
    skillId: string,
    trafficShare: number,
  ): boolean {
    if (trafficShare <= 0) return false;
    if (trafficShare >= 1) return true;
    const h = createHash('sha256').update(`${conversationKey}:${skillId}`).digest();
    const u32 = h.readUInt32BE(0);
    const norm = u32 / 0x1_0000_0000;
    return norm < trafficShare;
  }
}
