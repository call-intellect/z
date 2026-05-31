import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  SprintArchiveItemDto,
  SprintArchiveListDto,
  SprintArchivePeriod,
  SprintArchiveStatus,
  SprintArchiveSummaryDto,
} from '../dto/sprints/sprint-archive.dto';

/**
 * Pulse Wave 5 §5.3 (2026-05-30) — Архив гипотез.
 *
 * Источник правды: model Cycle. Возвращает хронику Cycle tenant'а с
 * фильтрами по period (month / quarter / year), status и поиску по
 * `description`.
 *
 * `confirmedHypothesis`:
 *   - status='completed' + ≥80% SprintHint resolved → true;
 *   - status='completed' + < 80% resolved → false;
 *   - 'in_progress' / 'cancelled' → null.
 *
 * Поиск по query — простой ILIKE по `description` (без embedding на MVP).
 */
@Injectable()
export class SprintArchiveService {
  private readonly logger = new Logger(SprintArchiveService.name);
  private static readonly MAX_ITEMS = 200;
  private static readonly CONFIRMED_THRESHOLD = 0.8;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getArchive(args: {
    tenantId: string;
    period: SprintArchivePeriod;
    statusFilter?: SprintArchiveStatus | 'all';
    query?: string;
  }): Promise<SprintArchiveListDto> {
    const startDate = this.computePeriodStart(args.period);

    const where: Prisma.CycleWhereInput = {
      tenantId: args.tenantId,
      OR: [
        { startDate: { gte: startDate } },
        { endDate: { gte: startDate } },
        { completedAt: { gte: startDate } },
      ],
    };

    if (args.query && args.query.trim().length > 0) {
      const q = args.query.trim();
      where.AND = [
        {
          OR: [
            { description: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const cycles = await this.prisma.cycle.findMany({
      where,
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: SprintArchiveService.MAX_ITEMS,
      select: {
        id: true,
        name: true,
        projectId: true,
        description: true,
        startDate: true,
        endDate: true,
        completedAt: true,
        project: { select: { name: true } },
        _count: { select: { issues: true } },
      },
    });

    if (cycles.length === 0) {
      return {
        items: [],
        summary: { total: 0, confirmed: 0, rejected: 0, inProgress: 0 },
        period: args.period,
      };
    }

    const cycleIds = cycles.map((c) => c.id);

    // ── Кол-во completed Issue per cycle (для outcome) ──
    const closedIssueRows = await this.prisma.issue.groupBy({
      by: ['cycleId'],
      where: {
        cycleId: { in: cycleIds },
        tenantId: args.tenantId,
        deletedAt: null,
        completedAt: { not: null },
      },
      _count: { _all: true },
    });
    const closedByCycle = new Map<string, number>();
    for (const r of closedIssueRows) {
      if (r.cycleId) closedByCycle.set(r.cycleId, r._count._all);
    }

    // ── Hint-резюме per cycle (для confirmedHypothesis + learningSummary) ──
    const hintRows = await this.prisma.sprintHint.findMany({
      where: {
        cycleId: { in: cycleIds },
        tenantId: args.tenantId,
      },
      select: { cycleId: true, status: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const hintsByCycle = new Map<
      string,
      { total: number; resolved: number; lastTitle: string | null }
    >();
    for (const h of hintRows) {
      const slot = hintsByCycle.get(h.cycleId) ?? {
        total: 0,
        resolved: 0,
        lastTitle: null,
      };
      slot.total++;
      if (h.status === 'resolved') slot.resolved++;
      if (slot.lastTitle === null) slot.lastTitle = h.title;
      hintsByCycle.set(h.cycleId, slot);
    }

    const items: SprintArchiveItemDto[] = cycles.map((c) => {
      const issuesClosed = closedByCycle.get(c.id) ?? 0;
      const issuesTotal = c._count.issues;
      const status: SprintArchiveStatus = c.completedAt
        ? 'completed'
        : c.endDate < new Date() && !c.completedAt
          ? 'cancelled'
          : 'in_progress';

      let confirmedHypothesis: boolean | null = null;
      const hintInfo = hintsByCycle.get(c.id);
      if (status === 'completed') {
        if (!hintInfo || hintInfo.total === 0) {
          confirmedHypothesis = null;
        } else {
          confirmedHypothesis =
            hintInfo.resolved / hintInfo.total >=
            SprintArchiveService.CONFIRMED_THRESHOLD;
        }
      }

      return {
        cycleId: c.id,
        name: c.name,
        projectId: c.projectId,
        projectName: c.project?.name ?? null,
        hypothesisText: this.extractHypothesisText(c.description),
        startDate: c.startDate.toISOString(),
        endDate: c.endDate.toISOString(),
        status,
        confirmedHypothesis,
        learningSummary: hintInfo?.lastTitle ?? null,
        issuesTotal,
        issuesClosed,
      };
    });

    const filtered =
      args.statusFilter && args.statusFilter !== 'all'
        ? items.filter((i) => {
            if (args.statusFilter === 'completed') {
              return i.status === 'completed';
            }
            if (args.statusFilter === 'in_progress') {
              return i.status === 'in_progress';
            }
            if (args.statusFilter === 'cancelled') {
              return i.status === 'cancelled';
            }
            return true;
          })
        : items;

    const summary: SprintArchiveSummaryDto = {
      total: filtered.length,
      confirmed: filtered.filter((i) => i.confirmedHypothesis === true).length,
      rejected: filtered.filter((i) => i.confirmedHypothesis === false).length,
      inProgress: filtered.filter((i) => i.status === 'in_progress').length,
    };

    return { items: filtered, summary, period: args.period };
  }

  private computePeriodStart(period: SprintArchivePeriod): Date {
    const now = new Date();
    const start = new Date(now);
    switch (period) {
      case 'month':
        start.setMonth(start.getMonth() - 1);
        return start;
      case 'quarter':
        start.setMonth(start.getMonth() - 3);
        return start;
      case 'year':
      default:
        start.setFullYear(start.getFullYear() - 1);
        return start;
    }
  }

  private extractHypothesisText(description: string | null): string | null {
    if (!description) return null;
    const trimmed = description.trim();
    if (trimmed.length === 0) return null;
    const firstParagraph = trimmed.split(/\n\n/)[0];
    return firstParagraph?.trim() ?? null;
  }
}
