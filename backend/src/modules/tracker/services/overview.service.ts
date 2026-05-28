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

/**
 * Tracker Project Overview (2026-05-27) — агрегат данных для стартовой
 * страницы проекта `/projects/[slug]/overview`.
 *
 * Контракт: plans/tz/2026-05-27-tracker-project-overview.md §"Часть 1".
 *
 * Кэш:
 *   - ключ: `project:overview:{projectId}`
 *   - TTL: 30 секунд (горячая страница, агрегаты «дешёвые», но 7 виджетов
 *     в одном запросе оправдывают короткий кэш для повторных просмотров).
 *   - инвалидация: на `tracker.event_occurred` (issue.created/status_changed/...)
 *     + явный вызов `invalidate(projectId)`.
 *
 * Устойчивость к ProjectDocument: модель может ещё не существовать в схеме
 * (соседний агент Волны 2 параллельно над ней работает). OverviewService
 * проверяет `'projectDocument' in prisma` и при отсутствии возвращает
 * `recentDocuments: []` (виджет на фронте рендерит «Документов пока нет»).
 */
@Injectable()
export class OverviewService {
  private readonly logger = new Logger(OverviewService.name);

  static readonly CACHE_PREFIX = 'project:overview:';
  static readonly CACHE_TTL_SECONDS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    // Redis-кэш — Optional: unit-тесты сервиса без Redis не падают.
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
  ) {}

  /**
   * Главный метод. Сначала Redis (если есть), затем DB.
   * Read-only — никаких мутаций, безопасно для горячей страницы.
   */
  async getOverview(args: {
    projectId: string;
    tenantId: string;
  }): Promise<OverviewResponseDto> {
    // 1. Проверка существования + tenant-ownership — кидает 404 если чужой.
    await this.projects.requireProject(args.projectId, args.tenantId);

    // 2. Кэш-hit.
    const cached = await this.tryReadCache(args.projectId);
    if (cached) return cached;

    // 3. Сборка из DB.
    const fresh = await this.assemble(args.projectId, args.tenantId);

    // 4. Кэш-write (best-effort).
    await this.tryWriteCache(args.projectId, fresh);

    return fresh;
  }

  /**
   * Явная инвалидация кэша. Используется тестами и админскими сценариями.
   */
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

  // ── event listener ────────────────────────────────────────────────

  /**
   * Подписка на шину tracker'а. После каждой значимой мутации Issue —
   * инвалидируем кэш конкретного проекта.
   *
   * NB: `project_document.*` события пока нет (соседний агент пишет
   * ProjectDocument); когда появятся — добавить @OnEvent отдельно.
   * Cycle progress пересчитывается раз в N минут cron'ом и сам отдельно
   * эмитит `cycle.updated` через WebSocket (не EventEmitter), поэтому
   * следующий запрос overview перечитает свежий progressSnapshot после
   * истечения TTL=30s — этого достаточно для UX.
   */
  @OnEvent(TrackerEmitterService.EVENT_NAME)
  async onTrackerEvent(payload: {
    type: string;
    issue?: { projectId: string };
  }): Promise<void> {
    const projectId = payload?.issue?.projectId;
    if (!projectId) return;
    await this.invalidate(projectId);
  }

  // ── assemble ──────────────────────────────────────────────────────

  private async assemble(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewResponseDto> {
    // Не делаем большую транзакцию — read-only, агрегаты независимые.
    // Параллельные fetch'и — быстрее.
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

  private async fetchProject(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewProjectMiniDto> {
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

  private async fetchMetrics(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewMetricsDto> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Все агрегаты — одним батчем (параллельно).
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
    // Группируем через JOIN: issue + state.category.
    // Prisma `groupBy` не поддерживает related-field — делаем raw select.
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
      else buckets.backlog += 1; // null state → bucket backlog
    }
    return (Object.keys(buckets) as OverviewStateCategory[]).map((k) => ({
      category: k,
      count: buckets[k],
    }));
  }

  private async fetchActiveCycle(
    projectId: string,
  ): Promise<OverviewActiveCycleDto | null> {
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
      // alignmentScore — best-effort. Если SBA strategic-alignment не выводит
      // score per Cycle, оставим null. (Реальная связь — GoalAlignmentSnapshot,
      // не на Cycle; не делаем в этом ТЗ.)
      alignmentScore: null,
    };
  }

  private async fetchRecentActivity(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewActivityItemDto[]> {
    // 10 свежих IssueActivity по задачам проекта.
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
    // distinct goalId из задач проекта → загружаем Goal.
    const issueGoals = await this.prisma.issue.findMany({
      where: { tenantId, projectId, deletedAt: null, goalId: { not: null } },
      select: { goalId: true },
      distinct: ['goalId'],
      take: 30,
    });
    const goalIds = issueGoals
      .map((i) => i.goalId)
      .filter((g): g is string => Boolean(g));
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

  /**
   * Best-effort документы. Модель `ProjectDocument` может ещё не быть в схеме
   * (соседний агент Волны 2). Проверяем наличие через runtime-проверку,
   * чтобы overview не падал.
   */
  private async fetchRecentDocuments(
    projectId: string,
    tenantId: string,
  ): Promise<OverviewProjectDocumentMiniDto[]> {
    if (!this.hasProjectDocument()) return [];
    try {
      // Делегат может быть назван в нескольких стилях — пробуем стандартный.
      const delegate = (
        this.prisma as unknown as {
          projectDocument?: {
            findMany: (args: unknown) => Promise<
              Array<{ id: string; title: string; updatedAt: Date }>
            >;
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

  // ── cache ─────────────────────────────────────────────────────────

  private async tryReadCache(
    projectId: string,
  ): Promise<OverviewResponseDto | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.client.get(
        `${OverviewService.CACHE_PREFIX}${projectId}`,
      );
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

  private async tryWriteCache(
    projectId: string,
    value: OverviewResponseDto,
  ): Promise<void> {
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
