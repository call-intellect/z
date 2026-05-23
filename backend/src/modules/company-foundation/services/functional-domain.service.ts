import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FunctionalDomain } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CreateDomainDto,
  FunctionalDomainDto,
  ListDomainsQuery,
  ListDomainsResponseDto,
  SeedTemplateResponseDto,
  UpdateDomainDto,
} from '../dto/functional-domain.dto';
import type {
  IOrganizationalUnit,
  OrganizationalUnitScope,
} from '../interfaces/organizational-unit.interface';

import {
  BASE_FUNCTIONAL_DOMAINS,
  INDUSTRY_DOMAIN_TEMPLATES,
  type IndustrySlug,
} from './functional-domain.seeds';

/**
 * SBA α-9 wave 3 — управление FunctionalDomain (дерево функциональных областей).
 *
 * Бизнес-правила:
 *   - tenant-isolation на всех чтении/записи.
 *   - soft-delete (deletedAt) — записи остаются для исторического анализа
 *     и совместимости с linked Department'ами.
 *   - parentDomainId должен принадлежать тому же tenantId.
 *   - depth ≤ 5 (anti-loop, см. ТЗ §17).
 *   - детектор циклов: при INSERT/UPDATE проверяем, что this.id не встречается
 *     в цепочке предков нового parent'а.
 *   - isSystem=true (seed) защищён от delete — только update name/desc/icon.
 *
 * Реализует IOrganizationalUnit-фабрику через `toUnit()`.
 */
@Injectable()
export class FunctionalDomainService {
  private readonly logger = new Logger(FunctionalDomainService.name);
  private static readonly MAX_DEPTH = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  // ─────────────────────────── list / get ───────────────────────────

