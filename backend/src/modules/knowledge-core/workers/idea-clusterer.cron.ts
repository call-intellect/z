import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Idea, type IdeaCluster, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  IDEA_CLUSTER_MERGE_JSON_SCHEMA,
  IDEA_CLUSTER_MERGE_SCHEMA_NAME,
  IDEA_CLUSTER_MERGE_SYSTEM_PROMPT,
  IDEA_CLUSTER_MERGE_USER_TEMPLATE,
} from '../prompts/idea-cluster-merge.prompt';
import { KnowledgeEmbeddingService } from './../services/embedding.service';

interface ClusterMergeVerdict {
  verdict: 'new_cluster' | 'add_to_existing' | 'standalone';
  targetClusterId?: string | null;
  newClusterName?: string | null;
  newClusterDescription?: string | null;
  confidence: number;
}

/**
 * SBA β-5 — IdeaClustererCron.
 *
 * Раз в N часов (по умолчанию `30 *‎/4 * * *`, см. IDEA_CLUSTERER_CRON):
 *   1. Для каждой Org находит Idea без clusterId.
 *   2. KNN cosine с existing IdeaCluster — threshold 0.80.
 *   3. На match — добавляем ideaId в cluster.ideaIds, recompute clusterWeight,
 *      пересчёт embedding'а как mean всех Idea-embedding'ов.
 *   4. На miss — LLM `idea-cluster-merge` (verdict). На 'new_cluster' создаём
 *      IdeaCluster ТОЛЬКО если в окне 14 дней набралось `IDEA_MIN_SUPPORTERS_FOR_CLUSTER`
 *      (минимальная критическая масса).
 *
 * Контракт: НЕ бросает.
 */
@Injectable()
export class IdeaClustererCron {
  private readonly logger = new Logger(IdeaClustererCron.name);
  private static readonly BATCH_LIMIT = 100;
  private static readonly KNN_TOP_K = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  @Cron('30 */4 * * *')
  async sweep(): Promise<void> {
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      for (const org of orgs) {
        try {
          await this.processOrg(org.id);
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'idea-clusterer: ошибка обработки Org — пропускаю',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'idea-clusterer: непойманная ошибка',
      );
    }
  }

