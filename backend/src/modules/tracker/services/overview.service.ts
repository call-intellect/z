import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  OverviewActivityItemDto,
  OverviewActiveCycleDto,
  OverviewLinkedGoalDto,
  OverviewMetricsDto,
  OverviewProjectDocumentMiniDto,
  OverviewProjectMiniDto,
  OverviewResponseDto,
  OverviewStateBucketDto,
  OverviewStateCategory,
  OverviewUserMiniDto,
} from '../dto/overview/overview-response.dto';

import { ProjectsService } from './projects.service';
import { TrackerEmitterService } from './tracker-emitter.service';

@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  static readonly CACHE_PREFIX = 'project:overview:';
  static readonly CACHE_TTL_SECONDS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
  ) {}

  async getOverview(args: { projectId: string; tenantId: string }): Promise<OverviewResponseDto> {
    await this.projects.requireProject(args.projectId, args.tenantId);

    const cached = await this.tryReadCache(args.projectId);
    if (cached) return cached;

    const fresh = await this.assemble(args.projectId, args.tenantId);

    await this.tryWriteCache(args.projectId, fresh);

    return fresh;
  }

  async invalidate(projectId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.client.del(`${OverviewService.CACHE_PREFIX}${projectId}`);
    } catch (err) {
      this.logger.debug(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'OverviewService.invalidate: ignore cache error',
      );
    }
  }

  @OnEvent(TrackerEmitterService.EVENT_NAME)
  async onTrackerEvent(payload: { type: string; issue?: { projectId: string } }): Promise<void> {
    const projectId = payload?.issue?.projectId;
    if (!projectId) return;
    await this.invalidate(projectId);
  }

  private async assemble(projectId: string, tenantId: string): Promise<OverviewResponseDto> {
    const [
      project,
      members,
      metrics,
      statesDistribution,
      activeCycle,
      recentActivity,
      linkedGoals,
      recentDocuments,
    ] = await Promise.all([
      this.fetchProject(projectId, tenantId),
      this.fetchMembers(projectId),
      this.fetchMetrics(projectId, tenantId),
      this.fetchStatesDistribution(projectId, tenantId),
      this.fetchActiveCycle(projectId),
      this.fetchRecentActivity(projectId, tenantId),
      this.fetchLinkedGoals(projectId, tenantId),
      this.fetchRecentDocuments(projectId, tenantId),
    ]);

    return {
      project,
      members,
      metrics,
      statesDistribution,
      activeCycle,
      recentActivity,
      linkedGoals,
      recentDocuments,
    };
  }

  private async fetchProject(projectId: string, tenantId: string): Promise<OverviewProjectMiniDto> {
    const p = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, tenantId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        identifier: true,
        name: true,
        description: true,
        archivedAt: true,
        cycleViewEnabled: true,
        intakeViewEnabled: true,
        gantViewEnabled: true,
      },
    });
    return {
      id: p.id,
      slug: p.slug,
      identifier: p.identifier,
      name: p.name,
      description: p.description,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      cycleViewEnabled: p.cycleViewEnabled,
      intakeViewEnabled: p.intakeViewEnabled,
      gantViewEnabled: p.gantViewEnabled,
    };
  }

  private async fetchMembers(projectId: string): Promise<OverviewUserMiniDto[]> {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { joinedAt: 'asc' },
      take: 8,
    });
    if (members.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => {
      const u = byId.get(m.userId);
      return {
        id: m.userId,
        name: u?.name ?? null,
        email: u?.email ?? null,
        role: m.role,
      };
    });
  }

  private async fetchMetrics(projectId: string, tenantId: string): Promise<OverviewMetricsDto> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [total, inProgress, overdue, completedLast7d] = await Promise.all([
      this.prisma.issue.count({
        where: { tenantId, projectId, deletedAt: null },
      }),
      this.prisma.issue.count({
        where: {
          tenantId,
          projectId,
          deletedAt: null,
          state: { category: 'started' },
        },
      }),
      this.prisma.issue.count({
        where: {
          tenantId,
          projectId,
          deletedAt: null,
          dueDate: { lt: now },
          state: {
            category: { notIn: ['completed', 'cancelled'] },
          },
        },
      }),
      this.prisma.issue.count({
        where: {
          tenantId,
          projectId,
          deletedAt: null,
          completedAt: { gte: sevenDaysAgo },
          state: { category: 'completed' },
        },
      }),
    ]);

    return {
      totalIssues: total,
      inProgressIssues: inProgress,
      overdueIssues: overdue,
      completedLast7d,
    };
  }

  private async fetchStatesDistribution(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewStateBucketDto[]> {
    const rows = await this.prisma.issue.findMany({
      where: { tenantId, projectId, deletedAt: null },
      select: { state: { select: { category: true } } },
    });

    const buckets: Record<OverviewStateCategory, number> = {
      backlog: 0,
      unstarted: 0,
      started: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const r of rows) {
      const cat = r.state?.category as OverviewStateCategory | undefined;
      if (cat && cat in buckets) buckets[cat] += 1;
      else buckets.backlog += 1;
    }
    return (Object.keys(buckets) as OverviewStateCategory[]).map((k) => ({
      category: k,
      count: buckets[k],
    }));
  }

  private async fetchActiveCycle(projectId: string): Promise<OverviewActiveCycleDto | null> {
    const now = new Date();
    const cycle = await this.prisma.cycle.findFirst({
      where: {
        projectId,
        startDate: { lte: now },
        endDate: { gte: now },
        completedAt: null,
      },
      orderBy: { startDate: 'desc' },
    });
    if (!cycle) return null;
    return {
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate.toISOString(),
      endDate: cycle.endDate.toISOString(),
      progressSnapshot: (cycle.progressSnapshot ?? null) as unknown,
      alignmentScore: null,
    };
  }

  private async fetchRecentActivity(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewActivityItemDto[]> {
    const acts = await this.prisma.issueActivity.findMany({
      where: { tenantId, issue: { projectId } },
      orderBy: { epoch: 'desc' },
      take: 10,
      select: {
        id: true,
        issueId: true,
        actorUserId: true,
        actorType: true,
        verb: true,
        field: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
        issue: { select: { identifier: true } },
      },
    });
    return acts.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      issueIdentifier: a.issue?.identifier ?? null,
      actorUserId: a.actorUserId,
      actorType: a.actorType,
      verb: a.verb,
      field: a.field,
      oldValue: a.oldValue as unknown,
      newValue: a.newValue as unknown,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  private async fetchLinkedGoals(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewLinkedGoalDto[]> {
    const issueGoals = await this.prisma.issue.findMany({
      where: { tenantId, projectId, deletedAt: null, goalId: { not: null } },
      select: { goalId: true },
      distinct: ['goalId'],
      take: 30,
    });
    const goalIds = issueGoals.map((i) => i.goalId).filter((g): g is string => Boolean(g));
    if (goalIds.length === 0) return [];
    const goals = await this.prisma.goal.findMany({
      where: { id: { in: goalIds }, tenantId, archivedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        cachedAlignment: true,
        targetDate: true,
      },
      take: 10,
    });
    return goals.map((g) => ({
      id: g.id,
      name: g.name,
      status: g.status as string,
      cachedAlignment: g.cachedAlignment,
      targetDate: g.targetDate?.toISOString() ?? null,
    }));
  }

  private async fetchRecentDocuments(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewProjectDocumentMiniDto[]> {
    if (!this.hasProjectDocument()) return [];
    try {
      const delegate = (
        this.prisma as unknown as {
          projectDocument?: {
            findMany: (
              args: unknown,
            ) => Promise<Array<{ id: string; title: string; updatedAt: Date }>>;
          };
        }
      ).projectDocument;
      if (!delegate) return [];
      const rows = await delegate.findMany({
        where: { tenantId, projectId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, title: true, updatedAt: true },
      });
      return rows.map((d) => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt.toISOString(),
      }));
    } catch (err) {
      this.logger.debug(
        {
          projectId,
          err: err instanceof Error ? err.message : String(err),
        },
        'OverviewService.fetchRecentDocuments: модель ProjectDocument недоступна, пропускаем',
      );
      return [];
    }
  }

  private hasProjectDocument(): boolean {
    return 'projectDocument' in this.prisma;
  }

  private async tryReadCache(projectId: string): Promise<OverviewResponseDto | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.client.get(`${OverviewService.CACHE_PREFIX}${projectId}`);
      if (!raw) return null;
      return JSON.parse(raw) as OverviewResponseDto;
    } catch (err) {
      this.logger.debug(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'OverviewService.tryReadCache: skip',
      );
      return null;
    }
  }

  private async tryWriteCache(projectId: string, value: OverviewResponseDto): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.client.set(
        `${OverviewService.CACHE_PREFIX}${projectId}`,
        JSON.stringify(value),
        'EX',
        OverviewService.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.debug(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'OverviewService.tryWriteCache: skip',
      );
    }
  }
}
