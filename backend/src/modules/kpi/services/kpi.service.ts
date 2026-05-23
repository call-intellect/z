import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MetricValueType, Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveAppointmentTenantTop } from '../../appointments/services/tenant-top';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CreateKpiDto,
  KpiDto,
  KpiFrequency,
  KpiMeasurementDto,
  ListKpiQuery,
  MetricValueTypeLiteral,
  UpdateKpiDto,
} from '../dto/kpi.dto';

/**
 * SBA α-8 wave 3 — сервис KPI.
 *
 * KPI = `Metric` с заполненным `attachedTo*Id`. Это subset, не отдельная
 * сущность. CRUD идёт по `metric`-таблице, фильтр KPI применяем через
 * `kpiOnly` (хотя бы один attachedTo*Id NOT NULL).
 *
 * `PATCH /:id/measurement` атомарно обновляет `currentValue` + `lastMeasuredAt`
 * (опционально `currentValueUnit`). Это hot-path операция, без транзакции — одна update.
 *
 * Метрики:
 *   - `kpi_measurements_total{tenant_top}` — счётчик measurement-вызовов.
 *
 * RBAC — `kpi.read|write|delete`, measurement — `kpi.manage`.
 */
@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ─────────────────────────── list / get ───────────────────────────

  async list(args: {
    tenantId: string;
    query: ListKpiQuery;
  }): Promise<{ items: KpiDto[]; total: number }> {
    const where: Prisma.MetricWhereInput = {
      tenantId: args.tenantId,
      ...(args.query.attachedToRoleId
        ? { attachedToRoleId: args.query.attachedToRoleId }
        : {}),
      ...(args.query.attachedToDepartmentId
        ? { attachedToDepartmentId: args.query.attachedToDepartmentId }
        : {}),
      ...(args.query.attachedToResponsibilityElementId
        ? {
            attachedToResponsibilityElementId:
              args.query.attachedToResponsibilityElementId,
          }
        : {}),
      ...(args.query.frequency ? { frequency: args.query.frequency } : {}),
      ...(args.query.kpiOnly
        ? {
            OR: [
              { attachedToRoleId: { not: null } },
              { attachedToDepartmentId: { not: null } },
              { attachedToResponsibilityElementId: { not: null } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.metric.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: args.query.limit,
      }),
      this.prisma.metric.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDto(r)), total };
  }

  async get(args: { tenantId: string; id: string }): Promise<KpiDto> {
    const row = await this.prisma.metric.findUnique({
      where: { id: args.id },
    });
    if (!row || row.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'kpi_not_found', message: 'KPI не найден' },
      });
    }
    return this.toDto(row);
  }

  // ─────────────────────────── create / update / delete ─────────────

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateKpiDto;
  }): Promise<KpiDto> {
    if (args.body.attachedToRoleId) {
      await this.assertRoleExists(args.tenantId, args.body.attachedToRoleId);
    }
    if (args.body.attachedToDepartmentId) {
      await this.assertDepartmentExists(
        args.tenantId,
        args.body.attachedToDepartmentId,
      );
    }
    if (args.body.attachedToResponsibilityElementId) {
      await this.assertResponsibilityElementExists(
        args.tenantId,
        args.body.attachedToResponsibilityElementId,
      );
    }

    try {
      const created = await this.prisma.metric.create({
        data: {
          tenantId: args.tenantId,
          name: args.body.name,
          description: args.body.description ?? null,
          unit: args.body.unit,
          target: args.body.target ?? null,
          valueType: (args.body.valueType ??
            'count') as MetricValueType,
          attachedToRoleId: args.body.attachedToRoleId ?? null,
          attachedToDepartmentId: args.body.attachedToDepartmentId ?? null,
          attachedToResponsibilityElementId:
            args.body.attachedToResponsibilityElementId ?? null,
          frequency: args.body.frequency ?? null,
        },
      });

      void this.audit.log({
        userId: args.userId,
        action: 'kpi.created',
        resourceId: created.id,
        metadata: {
          tenantId: args.tenantId,
          name: args.body.name,
          attachedToRoleId: args.body.attachedToRoleId ?? null,
          attachedToDepartmentId: args.body.attachedToDepartmentId ?? null,
          attachedToResponsibilityElementId:
            args.body.attachedToResponsibilityElementId ?? null,
        },
      });

      return this.toDto(created);
    } catch (err) {
      this.handleUniqueViolation(err, args.body.name);
      throw err;
    }
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateKpiDto;
  }): Promise<KpiDto> {
    const existing = await this.prisma.metric.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'kpi_not_found', message: 'KPI не найден' },
      });
    }

    if (args.body.attachedToRoleId) {
      await this.assertRoleExists(args.tenantId, args.body.attachedToRoleId);
    }
    if (args.body.attachedToDepartmentId) {
      await this.assertDepartmentExists(
        args.tenantId,
        args.body.attachedToDepartmentId,
      );
    }
    if (args.body.attachedToResponsibilityElementId) {
      await this.assertResponsibilityElementExists(
        args.tenantId,
        args.body.attachedToResponsibilityElementId,
      );
    }

    const data: Prisma.MetricUpdateInput = {};
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.description !== undefined) {
      data.description = args.body.description;
    }
    if (args.body.unit !== undefined) data.unit = args.body.unit;
    if (args.body.target !== undefined) data.target = args.body.target;
    if (args.body.valueType !== undefined) {
      data.valueType = args.body.valueType as MetricValueType;
    }
    if (args.body.attachedToRoleId !== undefined) {
      if (args.body.attachedToRoleId === null) {
        data.attachedRole = { disconnect: true };
      } else {
        data.attachedRole = { connect: { id: args.body.attachedToRoleId } };
      }
    }
    if (args.body.attachedToDepartmentId !== undefined) {
      if (args.body.attachedToDepartmentId === null) {
        data.attachedDepartment = { disconnect: true };
      } else {
        data.attachedDepartment = {
          connect: { id: args.body.attachedToDepartmentId },
        };
      }
    }
    if (args.body.attachedToResponsibilityElementId !== undefined) {
      if (args.body.attachedToResponsibilityElementId === null) {
        data.responsibilityElement = { disconnect: true };
      } else {
        data.responsibilityElement = {
          connect: { id: args.body.attachedToResponsibilityElementId },
        };
      }
    }
    if (args.body.frequency !== undefined) data.frequency = args.body.frequency;

    try {
      const updated = await this.prisma.metric.update({
        where: { id: args.id },
        data,
      });
      void this.audit.log({
        userId: args.userId,
        action: 'kpi.updated',
        resourceId: args.id,
        metadata: {
          tenantId: args.tenantId,
          changedFields: Object.keys(args.body),
        },
      });
      return this.toDto(updated);
    } catch (err) {
      this.handleUniqueViolation(err, args.body.name);
      throw err;
    }
  }

  async delete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string }> {
    const existing = await this.prisma.metric.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'kpi_not_found', message: 'KPI не найден' },
      });
    }
    await this.prisma.metric.delete({ where: { id: args.id } });
    void this.audit.log({
      userId: args.userId,
      action: 'kpi.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId },
    });
    return { id: args.id };
  }

  /**
   * Атомарно обновляет `currentValue` + `lastMeasuredAt` (опц.
   * `currentValueUnit`). Hot-path операция.
   */
  async measurement(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: KpiMeasurementDto;
  }): Promise<KpiDto> {
    const existing = await this.prisma.metric.findUnique({
      where: { id: args.id },
      select: { tenantId: true },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'kpi_not_found', message: 'KPI не найден' },
      });
    }
    const measuredAt = args.body.measuredAt ?? new Date();
    const updated = await this.prisma.metric.update({
      where: { id: args.id },
      data: {
        currentValue: new Prisma.Decimal(args.body.currentValue),
        currentValueUnit: args.body.currentValueUnit ?? undefined,
        lastMeasuredAt: measuredAt,
      },
    });

    void this.audit.log({
      userId: args.userId,
      action: 'kpi.measurement',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        currentValue: args.body.currentValue,
        currentValueUnit: args.body.currentValueUnit ?? null,
        measuredAt: measuredAt.toISOString(),
      },
    });

    this.metrics.incKpiMeasurement({
      tenantTop: resolveAppointmentTenantTop(args.tenantId),
    });

    return this.toDto(updated);
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private async assertRoleExists(
    tenantId: string,
    roleId: string,
  ): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!role || role.tenantId !== tenantId || role.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'role_not_found',
          message: 'Должность не найдена или удалена',
        },
      });
    }
  }

  private async assertDepartmentExists(
    tenantId: string,
    departmentId: string,
  ): Promise<void> {
    const dep = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!dep || dep.tenantId !== tenantId || dep.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_not_found',
          message: 'Отдел не найден или удалён',
        },
      });
    }
  }

  private async assertResponsibilityElementExists(
    tenantId: string,
    elementId: string,
  ): Promise<void> {
    const el = await this.prisma.responsibilityElement.findUnique({
      where: { id: elementId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!el || el.tenantId !== tenantId || el.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'responsibility_element_not_found',
          message: 'Элемент ответственности не найден или удалён',
        },
      });
    }
  }

  private handleUniqueViolation(err: unknown, name: string | undefined): void {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'kpi_name_taken',
          message: `KPI с названием «${name ?? ''}» уже существует`,
        },
      });
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    unit: string;
    target: number | null;
    valueType: MetricValueType;
    attachedToRoleId: string | null;
    attachedToDepartmentId: string | null;
    attachedToResponsibilityElementId: string | null;
    currentValue: Prisma.Decimal | null;
    currentValueUnit: string | null;
    lastMeasuredAt: Date | null;
    frequency: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): KpiDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      unit: row.unit,
      target: row.target,
      valueType: row.valueType as MetricValueTypeLiteral,
      attachedToRoleId: row.attachedToRoleId,
      attachedToDepartmentId: row.attachedToDepartmentId,
      attachedToResponsibilityElementId:
        row.attachedToResponsibilityElementId,
      currentValue:
        row.currentValue !== null ? Number(row.currentValue) : null,
      currentValueUnit: row.currentValueUnit,
      lastMeasuredAt: row.lastMeasuredAt
        ? row.lastMeasuredAt.toISOString()
        : null,
      frequency: (row.frequency as KpiFrequency | null) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
