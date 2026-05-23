import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CrossFunctionalFrictionReportDto,
  ListCrossFunctionalProcessesQuery,
  ListCrossFunctionalProcessesResponse,
  ListCrossFunctionalFrictionResponse,
} from '../dto/cross-functional.dto';

import { resolveProcessTenantTop } from './tenant-top';

/**
 * SBA γ-3 — CrossFunctionalFrictionService.
 *
 * CRUD-операции вокруг `CrossFunctionalFrictionReport` и list cross-functional
 * шаблонов. Сам пересчёт отчётов делает `CrossFunctionalFrictionAggregatorCron`.
 *
 * Read-side используется REST'ом /api/v1/processes/cross-functional/*.
 *
 * Все user-facing сообщения — на русском.
 */
@Injectable()
export class CrossFunctionalFrictionService {
  private readonly logger = new Logger(CrossFunctionalFrictionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ─────────────────────────── list cross-functional templates ──────

  async listCrossFunctionalProcesses(args: {
    tenantId: string;
    query: ListCrossFunctionalProcessesQuery;
  }): Promise<ListCrossFunctionalProcessesResponse> {
    const q = args.query;
    const skip = (q.page - 1) * q.limit;

    const where: Prisma.ProcessTemplateWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
      isCrossFunctional: true,
    };
    if (q.q) {
      const contains = q.q;
      where.OR = [
        { name: { contains, mode: 'insensitive' } },
        { summary: { contains, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.processTemplate.findMany({
        where,
        orderBy: [
          { crossFunctionalScore: 'desc' },
          { updatedAt: 'desc' },
        ],
        skip,
        take: q.limit,
        select: {
          id: true,
          name: true,
          summary: true,
          category: true,
          scope: true,
          status: true,
          isCrossFunctional: true,
          crossFunctionalScore: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.processTemplate.count({ where }),
    ]);

    // Подгрузим активные friction-отчёты одним батчем.
    const ids = rows.map((r) => r.id);
    const activeFrictionByTemplate = new Map<string, number>();
    if (ids.length > 0) {
      const grouped = await this.prisma.crossFunctionalFrictionReport.groupBy({
        by: ['processTemplateId'],
        where: {
          tenantId: args.tenantId,
          processTemplateId: { in: ids },
          resolvedAt: null,
        },
        _count: { _all: true },
      });
      for (const g of grouped) {
        activeFrictionByTemplate.set(g.processTemplateId, g._count._all);
      }
    }

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        summary: r.summary,
        category: r.category,
        scope: r.scope,
        status: r.status as string,
        isCrossFunctional: r.isCrossFunctional,
        crossFunctionalScore: r.crossFunctionalScore
          ? Number(r.crossFunctionalScore.toString())
          : null,
        activeFrictionCount: activeFrictionByTemplate.get(r.id) ?? 0,
        updatedAt: r.updatedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    };
  }

  // ─────────────────────────── list friction reports ────────────────

  async listFrictionReports(args: {
    tenantId: string;
    processTemplateId: string;
    includeResolved: boolean;
  }): Promise<ListCrossFunctionalFrictionResponse> {
    // Проверим, что шаблон принадлежит tenant'у.
    const t = await this.prisma.processTemplate.findFirst({
      where: {
        id: args.processTemplateId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!t) throw this.templateNotFound(args.processTemplateId);

    const where: Prisma.CrossFunctionalFrictionReportWhereInput = {
      tenantId: args.tenantId,
      processTemplateId: args.processTemplateId,
    };
    if (!args.includeResolved) {
      where.resolvedAt = null;
    }
    const rows = await this.prisma.crossFunctionalFrictionReport.findMany({
      where,
      orderBy: [{ resolvedAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return { items: rows.map((r) => this.toDto(r)) };
  }

  // ─────────────────────────── resolve ──────────────────────────────

  async resolveReport(args: {
    tenantId: string;
    reportId: string;
    resolvedByUserId: string;
  }): Promise<CrossFunctionalFrictionReportDto> {
    const existing = await this.prisma.crossFunctionalFrictionReport.findFirst({
      where: { id: args.reportId, tenantId: args.tenantId },
    });
    if (!existing) throw this.reportNotFound(args.reportId);

    if (existing.resolvedAt) {
      return this.toDto(existing);
    }
    const now = new Date();
    const updated = await this.prisma.crossFunctionalFrictionReport.update({
      where: { id: args.reportId },
      data: {
        resolvedAt: now,
        resolvedByUserId: args.resolvedByUserId,
      },
    });
    // Best-effort: метрика resolution time.
    try {
      const seconds = Math.max(
        0,
        Math.floor((now.getTime() - existing.createdAt.getTime()) / 1000),
      );
      this.metrics.observeCrossFunctionalFrictionResolutionTime({
        tenantTop: resolveProcessTenantTop(args.tenantId),
        seconds,
      });
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'cross-functional-friction: метрика resolution_time не записалась',
      );
    }
    return this.toDto(updated);
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private toDto(r: {
    id: string;
    tenantId: string;
    processTemplateId: string;
    severity: string;
    description: string;
    sourceBlockIds: string[];
    involvedDepartmentIds: string[];
    recommendedAction: string | null;
    resolvedAt: Date | null;
    resolvedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): CrossFunctionalFrictionReportDto {
    return {
      id: r.id,
      processTemplateId: r.processTemplateId,
      severity: this.severityToDto(r.severity),
      description: r.description,
      sourceBlockIds: r.sourceBlockIds,
      involvedDepartmentIds: r.involvedDepartmentIds,
      recommendedAction: r.recommendedAction,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolvedByUserId: r.resolvedByUserId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private severityToDto(
    s: string,
  ): CrossFunctionalFrictionReportDto['severity'] {
    if (s === 'low' || s === 'medium' || s === 'high') return s;
    return 'medium';
  }

  private templateNotFound(id: string): NotFoundException {
    return new NotFoundException({
      ok: false,
      error: {
        code: 'process_template_not_found',
        message: `Шаблон процесса ${id} не найден.`,
      },
    });
  }

  private reportNotFound(id: string): NotFoundException {
    return new NotFoundException({
      ok: false,
      error: {
        code: 'cross_functional_friction_report_not_found',
        message: `Отчёт по cross-functional friction ${id} не найден.`,
      },
    });
  }
}
