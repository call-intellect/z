import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  ConfirmRegulationBody,
  ListRegulationsQuery,
  ListRegulationsResponse,
  RegulationDetailDto,
  RegulationHistoryResponse,
  RegulationKindDto,
  RegulationListItemDto,
  SupersedeRegulationBody,
  TrustTierDto,
} from '../dto/regulations.dto';

/**
 * RegulationsService (SBA α-7).
 *
 * Объединяет 3 Prisma-таблицы (`Regulation`, `Process`, `Policy`) под одним
 * REST API `/api/v1/regulations`. Запросы фильтруются по `tenantId` через
 * TenantGuard на уровне контроллера.
 *
 * Все методы кидают `BadRequest` / `NotFound` с сообщениями на русском.
 */
@Injectable()
export class RegulationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ───────────────────────────── list ─────────────────────────────

  async list(args: {
    tenantId: string;
    query: ListRegulationsQuery;
  }): Promise<ListRegulationsResponse> {
    const q = args.query;
    const skip = (q.page - 1) * q.limit;
    const take = q.limit;

    // Если задан конкретный kind — запрашиваем только одну таблицу
    // (быстрее + честный page/total).
    if (q.kind === 'process') {
      return this.listProcesses({ ...args, skip, take });
    }
    if (q.kind === 'policy') {
      return this.listPolicies({ ...args, skip, take });
    }
    if (q.kind === 'regulation' || q.kind === 'standard') {
      return this.listRegulations({ ...args, skip, take, restrictCategory: q.kind });
    }

    // Без фильтра kind — мерджим все три, но честно (через 3 отдельных count'а
    // и page/limit на агрегате). Это упрощённый pageinator: фактически берём
    // первые `limit` записей по `updatedAt DESC` со всех таблиц, а total —
    // сумма всех трёх. Точная глобальная сортировка по offset'у в пределах
    // одного запроса достижима через UNION ALL SQL — это упрощение α-7.
    const [regs, procs, pols, regsCount, procsCount, polsCount] =
      await Promise.all([
        this.prisma.regulation.findMany({
          where: this.regulationsWhere(args.tenantId, q),
          orderBy: { updatedAt: 'desc' },
          take: q.limit * q.page,
          include: { currentVersion: { select: { trustTier: true } } },
        }),
        this.prisma.process.findMany({
          where: this.processesWhere(args.tenantId, q),
          orderBy: { updatedAt: 'desc' },
          take: q.limit * q.page,
          include: { currentVersion: { select: { trustTier: true } } },
        }),
        this.prisma.policy.findMany({
          where: this.policiesWhere(args.tenantId, q),
          orderBy: { updatedAt: 'desc' },
          take: q.limit * q.page,
          include: { currentVersion: { select: { trustTier: true } } },
        }),
        this.prisma.regulation.count({
          where: this.regulationsWhere(args.tenantId, q),
        }),
        this.prisma.process.count({
          where: this.processesWhere(args.tenantId, q),
        }),
        this.prisma.policy.count({
          where: this.policiesWhere(args.tenantId, q),
        }),
      ]);

    const merged = [
      ...regs.map((r) =>
        this.regulationToListItem(r, r.currentVersion?.trustTier ?? 'human'),
      ),
      ...procs.map((p) =>
        this.processToListItem(p, p.currentVersion?.trustTier ?? 'human'),
      ),
      ...pols.map((p) =>
        this.policyToListItem(p, p.currentVersion?.trustTier ?? 'human'),
      ),
    ];
    merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const items = merged.slice(skip, skip + take);
    const total = regsCount + procsCount + polsCount;
    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    };
  }

  private async listRegulations(args: {
    tenantId: string;
    query: ListRegulationsQuery;
    skip: number;
    take: number;
    restrictCategory: 'regulation' | 'standard';
  }): Promise<ListRegulationsResponse> {
    const where = {
      ...this.regulationsWhere(args.tenantId, args.query),
      category: args.restrictCategory,
    };
    const [items, total] = await Promise.all([
      this.prisma.regulation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: args.skip,
        take: args.take,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.regulation.count({ where }),
    ]);
    return {
      items: items.map((r) =>
        this.regulationToListItem(r, r.currentVersion?.trustTier ?? 'human'),
      ),
      total,
      page: args.query.page,
      limit: args.query.limit,
      totalPages: Math.max(1, Math.ceil(total / args.query.limit)),
    };
  }

  private async listProcesses(args: {
    tenantId: string;
    query: ListRegulationsQuery;
    skip: number;
    take: number;
  }): Promise<ListRegulationsResponse> {
    const where = this.processesWhere(args.tenantId, args.query);
    const [items, total] = await Promise.all([
      this.prisma.process.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: args.skip,
        take: args.take,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.process.count({ where }),
    ]);
    return {
      items: items.map((p) =>
        this.processToListItem(p, p.currentVersion?.trustTier ?? 'human'),
      ),
      total,
      page: args.query.page,
      limit: args.query.limit,
      totalPages: Math.max(1, Math.ceil(total / args.query.limit)),
    };
  }

  private async listPolicies(args: {
    tenantId: string;
    query: ListRegulationsQuery;
    skip: number;
    take: number;
  }): Promise<ListRegulationsResponse> {
    const where = this.policiesWhere(args.tenantId, args.query);
    const [items, total] = await Promise.all([
      this.prisma.policy.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: args.skip,
        take: args.take,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.policy.count({ where }),
    ]);
    return {
      items: items.map((p) =>
        this.policyToListItem(p, p.currentVersion?.trustTier ?? 'human'),
      ),
      total,
      page: args.query.page,
      limit: args.query.limit,
      totalPages: Math.max(1, Math.ceil(total / args.query.limit)),
    };
  }

  // ───────────────────────────── get by id ─────────────────────────────

  async getByIdAndKind(args: {
    tenantId: string;
    id: string;
    kind: RegulationKindDto;
  }): Promise<RegulationDetailDto> {
    if (args.kind === 'process') {
      const proc = await this.prisma.process.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        include: {
          steps: { orderBy: { order: 'asc' } },
          currentVersion: { select: { trustTier: true } },
        },
      });
      if (!proc) this.notFound(args.kind, args.id);
      return this.processToDetail(proc, proc.currentVersion?.trustTier ?? 'human');
    }
    if (args.kind === 'policy') {
      const policy = await this.prisma.policy.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        include: { currentVersion: { select: { trustTier: true } } },
      });
      if (!policy) this.notFound(args.kind, args.id);
      return this.policyToDetail(policy, policy.currentVersion?.trustTier ?? 'human');
    }
    // regulation / standard
    const reg = await this.prisma.regulation.findFirst({
      where: {
        id: args.id,
        tenantId: args.tenantId,
        ...(args.kind === 'standard'
          ? { category: 'standard' }
          : { category: 'regulation' }),
      },
      include: { currentVersion: { select: { trustTier: true } } },
    });
    if (!reg) this.notFound(args.kind, args.id);
    return this.regulationToDetail(reg, reg.currentVersion?.trustTier ?? 'human');
  }

  // ───────────────────────────── history ─────────────────────────────

  async getHistory(args: {
    tenantId: string;
    id: string;
    kind: RegulationKindDto;
  }): Promise<RegulationHistoryResponse> {
    const resourceType = this.resourceTypeForKind(args.kind);
    const versions = await this.prisma.cardVersion.findMany({
      where: {
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
      },
      orderBy: { version: 'desc' },
      take: 100,
    });
    return {
      items: versions.map((v) => ({
        id: v.id,
        version: v.version,
        previousVersionId: v.previousVersionId,
        payload: (v.payload as Record<string, unknown>) ?? {},
        changeReason: v.changeReason,
        createdAt: v.createdAt.toISOString(),
        createdByUserId: v.createdByUserId,
      })),
    };
  }

  // ───────────────────────────── supersede / confirm ─────────────────────────────

  async supersede(args: {
    tenantId: string;
    id: string;
    body: SupersedeRegulationBody;
  }): Promise<{ ok: true }> {
    if (args.body.kind !== 'regulation' && args.body.kind !== 'standard') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'supersede_unsupported_kind',
          message: 'Замена другой версией поддержана только для регламентов и стандартов.',
        },
      });
    }
    // Проверяем, что обе записи существуют в этом tenant'е.
    const existing = await this.prisma.regulation.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!existing) this.notFound(args.body.kind, args.id);
    const successor = await this.prisma.regulation.findFirst({
      where: {
        id: args.body.supersededByRegulationId,
        tenantId: args.tenantId,
      },
      select: { id: true },
    });
    if (!successor) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'successor_not_found',
          message: 'Регламент-замена не найден в этой организации.',
        },
      });
    }
    // Помечаем `existing` как `deprecated`, `successor.supersedesId = existing.id`.
    await this.prisma.$transaction([
      this.prisma.regulation.update({
        where: { id: args.id },
        data: { status: 'deprecated' },
      }),
      this.prisma.regulation.update({
        where: { id: args.body.supersededByRegulationId },
        data: { supersedesId: args.id },
      }),
    ]);
    return { ok: true };
  }

  async confirm(args: {
    tenantId: string;
    id: string;
    body: ConfirmRegulationBody;
  }): Promise<{ ok: true; lastConfirmedAt: string }> {
    const now = new Date();
    if (args.body.kind === 'process') {
      const exists = await this.prisma.process.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        select: { id: true },
      });
      if (!exists) this.notFound(args.body.kind, args.id);
      await this.prisma.process.update({
        where: { id: args.id },
        data: { lastConfirmedAt: now },
      });
      return { ok: true, lastConfirmedAt: now.toISOString() };
    }
    if (args.body.kind === 'policy') {
      const exists = await this.prisma.policy.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        select: { id: true },
      });
      if (!exists) this.notFound(args.body.kind, args.id);
      await this.prisma.policy.update({
        where: { id: args.id },
        data: { lastConfirmedAt: now },
      });
      return { ok: true, lastConfirmedAt: now.toISOString() };
    }
    // regulation / standard
    const exists = await this.prisma.regulation.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!exists) this.notFound(args.body.kind, args.id);
    await this.prisma.regulation.update({
      where: { id: args.id },
      data: { lastConfirmedAt: now },
    });
    return { ok: true, lastConfirmedAt: now.toISOString() };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private regulationsWhere(
    tenantId: string,
    q: ListRegulationsQuery,
  ): Prisma.RegulationWhereInput {
    const where: Prisma.RegulationWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.scope) where.scope = { contains: q.scope, mode: 'insensitive' };
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { contentMd: { contains: q.q, mode: 'insensitive' } },
        { statement: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private processesWhere(
    tenantId: string,
    q: ListRegulationsQuery,
  ): Prisma.ProcessWhereInput {
    const where: Prisma.ProcessWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.scope) where.scope = { contains: q.scope, mode: 'insensitive' };
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private policiesWhere(
    tenantId: string,
    q: ListRegulationsQuery,
  ): Prisma.PolicyWhereInput {
    const where: Prisma.PolicyWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.scope) where.scope = { contains: q.scope, mode: 'insensitive' };
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { contentMd: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  // mappers

  private regulationToListItem(
    r: Awaited<ReturnType<PrismaService['regulation']['findFirst']>> extends null | infer T
      ? NonNullable<T>
      : never,
    trustTier: TrustTierDto,
  ): RegulationListItemDto {
    return {
      id: r.id,
      kind: r.category === 'standard' ? 'standard' : 'regulation',
      name: r.name,
      statement: r.statement ?? null,
      category: r.category === 'standard' ? 'standard' : 'regulation',
      severity: null,
      scope: r.scope ?? null,
      status: r.status,
      ownerPersonId: r.ownerPersonId ?? null,
      confidence: r.confidence ?? null,
      trustTier,
      lastConfirmedAt: r.lastConfirmedAt ? r.lastConfirmedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private processToListItem(
    p: Awaited<ReturnType<PrismaService['process']['findFirst']>> extends null | infer T
      ? NonNullable<T>
      : never,
    trustTier: TrustTierDto,
  ): RegulationListItemDto {
    return {
      id: p.id,
      kind: 'process',
      name: p.name,
      statement: p.description ?? null,
      category: null,
      severity: null,
      scope: p.scope ?? null,
      status: p.status,
      ownerPersonId: p.ownerPersonId ?? null,
      confidence: p.confidence ?? null,
      trustTier,
      lastConfirmedAt: p.lastConfirmedAt ? p.lastConfirmedAt.toISOString() : null,
      updatedAt: p.updatedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    };
  }

  private policyToListItem(
    p: Awaited<ReturnType<PrismaService['policy']['findFirst']>> extends null | infer T
      ? NonNullable<T>
      : never,
    trustTier: TrustTierDto,
  ): RegulationListItemDto {
    return {
      id: p.id,
      kind: 'policy',
      name: p.name,
      statement: p.contentMd ?? null,
      category: null,
      severity: p.severity,
      scope: p.scope ?? null,
      status: p.status,
      ownerPersonId: p.ownerPersonId ?? null,
      confidence: p.confidence ?? null,
      trustTier,
      lastConfirmedAt: p.lastConfirmedAt ? p.lastConfirmedAt.toISOString() : null,
      updatedAt: p.updatedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    };
  }

  private regulationToDetail(
    r: NonNullable<Awaited<ReturnType<PrismaService['regulation']['findFirst']>>>,
    trustTier: TrustTierDto,
  ): RegulationDetailDto {
    return {
      ...this.regulationToListItem(r, trustTier),
      contentMd: r.contentMd,
      sourceBlockIds: r.sourceBlockIds,
      personSubjectIds: r.personSubjectIds,
      currentVersionId: r.currentVersionId ?? null,
      supersedesId: r.supersedesId ?? null,
    };
  }

  private processToDetail(
    p: NonNullable<
      Awaited<
        ReturnType<typeof this.prisma.process.findFirst>
      > & {
        steps: Array<{
          id: string;
          order: number;
          name: string;
          description: string | null;
          slaMinutes: number | null;
        }>;
      }
    >,
    trustTier: TrustTierDto,
  ): RegulationDetailDto {
    const base = this.processToListItem(p, trustTier);
    return {
      ...base,
      contentMd: p.description ?? '',
      sourceBlockIds: p.sourceBlockIds,
      personSubjectIds: p.personSubjectIds,
      currentVersionId: p.currentVersionId ?? null,
      steps: p.steps.map((s) => ({
        id: s.id,
        order: s.order,
        name: s.name,
        description: s.description,
        slaMinutes: s.slaMinutes,
      })),
    };
  }

  private policyToDetail(
    p: NonNullable<Awaited<ReturnType<PrismaService['policy']['findFirst']>>>,
    trustTier: TrustTierDto,
  ): RegulationDetailDto {
    const base = this.policyToListItem(p, trustTier);
    return {
      ...base,
      contentMd: p.contentMd,
      sourceBlockIds: p.sourceBlockIds,
      personSubjectIds: p.personSubjectIds,
      currentVersionId: p.currentVersionId ?? null,
    };
  }

  private resourceTypeForKind(kind: RegulationKindDto): string {
    if (kind === 'process') return 'process';
    if (kind === 'policy') return 'policy';
    return 'regulation';
  }

  private notFound(kind: string, id: string): never {
    throw new NotFoundException({
      ok: false,
      error: {
        code: 'regulation_not_found',
        message: `Запись (${kind}) ${id} не найдена в этой организации.`,
      },
    });
  }
}
