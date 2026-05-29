import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateCycleDto } from '../dto/cycles/create-cycle.dto';
import type {
  QuickCreateSprintDto,
  QuickCreateSprintResponse,
} from '../dto/sprints/quick-create-sprint.dto';
import type {
  ListSprintsQuery,
  ListSprintsResponse,
  SprintListItemDto,
  SprintListItemScopeDto,
  SprintStatus,
} from '../dto/sprints/sprint-list-item.dto';
import { detectProjectScopeKind } from '../utils/scope-detection';
import {
  generateProjectIdentifier,
  generateProjectSlug,
} from '../utils/translit';

import { CyclesService } from './cycles.service';

/**
 * Sprints (2026-05-28) §1.2 — org-wide список спринтов (master-detail UI).
 * Sprints (2026-05-28) §1.3 — атомарное `quickCreate` для мастера.
 *
 * NB: counters получаем в 1 batch-запрос на каждый тип через `groupBy` — это
 * избавляет от N+1 при больших списках (page <= 100).
 */
@Injectable()
export class SprintsService {
  private readonly logger = new Logger(SprintsService.name);

  /** Дефолтные IssueState'ы (синхронно с `ProjectsService.create`). */
  private static readonly DEFAULT_STATES: ReadonlyArray<{
    name: string;
    category: 'backlog' | 'started' | 'completed' | 'cancelled';
    color: string;
    sequence: number;
    isDefault: boolean;
  }> = [
    { name: 'Бэклог', category: 'backlog', color: '#94A3B8', sequence: 1, isDefault: true },
    { name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2, isDefault: false },
    { name: 'Готово', category: 'completed', color: '#10B981', sequence: 3, isDefault: false },
    { name: 'Отменено', category: 'cancelled', color: '#EF4444', sequence: 4, isDefault: false },
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CyclesService) private readonly cycles: CyclesService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  // ─────────────────────────── list ─────────────────────────────────────

  async list(args: {
    tenantId: string;
    query: ListSprintsQuery;
  }): Promise<ListSprintsResponse> {
    const { tenantId, query } = args;
    const now = new Date();

    // ── 1. WHERE для Cycle + Project (фильтры status / scopeKind / q). ──
    const where: Prisma.CycleWhereInput = { tenantId };

    if (query.status === 'active') {
      where.completedAt = null;
      where.startDate = { lte: now };
      where.endDate = { gte: now };
    } else if (query.status === 'completed') {
      where.completedAt = { not: null };
    } else if (query.status === 'upcoming') {
      where.completedAt = null;
      where.startDate = { gt: now };
    }

    // Project-фильтр: scopeKind + q + softDelete родительского проекта.
    const projectWhere: Prisma.ProjectWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.scopeKind === 'org' || query.scopeKind === 'project') {
      // Оба случая в БД — отсутствие scope-полей. (Отличие 'project' от 'org'
      // живёт только в wizard'е; в схеме это сейчас неотличимо — см. §3 ТЗ.)
      projectWhere.customerCardId = null;
      projectWhere.vendorId = null;
      projectWhere.subjectPersonId = null;
      projectWhere.departmentId = null;
    } else if (query.scopeKind === 'customer') {
      projectWhere.customerCardId = { not: null };
    } else if (query.scopeKind === 'vendor') {
      projectWhere.vendorId = { not: null };
    } else if (query.scopeKind === 'person') {
      projectWhere.subjectPersonId = { not: null };
    } else if (query.scopeKind === 'department') {
      projectWhere.departmentId = { not: null };
    }

    if (query.q && query.q.length > 0) {
      const qLike: Prisma.StringFilter = { contains: query.q, mode: 'insensitive' };
      // Поиск по Cycle.name ИЛИ Project.name/identifier (через project { OR }).
      // В Prisma WHERE для отношения через `project: { OR: [...] }`.
      where.OR = [
        { name: qLike },
        { project: { name: qLike } },
        { project: { identifier: qLike } },
      ];
    }

    where.project = { is: projectWhere };

    // ── 2. ORDER BY (только startDate / hints — progress пост-сортируется). ──
    // Sort hints — игнорируем dir по ТЗ, всегда desc.
    // Для progress/hints на уровне БД сортируем по startDate (стабильность),
    // финальная сортировка — в JS после подсчёта ratio / hints-counts.
    const orderBy: Prisma.CycleOrderByWithRelationInput[] =
      query.sortBy === 'startDate'
        ? [{ startDate: query.sortDir }]
        : [{ startDate: 'desc' }];

