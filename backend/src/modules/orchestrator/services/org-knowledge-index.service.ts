import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * SBA δ-1 — OrgKnowledgeIndexService.
 *
 * Высокоуровневый индекс «что вообще есть в графе компании»:
 *   - entities counts по типам,
 *   - top topics (Theme),
 *   - recent activity (последние N IdeaBlock'ов).
 *
 * Используется subagent-ами как cheap lookup перед полным retrieval'ом
 * (даёт понимание «есть ли там вообще что-то про X, прежде чем ходить в
 * embeddings и graph»).
 *
 * Кэш — Redis, TTL 24h. Real-time пересчитывает только при cache miss.
 */
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_KEY_PREFIX = 'orch:orgKnowledgeIndex:';

export interface OrgKnowledgeSummary {
  tenantId: string;
  generatedAt: string;
  counts: {
    ideaBlocks: number;
    entities: number;
    themes: number;
    meetings: number;
    decisions: number;
    insights: number;
    processes: number;
    regulations: number;
  };
  topThemes: Array<{ id: string; name: string; blockCount: number }>;
  recentBlocks: Array<{ id: string; title: string; createdAt: string }>;
}

@Injectable()
export class OrgKnowledgeIndexService {
  private readonly logger = new Logger(OrgKnowledgeIndexService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Получить summary из cache или собрать на лету.
   */
  async getSummary(tenantId: string): Promise<OrgKnowledgeSummary> {
    const key = `${CACHE_KEY_PREFIX}${tenantId}`;
    try {
      const cached = await this.redis.client.get(key);
      if (cached) {
        try {
          return JSON.parse(cached) as OrgKnowledgeSummary;
        } catch {
          // poisoned — пересчитаем.
        }
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'redis.get для org-knowledge-index упал — пересчитываем',
      );
    }
    const summary = await this.rebuild(tenantId);
    try {
      await this.redis.client.set(
        key,
        JSON.stringify(summary),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'redis.set для org-knowledge-index упал — продолжаем без cache',
      );
    }
    return summary;
  }

  /**
   * Собрать summary с нуля (без cache). Используется cron'ом и при cache miss.
   */
  async rebuild(tenantId: string): Promise<OrgKnowledgeSummary> {
    const [
      ideaBlocks,
      entities,
      themes,
      meetings,
      decisions,
      insights,
      processes,
      regulations,
      topThemesRaw,
      recentBlocksRaw,
    ] = await Promise.all([
      this.prisma.ideaBlock.count({ where: { tenantId } }),
      this.prisma.entity.count({ where: { tenantId } }),
      this.prisma.theme.count({ where: { tenantId } }),
      this.prisma.meeting.count({ where: { tenantId } }),
      this.prisma.decision.count({ where: { tenantId } }),
      this.prisma.insight.count({ where: { tenantId } }),
      this.prisma.process.count({ where: { tenantId } }),
      this.prisma.regulation.count({ where: { tenantId } }),
      this.prisma.theme.findMany({
        where: { tenantId, status: 'active' },
        orderBy: { weight: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          _count: { select: { blocks: true } },
        },
      }),
      this.prisma.ideaBlock.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, name: true, createdAt: true },
      }),
    ]);

    return {
      tenantId,
      generatedAt: new Date().toISOString(),
      counts: {
        ideaBlocks,
        entities,
        themes,
        meetings,
        decisions,
        insights,
        processes,
        regulations,
      },
      topThemes: topThemesRaw.map((t) => ({
        id: t.id,
        name: t.name,
        blockCount: t._count.blocks,
      })),
      recentBlocks: recentBlocksRaw.map((b) => ({
        id: b.id,
        title: b.name,
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }
}
