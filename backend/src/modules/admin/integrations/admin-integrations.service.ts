import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import type {
  SourceOverviewItem,
  SourceRunStats,
  SyncRunItem,
  SyncRunsQueryDto,
} from './dto/admin-integrations.dto';

const RUN_WINDOW_MS = 24 * 60 * 60 * 1000;

function emptyStats(): SourceRunStats {
  return { success: 0, failed: 0, running: 0, skipped: 0 };
}

@Injectable()
export class AdminIntegrationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getSourcesOverview(): Promise<SourceOverviewItem[]> {
    const [bitrix, chatbox] = await Promise.all([
      this.prisma.bitrixIntegration.findMany({
        where: { tenantId: { not: null } },
        select: {
          tenantId: true,
          portalDomain: true,
          status: true,
          lastError: true,
          analysisEnabled: true,
          lastFullSyncAt: true,
          lastIncrementalSyncAt: true,
        },
      }),
      this.prisma.chatboxIntegration.findMany({
        select: {
          tenantId: true,
          status: true,
          lastError: true,
          analysisEnabled: true,
          lastFullSyncAt: true,
          lastIncrementalSyncAt: true,
        },
      }),
    ]);

    const tenantIds = [
      ...new Set([
        ...bitrix.map((b) => b.tenantId).filter((t): t is string => t !== null),
        ...chatbox.map((c) => c.tenantId),
      ]),
    ];

    const since = new Date(Date.now() - RUN_WINDOW_MS);
    const [orgs, grouped] = await Promise.all([
      this.prisma.org.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      }),
      tenantIds.length > 0
        ? this.prisma.integrationSyncRun.groupBy({
            by: ['tenantId', 'provider', 'kind', 'status'],
            where: { tenantId: { in: tenantIds }, startedAt: { gte: since } },
            _count: { _all: true },
            _max: { startedAt: true },
          })
        : Promise.resolve([]),
    ]);

    const orgName = new Map(orgs.map((o) => [o.id, o.name] as const));

    const statsByKey = new Map<
      string,
      { sync: SourceRunStats; analyze: SourceRunStats; lastRunAt: Date | null }
    >();
    for (const g of grouped) {
      const key = `${g.tenantId}:${g.provider}`;
      const entry =
        statsByKey.get(key) ?? { sync: emptyStats(), analyze: emptyStats(), lastRunAt: null };
      const bucket = g.kind === 'analyze' ? entry.analyze : entry.sync;
      if (g.status === 'success' || g.status === 'failed' || g.status === 'running' || g.status === 'skipped') {
        bucket[g.status] += g._count._all;
      }
      const maxStarted = g._max.startedAt;
      if (maxStarted && (!entry.lastRunAt || maxStarted > entry.lastRunAt)) {
        entry.lastRunAt = maxStarted;
      }
      statsByKey.set(key, entry);
    }

    const items: SourceOverviewItem[] = [];

    for (const b of bitrix) {
      if (!b.tenantId) continue;
      const stats = statsByKey.get(`${b.tenantId}:bitrix`);
      items.push({
        tenantId: b.tenantId,
        orgName: orgName.get(b.tenantId) ?? null,
        provider: 'bitrix',
        status: b.status,
        portalDomain: b.portalDomain,
        analysisEnabled: b.analysisEnabled,
        lastError: b.lastError ?? null,
        lastFullSyncAt: b.lastFullSyncAt?.toISOString() ?? null,
        lastIncrementalSyncAt: b.lastIncrementalSyncAt?.toISOString() ?? null,
        lastRunAt: stats?.lastRunAt?.toISOString() ?? null,
        runs24h: { sync: stats?.sync ?? emptyStats(), analyze: stats?.analyze ?? emptyStats() },
      });
    }

    for (const c of chatbox) {
      const stats = statsByKey.get(`${c.tenantId}:chatbox`);
      items.push({
        tenantId: c.tenantId,
        orgName: orgName.get(c.tenantId) ?? null,
        provider: 'chatbox',
        status: c.status,
        portalDomain: null,
        analysisEnabled: c.analysisEnabled,
        lastError: c.lastError ?? null,
        lastFullSyncAt: c.lastFullSyncAt?.toISOString() ?? null,
        lastIncrementalSyncAt: c.lastIncrementalSyncAt?.toISOString() ?? null,
        lastRunAt: stats?.lastRunAt?.toISOString() ?? null,
        runs24h: { sync: stats?.sync ?? emptyStats(), analyze: stats?.analyze ?? emptyStats() },
      });
    }

    items.sort((a, b) => (a.orgName ?? '').localeCompare(b.orgName ?? ''));
    return items;
  }

  async listSyncRuns(
    q: SyncRunsQueryDto,
  ): Promise<{ items: SyncRunItem[]; nextCursor: string | null }> {
    const where: Prisma.IntegrationSyncRunWhereInput = {
      ...(q.provider ? { provider: q.provider } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
    };

    const rows = await this.prisma.integrationSyncRun.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        provider: r.provider,
        kind: r.kind,
        scope: r.scope ?? null,
        refId: r.refId ?? null,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        durationMs: r.durationMs ?? null,
        counts: r.counts ?? null,
        error: r.error ?? null,
      })),
      nextCursor,
    };
  }
}