    // ── 3. Total + items (с include Project + scope-сущности). ──
    const [total, rawCycles] = await Promise.all([
      this.prisma.cycle.count({ where }),
      this.prisma.cycle.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          project: {
            include: {
              customerCard: { select: { id: true, name: true, deletedAt: true } },
              vendor: { select: { id: true, name: true, deletedAt: true } },
              subjectPerson: {
                select: {
                  id: true,
                  name: true,
                  deletedAt: true,
                  appointments: {
                    where: { validTo: null, status: { not: 'former' } },
                    orderBy: { validFrom: 'desc' },
                    take: 1,
                    select: { role: { select: { id: true, name: true } } },
                  },
                },
              },
              department: { select: { id: true, name: true, deletedAt: true } },
            },
          },
        },
      }),
    ]);

    if (rawCycles.length === 0) {
      return {
        items: [],
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      };
    }

    const cycleIds = rawCycles.map((c) => c.id);

    // ── 4. Counters batch'ами (groupBy). ──
    const [
      issueGroupTotal,
      issueGroupDone,
      hintGroupActive,
      hintGroupCritical,
      meetingGroup,
    ] = await Promise.all([
      this.prisma.issue.groupBy({
        by: ['cycleId'],
        where: {
          tenantId,
          cycleId: { in: cycleIds },
          deletedAt: null,
        },
        _count: { _all: true },
      }),
      this.prisma.issue.groupBy({
        by: ['cycleId'],
        where: {
          tenantId,
          cycleId: { in: cycleIds },
          deletedAt: null,
          state: { category: 'completed' },
        },
        _count: { _all: true },
      }),
      this.prisma.sprintHint.groupBy({
        by: ['cycleId'],
        where: {
          tenantId,
          cycleId: { in: cycleIds },
          status: 'active',
        },
        _count: { _all: true },
      }),
      this.prisma.sprintHint.groupBy({
        by: ['cycleId'],
        where: {
          tenantId,
          cycleId: { in: cycleIds },
          status: 'active',
          severity: 'critical',
        },
        _count: { _all: true },
      }),
      this.prisma.meeting.groupBy({
        by: ['linkedCycleId'],
        where: {
          tenantId,
          linkedCycleId: { in: cycleIds },
        },
        _count: { _all: true },
      }),
    ]);

    const issueTotalByCycle = new Map<string, number>();
    for (const g of issueGroupTotal) {
      if (g.cycleId) issueTotalByCycle.set(g.cycleId, g._count._all);
    }
    const issueDoneByCycle = new Map<string, number>();
    for (const g of issueGroupDone) {
      if (g.cycleId) issueDoneByCycle.set(g.cycleId, g._count._all);
    }
    const hintActiveByCycle = new Map<string, number>();
    for (const g of hintGroupActive) {
      hintActiveByCycle.set(g.cycleId, g._count._all);
    }
    const hintCriticalByCycle = new Map<string, number>();
    for (const g of hintGroupCritical) {
      hintCriticalByCycle.set(g.cycleId, g._count._all);
    }
    const meetingByCycle = new Map<string, number>();
    for (const g of meetingGroup) {
      if (g.linkedCycleId) meetingByCycle.set(g.linkedCycleId, g._count._all);
    }

    // ── 5. Mapping в DTO. ──
    let items: SprintListItemDto[] = rawCycles.map((c) => {
      const total_ = issueTotalByCycle.get(c.id) ?? 0;
      const done_ = issueDoneByCycle.get(c.id) ?? 0;
      const ratio = total_ > 0 ? done_ / total_ : 0;
      const status: SprintStatus = c.completedAt
        ? 'completed'
        : c.startDate.getTime() > now.getTime()
          ? 'upcoming'
          : 'active';
      const scope = this.buildScope(c.project);
      return {
        id: c.id,
        projectId: c.projectId,
        name: c.name,
        project: {
          id: c.project.id,
          name: c.project.name,
          identifier: c.project.identifier,
        },
        scope,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate.toISOString(),
        status,
        progress: { total: total_, completed: done_, ratio },
        activeHintsCount: hintActiveByCycle.get(c.id) ?? 0,
        criticalHintsCount: hintCriticalByCycle.get(c.id) ?? 0,
        linkedMeetingsCount: meetingByCycle.get(c.id) ?? 0,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        completedAt: c.completedAt?.toISOString() ?? null,
      };
    });

    // ── 6. Post-sort по progress / hints. ──
    if (query.sortBy === 'progress') {
      items = [...items].sort((a, b) => {
        const cmp = a.progress.ratio - b.progress.ratio;
        return query.sortDir === 'asc' ? cmp : -cmp;
      });
    } else if (query.sortBy === 'hints') {
      // Всегда desc по critical, затем по active (по ТЗ §1.2).
      items = [...items].sort((a, b) => {
        const cmpCritical = b.criticalHintsCount - a.criticalHintsCount;
        if (cmpCritical !== 0) return cmpCritical;
        return b.activeHintsCount - a.activeHintsCount;
      });
    }

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  // ─────────────────────────── quickCreate ──────────────────────────────

  /**
   * Атомарное создание Project (если нужно) + Cycle + Board + IssueStates.
   *
   * Семантика по scope:
   *   - 'org' — Project без scope-полей.
   *   - 'customer'/'vendor'/'person'/'department' — Project с соответствующим
   *     полем = refId.
   *   - 'project' — переиспользуем existingProjectId, создаём только Cycle.
   *
   * Idempotency-Key обрабатывается на уровне middleware (см. app.module.ts).
   */
  async quickCreate(args: {
    tenantId: string;
    dto: QuickCreateSprintDto;
    userId: string;
  }): Promise<QuickCreateSprintResponse> {
    const { tenantId, dto, userId } = args;

    // ── 1. Подготовить даты (UTC + Europe/Moscow timezone, без LLM). ──
    // dto.startDate = 'YYYY-MM-DD' → start = 00:00 UTC, end = start + durationDays
    // (мы НЕ учитываем timezone-смещение в датах — UI рисует «по локали»,
    // схема Cycle хранит DateTime UTC, см. plans/tz/2026-05-27-sprints.md).
    const start = new Date(`${dto.startDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_start_date',
          message: 'startDate должен быть в формате YYYY-MM-DD',
        },
      });
    }
    const end = new Date(start.getTime() + dto.durationDays * 86400_000);

    // ── 2. Существующий проект (scope='project'). ──
    if (dto.scope === 'project') {
      if (!dto.existingProjectId) {
        // защита: zod-схема уже отвергнет, но дублируем
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'existing_project_required',
            message: 'existingProjectId обязателен при scope=project',
          },
        });
      }
      const project = await this.prisma.project.findFirst({
        where: { id: dto.existingProjectId, tenantId, deletedAt: null },
        select: { id: true, identifier: true, slug: true },
      });
      if (!project) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'project_not_found', message: 'Проект не найден' },
        });
      }
      const cycleDto: CreateCycleDto = {
        name: dto.sprintName,
        startDate: start,
        endDate: end,
        timezone: dto.timezone,
      };
      const cycleResponse = await this.cycles.create(
        project.id,
        cycleDto,
        tenantId,
        userId,
      );
      // Метрика — CyclesService.create уже вызывает incCycleCreated; но quick-create
      // — это отдельный продуктовый поток, поэтому учитываем дополнительно.
      this.metrics?.incCycleCreated({
        tenant: tenantId,
        scopeKind: 'project',
      });
      // Side-effect онбординг v2: первый спринт → firstSprintCreatedAt.
      // audit В10 (2026-05-29): fire-and-forget с явной обработкой rejection,
      // чтобы Promise не превратился в unhandled и не уронил процесс под
      // node:warning unhandledRejection. Сбой апдейта Org не должен ломать
      // создание спринта — это вторичный side-effect онбординга.
      void this.prisma.org
        .updateMany({
          where: { id: tenantId, firstSprintCreatedAt: null },
          data: { firstSprintCreatedAt: new Date() },
        })
        .catch((err) =>
          this.logger.warn(
            `Не удалось обновить Org.firstSprintCreatedAt для tenant=${tenantId} (quick-create): ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      return {
        cycleId: cycleResponse.id,
        projectId: project.id,
        projectIdentifier: project.identifier,
        projectSlug: project.slug,
      };
    }

    // ── 3. Новый проект + Cycle (scope='org'|'customer'|'vendor'|'person'|'department'). ──
    const refLabel = await this.resolveRefLabel({
      tenantId,
      scope: dto.scope,
      refId: dto.refId ?? null,
    });

    // projectName — UI-friendly («Клиент: Альфа»). Для slug/identifier тоже
    // используем human-readable label (транслит-функция справится).
    const projectName = this.buildProjectName(dto.scope, refLabel);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const slug = await generateProjectSlug(projectName, tenantId, tx);
        const identifier = await generateProjectIdentifier(
          projectName,
          tenantId,
          tx,
        );

        // ProjectCreateInput требует relation-connect, но проще через
        // unchecked-input (tenantId + scope-foreign-keys как скаляры).
        const projectUnchecked: Prisma.ProjectUncheckedCreateInput = {
          tenantId,
          slug,
          identifier,
          name: projectName,
          ownerId: userId,
          network: 0,
          timezone: dto.timezone,
          cycleViewEnabled: true,
          intakeViewEnabled: true,
          customerCardId: dto.scope === 'customer' ? (dto.refId ?? null) : null,
          vendorId: dto.scope === 'vendor' ? (dto.refId ?? null) : null,
          subjectPersonId:
            dto.scope === 'person' ? (dto.refId ?? null) : null,
          departmentId:
            dto.scope === 'department' ? (dto.refId ?? null) : null,
        };

        const project = await tx.project.create({
          data: projectUnchecked,
          select: { id: true, identifier: true, slug: true },
        });

        // IssueState'ы.
        const states = await tx.issueState.createManyAndReturn({
          data: SprintsService.DEFAULT_STATES.map((s) => ({
            tenantId,
            projectId: project.id,
            name: s.name,
            color: s.color,
            category: s.category,
            sequence: s.sequence,
            isDefault: s.isDefault,
          })),
          select: { id: true, isDefault: true },
        });
        const defaultStateId = states.find((s) => s.isDefault)?.id ?? null;

        // Owner — admin (role=20).
        await tx.projectMember.create({
          data: { projectId: project.id, userId, role: 20 },
        });

        // Default Board.
        await tx.board.create({
          data: {
            tenantId,
            projectId: project.id,
            name: 'Доска',
            color: '#5EEAD4',
            sequence: 0,
            isDefault: true,
          },
        });

        if (defaultStateId) {
          await tx.project.update({
            where: { id: project.id },
            data: { defaultStateId },
          });
        }

        // Cycle.
        const cycle = await tx.cycle.create({
          data: {
            tenantId,
            projectId: project.id,
            name: dto.sprintName,
            startDate: start,
            endDate: end,
            timezone: dto.timezone,
          },
          select: { id: true },
        });

        return {
          cycleId: cycle.id,
          projectId: project.id,
          projectIdentifier: project.identifier,
          projectSlug: project.slug,
        };
      });

      // ── 4. Метрика после успешной транзакции. ──
      this.metrics?.incCycleCreated({
        tenant: tenantId,
        scopeKind: dto.scope,
      });

      // Side-effect онбординг v2: первый спринт → firstSprintCreatedAt.
      // audit В10 (2026-05-29): см. комментарий выше — fire-and-forget
      // с .catch(warn), без unhandledRejection.
      void this.prisma.org
        .updateMany({
          where: { id: tenantId, firstSprintCreatedAt: null },
          data: { firstSprintCreatedAt: new Date() },
        })
        .catch((err) =>
          this.logger.warn(
            `Не удалось обновить Org.firstSprintCreatedAt для tenant=${tenantId} (full-create): ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      return result;
    } catch (err) {
      if (err instanceof Error && err.message === 'slug_collision') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'slug_collision',
            message:
              'Не удалось подобрать уникальный slug для нового проекта-спринта. Попробуйте поменять имя.',
          },
        });
      }
      if (err instanceof Error && err.message === 'identifier_collision') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'identifier_collision',
            message:
              'Не удалось подобрать уникальный префикс для нового проекта-спринта. Попробуйте поменять имя.',
          },
        });
      }
      throw err;
    }
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  /**
   * Возвращает русский label scope'а + признак isDeleted. Поддерживает все 5
   * типов из БД (org/customer/vendor/person/department); тип 'project' живёт
   * только в wizard'е (UI выбирает existing project).
   */
  private buildScope(project: {
    customerCardId: string | null;
    vendorId: string | null;
    subjectPersonId: string | null;
    departmentId: string | null;
    customerCard: { id: string; name: string; deletedAt: Date | null } | null;
    vendor: { id: string; name: string; deletedAt: Date | null } | null;
    subjectPerson:
      | {
          id: string;
          name: string;
          deletedAt: Date | null;
          appointments: Array<{ role: { id: string; name: string } | null }>;
        }
      | null;
    department: { id: string; name: string; deletedAt: Date | null } | null;
  }): SprintListItemScopeDto {
    const kind = detectProjectScopeKind(project);
    if (kind === 'org') {
      return { kind: 'org', label: 'Компания', refId: null, isDeleted: false };
    }
    if (kind === 'customer') {
      const c = project.customerCard;
      const isDeleted = c?.deletedAt != null;
      const title = c?.name ?? 'неизвестный клиент';
      return {
        kind: 'customer',
        label: isDeleted ? `Клиент: ${title} (удалён)` : `Клиент: ${title}`,
        refId: project.customerCardId,
        isDeleted,
      };
    }
    if (kind === 'vendor') {
      const v = project.vendor;
      const isDeleted = v?.deletedAt != null;
      const name = v?.name ?? 'неизвестный поставщик';
      return {
        kind: 'vendor',
        label: isDeleted ? `Поставщик: ${name} (удалён)` : `Поставщик: ${name}`,
        refId: project.vendorId,
        isDeleted,
      };
    }
    if (kind === 'person') {
      const p = project.subjectPerson;
      const isDeleted = p?.deletedAt != null;
      const personName = p?.name ?? 'неизвестный сотрудник';
      const roleName = p?.appointments[0]?.role?.name ?? null;
      const labelBase = roleName
        ? `Сотрудник: ${personName} — ${roleName}`
        : `Сотрудник: ${personName}`;
      return {
        kind: 'person',
        label: isDeleted ? `${labelBase} (удалён)` : labelBase,
        refId: project.subjectPersonId,
        isDeleted,
      };
    }
    // department
    const d = project.department;
    const isDeleted = d?.deletedAt != null;
    const depName = d?.name ?? 'неизвестный отдел';
    return {
      kind: 'department',
      label: isDeleted ? `Отдел: ${depName} (удалён)` : `Отдел: ${depName}`,
      refId: project.departmentId,
      isDeleted,
    };
  }

  /**
   * Возвращает короткое имя бизнес-сущности (для построения projectName и
   * slug/identifier). 404 если сущность не найдена / не в этом tenant'е.
   */
  private async resolveRefLabel(args: {
    tenantId: string;
    scope: QuickCreateSprintDto['scope'];
    refId: string | null;
  }): Promise<string> {
    const { tenantId, scope, refId } = args;
    if (scope === 'org' || scope === 'project') return '';
    if (!refId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'ref_id_required',
          message: 'refId обязателен для этого scope',
        },
      });
    }
    if (scope === 'customer') {
      const c = await this.prisma.card.findFirst({
        where: { id: refId, tenantId, deletedAt: null },
        select: { name: true },
      });
      if (!c) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'customer_card_not_found',
            message: 'Карточка клиента не найдена',
          },
        });
      }
      return c.name;
    }
    if (scope === 'vendor') {
      const v = await this.prisma.vendor.findFirst({
        where: { id: refId, tenantId, deletedAt: null },
        select: { name: true },
      });
      if (!v) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'vendor_not_found',
            message: 'Поставщик не найден',
          },
        });
      }
      return v.name;
    }
    if (scope === 'person') {
      const p = await this.prisma.person.findFirst({
        where: { id: refId, tenantId, deletedAt: null },
        select: { name: true },
      });
      if (!p) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'person_not_found',
            message: 'Сотрудник не найден',
          },
        });
      }
      return p.name;
    }
    // department
    const d = await this.prisma.department.findFirst({
      where: { id: refId, tenantId, deletedAt: null },
      select: { name: true },
    });
    if (!d) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'department_not_found',
          message: 'Отдел не найден',
        },
      });
    }
    return d.name;
  }

  private buildProjectName(
    scope: QuickCreateSprintDto['scope'],
    refLabel: string,
  ): string {
    if (scope === 'org') return 'Спринт компании';
    if (scope === 'customer') return `Клиент: ${refLabel}`;
    if (scope === 'vendor') return `Поставщик: ${refLabel}`;
    if (scope === 'person') return `Сотрудник: ${refLabel}`;
    if (scope === 'department') return `Отдел: ${refLabel}`;
    // 'project' сюда не доходит — обрабатывается до resolveRefLabel
    return 'Спринт';
  }
}