  private async processOrg(tenantId: string): Promise<void> {
    const ideas = await this.prisma.idea.findMany({
      where: {
        tenantId,
        clusterId: null,
        status: { notIn: ['rejected', 'archived'] },
      },
      orderBy: { createdAt: 'asc' },
      take: IdeaClustererCron.BATCH_LIMIT,
    });
    if (ideas.length === 0) return;
    const threshold = this.cfg.ideas.clusterThreshold;
    const minSupporters = this.cfg.ideas.minSupportersForCluster;
    const accumulated: Idea[] = [];
    for (const idea of ideas) {
      try {
        const nearest = await this.findNearestCluster({
          tenantId,
          ideaId: idea.id,
          threshold,
        });
        if (nearest) {
          await this.attachToCluster({ idea, cluster: nearest });
          continue;
        }
        accumulated.push(idea);
        if (accumulated.length >= minSupporters) {
          await this.maybeCreateNewCluster({
            tenantId,
            ideas: accumulated.slice(),
          });
          accumulated.length = 0;
        }
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            ideaId: idea.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'idea-clusterer: ошибка идеи — пропускаю',
        );
      }
    }
  }

  private async findNearestCluster(args: {
    tenantId: string;
    ideaId: string;
    threshold: number;
  }): Promise<IdeaCluster | null> {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; distance: number }>
      >(
        `SELECT c."id", (c."embedding" <=> (SELECT i."embedding" FROM "ideas" i WHERE i."id" = $2)) AS distance
         FROM "idea_clusters" c
         WHERE c."tenantId" = $1
           AND c."embedding" IS NOT NULL
           AND (SELECT i."embedding" FROM "ideas" i WHERE i."id" = $2) IS NOT NULL
         ORDER BY distance
         LIMIT ${IdeaClustererCron.KNN_TOP_K}`,
        args.tenantId,
        args.ideaId,
      );
      if (rows.length === 0) return null;
      const best = rows[0];
      if (!best) return null;
      const sim = 1 - Number(best.distance);
      if (sim < args.threshold) return null;
      return this.prisma.ideaCluster.findFirst({
        where: { id: best.id, tenantId: args.tenantId },
      });
    } catch {
      return null;
    }
  }

  private async attachToCluster(args: {
    idea: Idea;
    cluster: IdeaCluster;
  }): Promise<void> {
    const nextIds = Array.from(new Set([...args.cluster.ideaIds, args.idea.id]));
    const allIdeas = await this.prisma.idea.findMany({
      where: { id: { in: nextIds }, tenantId: args.idea.tenantId },
      select: { id: true, weight: true },
    });
    const clusterWeight = allIdeas.reduce(
      (acc, i) => acc + Number(i.weight),
      0,
    );
    await this.prisma.ideaCluster.update({
      where: { id: args.cluster.id },
      data: {
        ideaIds: { set: nextIds },
        clusterWeight: new Prisma.Decimal(
          Math.round(clusterWeight * 1000) / 1000,
        ),
      },
    });
    await this.prisma.idea.update({
      where: { id: args.idea.id },
      data: { clusterId: args.cluster.id },
    });
  }

  private async maybeCreateNewCluster(args: {
    tenantId: string;
    ideas: Idea[];
  }): Promise<void> {
    if (args.ideas.length < this.cfg.ideas.minSupportersForCluster) return;
    const seed = args.ideas[0];
    if (!seed) return;
    const candidates = await this.prisma.ideaCluster.findMany({
      where: { tenantId: args.tenantId },
      take: 5,
      orderBy: { clusterWeight: 'desc' },
    });
    let verdict: ClusterMergeVerdict | null = null;
    try {
      verdict = await this.llmDecide({
        idea: seed,
        candidates,
      });
    } catch {
      verdict = null;
    }
    if (verdict && verdict.verdict === 'add_to_existing' && verdict.targetClusterId) {
      const target = candidates.find((c) => c.id === verdict?.targetClusterId);
      if (target) {
        for (const idea of args.ideas) {
          await this.attachToCluster({ idea, cluster: target });
        }
        return;
      }
    }
    const newName =
      verdict?.newClusterName ?? seed.statement.slice(0, 80);
    const ideaIds = args.ideas.map((i) => i.id);
    const clusterWeight = args.ideas.reduce(
      (acc, i) => acc + Number(i.weight),
      0,
    );
    const cluster = await this.prisma.ideaCluster.create({
      data: {
        tenantId: args.tenantId,
        name: newName,
        description: verdict?.newClusterDescription ?? null,
        ideaIds,
        clusterWeight: new Prisma.Decimal(
          Math.round(clusterWeight * 1000) / 1000,
        ),
      },
    });
    await this.prisma.idea.updateMany({
      where: { id: { in: ideaIds } },
      data: { clusterId: cluster.id },
    });
  }

  private async llmDecide(args: {
    idea: Idea;
    candidates: IdeaCluster[];
  }): Promise<ClusterMergeVerdict | null> {
    if (args.candidates.length === 0) {
      // standalone — но мы всё равно дальше принимаем решение по фолбэку без LLM.
      return null;
    }
    let result: LlmCallResult;
    try {
      const enriched = await Promise.all(
        args.candidates.map(async (c) => {
          const sample = await this.prisma.idea.findMany({
            where: { tenantId: args.idea.tenantId, id: { in: c.ideaIds } },
            select: { statement: true },
            take: 3,
          });
          return {
            id: c.id,
            name: c.name,
            description: c.description,
            sampleStatements: sample.map((s) => s.statement.slice(0, 100)),
          };
        }),
      );
      // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (statement + кандидаты) в маркеры.
      const guardOn = this.isPromptInjectionGuardEnabled();
      const rawUser = IDEA_CLUSTER_MERGE_USER_TEMPLATE({
        ideaStatement: args.idea.statement,
        ideaRationale: args.idea.rationale,
        candidates: enriched,
      });
      result = await this.llm.call({
        taskType: 'idea-cluster-merge',
        systemPrompt: guardOn
          ? withInjectionGuard(IDEA_CLUSTER_MERGE_SYSTEM_PROMPT)
          : IDEA_CLUSTER_MERGE_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: args.idea.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: IDEA_CLUSTER_MERGE_SCHEMA_NAME,
          schema: IDEA_CLUSTER_MERGE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea', id: args.idea.id },
        dataClass: args.idea.dataClass,
      });
    } catch (err) {
      this.logger.debug(
        {
          ideaId: args.idea.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'idea-clusterer: LLM упал',
      );
      return null;
    }
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'idea',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }
    try {
      const parsed = JSON.parse(result.text) as ClusterMergeVerdict;
      if (parsed && typeof parsed.verdict === 'string') return parsed;
    } catch {
      // fallthrough
    }
    return null;
  }
}