  async list(args: {
    tenantId: string;
    query: ListDomainsQuery;
  }): Promise<ListDomainsResponseDto> {
    const where: Prisma.FunctionalDomainWhereInput = {
      tenantId: args.tenantId,
      ...(args.query.includeDeleted ? {} : { deletedAt: null }),
      ...(args.query.onlySystem !== undefined
        ? { isSystem: args.query.onlySystem }
        : {}),
    };
    const rows = await this.prisma.functionalDomain.findMany({
      where,
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      take: args.query.limit,
    });
    const total = rows.length;
    const linkCounts = await this.countLinks(rows.map((d) => d.id));

    const items: FunctionalDomainDto[] = rows.map((d) =>
      this.toDto(d, linkCounts.get(d.id) ?? 0),
    );

    if (args.query.includeChildren) {
      // Постройка дерева: для каждого root nestим children из того же list'а.
      const byId = new Map<string, FunctionalDomainDto>();
      for (const it of items) byId.set(it.id, { ...it, children: [] });
      const roots: FunctionalDomainDto[] = [];
      for (const it of items) {
        const node = byId.get(it.id)!;
        if (it.parentDomainId && byId.has(it.parentDomainId)) {
          const parent = byId.get(it.parentDomainId)!;
          parent.children = parent.children ?? [];
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
      return { items: roots, total };
    }

    return { items, total };
  }

  async get(args: { tenantId: string; id: string }): Promise<FunctionalDomainDto> {
    const dom = await this.prisma.functionalDomain.findUnique({
      where: { id: args.id },
    });
    if (!dom || dom.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'domain_not_found', message: 'Домен не найден' },
      });
    }
    const linkCount = (await this.countLinks([dom.id])).get(dom.id) ?? 0;
    return this.toDto(dom, linkCount);
  }

  // ─────────────────────────── create / update / delete ─────────────

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateDomainDto;
    isSystem?: boolean;
    confidence?: number;
  }): Promise<FunctionalDomainDto> {
    if (args.body.parentDomainId) {
      await this.assertParentExists(args.tenantId, args.body.parentDomainId);
      await this.assertDepthOk(args.tenantId, args.body.parentDomainId);
    }
    try {
      const created = await this.prisma.functionalDomain.create({
        data: {
          tenantId: args.tenantId,
          parentDomainId: args.body.parentDomainId ?? null,
          name: args.body.name,
          slug: args.body.slug,
          description: args.body.description ?? null,
          iconName: args.body.iconName ?? null,
          order: args.body.order ?? 0,
          isSystem: args.isSystem ?? false,
          ...(args.confidence !== undefined
            ? { confidence: new Prisma.Decimal(args.confidence) }
            : {}),
        },
      });
      void this.audit.log({
        userId: args.userId,
        action: 'functional_domain.created',
        resourceId: created.id,
        metadata: {
          tenantId: args.tenantId,
          slug: created.slug,
          isSystem: created.isSystem,
        },
      });
      return this.toDto(created, 0);
    } catch (err) {
      this.handleUniqueViolation(err, args.body.slug);
      throw err;
    }
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateDomainDto;
  }): Promise<FunctionalDomainDto> {
    const existing = await this.prisma.functionalDomain.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'domain_not_found', message: 'Домен не найден' },
      });
    }
    if (args.body.parentDomainId !== undefined) {
      if (args.body.parentDomainId === args.id) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'domain_self_parent',
            message: 'Домен не может быть родителем самого себя',
          },
        });
      }
      if (args.body.parentDomainId !== null) {
        await this.assertParentExists(args.tenantId, args.body.parentDomainId);
        await this.assertNoCycle(
          args.tenantId,
          args.id,
          args.body.parentDomainId,
        );
        await this.assertDepthOk(args.tenantId, args.body.parentDomainId);
      }
    }
    const data: Prisma.FunctionalDomainUpdateInput = {};
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.description !== undefined) data.description = args.body.description;
    if (args.body.iconName !== undefined) data.iconName = args.body.iconName;
    if (args.body.order !== undefined) data.order = args.body.order;
    if (args.body.parentDomainId !== undefined) {
      if (args.body.parentDomainId === null) {
        data.parent = { disconnect: true };
      } else {
        data.parent = { connect: { id: args.body.parentDomainId } };
      }
    }
    const updated = await this.prisma.functionalDomain.update({
      where: { id: args.id },
      data,
    });
    void this.audit.log({
      userId: args.userId,
      action: 'functional_domain.updated',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        changedFields: Object.keys(args.body),
      },
    });
    const linkCount = (await this.countLinks([updated.id])).get(updated.id) ?? 0;
    return this.toDto(updated, linkCount);
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.prisma.functionalDomain.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'domain_not_found', message: 'Домен не найден' },
      });
    }
    if (existing.isSystem) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'domain_is_system',
          message: 'Системные домены нельзя удалить',
        },
      });
    }
    if (existing.deletedAt) {
      return { id: existing.id, deletedAt: existing.deletedAt.toISOString() };
    }
    const children = await this.prisma.functionalDomain.count({
      where: { parentDomainId: args.id, deletedAt: null },
    });
    if (children > 0) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'domain_has_children',
          message: 'У домена есть дочерние — удалите/перенесите их сначала',
        },
      });
    }
    const updated = await this.prisma.functionalDomain.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'functional_domain.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    return {
      id: updated.id,
      deletedAt: (updated.deletedAt ?? new Date()).toISOString(),
    };
  }

  // ─────────────────────────── seed-template ────────────────────────

  /**
   * Создать базовый набор FunctionalDomain под выбранную индустрию.
   * Идемпотентно: существующие домены по slug пропускаются.
   *
   * При первом вызове в новой Org обычно создаются BASE_FUNCTIONAL_DOMAINS
   * (8 штук) + per-industry надстройка (5–10 доменов).
   */
  async seedTemplate(args: {
    tenantId: string;
    userId: string;
    industry: IndustrySlug;
  }): Promise<SeedTemplateResponseDto> {
    let created = 0;
    let skipped = 0;
    // 1. Базовые 8 доменов (всегда добавляем — это «костяк» любой компании).
    const baseSlugByName = new Map<string, string>();
    for (const it of BASE_FUNCTIONAL_DOMAINS) {
      const exists = await this.prisma.functionalDomain.findUnique({
        where: { tenantId_slug: { tenantId: args.tenantId, slug: it.slug } },
      });
      baseSlugByName.set(it.name, it.slug);
      if (exists) {
        skipped++;
        continue;
      }
      await this.prisma.functionalDomain.create({
        data: {
          tenantId: args.tenantId,
          name: it.name,
          slug: it.slug,
          description: it.description ?? null,
          iconName: it.iconName ?? null,
          order: it.order ?? 0,
          isSystem: true,
        },
      });
      created++;
    }

    // 2. Per-industry надстройка — обычно дочки к существующим базовым.
    const tpl = INDUSTRY_DOMAIN_TEMPLATES[args.industry];
    if (tpl) {
      // Подтянуть свежие id для базовых (parent резолвится по slug).
      const baseRows = await this.prisma.functionalDomain.findMany({
        where: {
          tenantId: args.tenantId,
          slug: { in: Array.from(baseSlugByName.values()) },
        },
        select: { id: true, slug: true },
      });
      const idBySlug = new Map(baseRows.map((r) => [r.slug, r.id]));
      for (const it of tpl) {
        const exists = await this.prisma.functionalDomain.findUnique({
          where: { tenantId_slug: { tenantId: args.tenantId, slug: it.slug } },
        });
        if (exists) {
          skipped++;
          continue;
        }
        const parentId = it.parentSlug ? idBySlug.get(it.parentSlug) ?? null : null;
        await this.prisma.functionalDomain.create({
          data: {
            tenantId: args.tenantId,
            name: it.name,
            slug: it.slug,
            description: it.description ?? null,
            iconName: it.iconName ?? null,
            parentDomainId: parentId,
            order: it.order ?? 10,
            isSystem: true,
          },
        });
        created++;
      }
    }

    void this.audit.log({
      userId: args.userId,
      action: 'functional_domain.seed_template_applied',
      resourceId: args.tenantId,
      metadata: {
        tenantId: args.tenantId,
        industry: args.industry,
        created,
        skipped,
      },
    });

    return { created, skipped, industry: args.industry };
  }

  // ─────────────────────────── IOrganizationalUnit ───────────────────

  toUnit(row: FunctionalDomain): IOrganizationalUnit {
    const prisma = this.prisma;
    const getChildrenFromPrisma = async (): Promise<IOrganizationalUnit[]> => {
      const children = await prisma.functionalDomain.findMany({
        where: {
          tenantId: row.tenantId,
          parentDomainId: row.id,
          deletedAt: null,
        },
      });
      return children.map((c) => this.toUnit(c));
    };
    return {
      scope: 'domain' as OrganizationalUnitScope,
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      missionStatement: null,
      entityId: null,
      maturityScore: row.completeness ? Number(row.completeness) : null,
      completeness: row.completeness ? Number(row.completeness) : null,
      parentUnitId: row.parentDomainId,
      getChildren: getChildrenFromPrisma,
    };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private async countLinks(domainIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (domainIds.length === 0) return out;
    const grouped = await this.prisma.departmentDomainLink.groupBy({
      by: ['domainId'],
      where: { domainId: { in: domainIds } },
      _count: { _all: true },
    });
    for (const id of domainIds) out.set(id, 0);
    for (const g of grouped) out.set(g.domainId, g._count._all);
    return out;
  }

  private async assertParentExists(
    tenantId: string,
    parentId: string,
  ): Promise<void> {
    const parent = await this.prisma.functionalDomain.findUnique({
      where: { id: parentId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!parent || parent.tenantId !== tenantId || parent.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_domain_not_found',
          message: 'Родительский домен не найден или удалён',
        },
      });
    }
  }

  private async assertDepthOk(
    tenantId: string,
    parentId: string,
  ): Promise<void> {
    let depth = 1;
    let currentId: string | null = parentId;
    while (currentId) {
      depth++;
      if (depth > FunctionalDomainService.MAX_DEPTH) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'domain_max_depth',
            message: `Глубина дерева доменов не может превышать ${FunctionalDomainService.MAX_DEPTH}`,
          },
        });
      }
      const next: { parentDomainId: string | null } | null =
        await this.prisma.functionalDomain.findUnique({
          where: { id: currentId },
          select: { parentDomainId: true },
        });
      currentId = next?.parentDomainId ?? null;
    }
  }

  /**
   * Проверка: новый parent → ... → predecessor НЕ ведёт к thisId.
   */
  private async assertNoCycle(
    tenantId: string,
    thisId: string,
    newParentId: string,
  ): Promise<void> {
    let currentId: string | null = newParentId;
    const seen = new Set<string>();
    while (currentId) {
      if (currentId === thisId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'domain_cycle',
            message: 'Цикл в иерархии доменов недопустим',
          },
        });
      }
      if (seen.has(currentId)) break; // уже существующий цикл — не наша проблема
      seen.add(currentId);
      const next: { parentDomainId: string | null } | null =
        await this.prisma.functionalDomain.findUnique({
          where: { id: currentId },
          select: { parentDomainId: true },
        });
      currentId = next?.parentDomainId ?? null;
    }
  }

  private handleUniqueViolation(err: unknown, slug: string | undefined): void {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'domain_slug_taken',
          message: `Домен с slug «${slug ?? ''}» уже существует`,
        },
      });
    }
  }

  private toDto(d: FunctionalDomain, linkedDepartmentsCount: number): FunctionalDomainDto {
    return {
      id: d.id,
      tenantId: d.tenantId,
      parentDomainId: d.parentDomainId,
      name: d.name,
      slug: d.slug,
      description: d.description,
      iconName: d.iconName,
      isSystem: d.isSystem,
      completeness: d.completeness ? Number(d.completeness) : null,
      order: d.order,
      confidence: d.confidence ? Number(d.confidence) : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
      linkedDepartmentsCount,
    };
  }
}
