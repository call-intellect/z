import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type { RoleBearerChangedEvent } from '../../knowledge-core/services/role-clone-persona-versioning.handler';
import type {
  AppointmentDto,
  AppointmentStatus,
  AppointmentTimelineItemDto,
  CreateAppointmentDto,
  ListAppointmentsQuery,
  UpdateAppointmentDto,
} from '../dto/appointments.dto';

import { resolveAppointmentStatus, resolveAppointmentTenantTop } from './tenant-top';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly events?: EventEmitter2,
  ) {}

  async list(args: {
    tenantId: string;
    query: ListAppointmentsQuery;
  }): Promise<{ items: AppointmentDto[]; total: number }> {
    const where: Prisma.AppointmentWhereInput = {
      tenantId: args.tenantId,
      ...(args.query.personId ? { personId: args.query.personId } : {}),
      ...(args.query.roleId ? { roleId: args.query.roleId } : {}),
      ...(args.query.departmentId ? { departmentId: args.query.departmentId } : {}),
      ...(args.query.status ? { status: args.query.status } : {}),
      ...(args.query.activeOnly ? { validTo: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        orderBy: [{ validFrom: 'desc' }],
        take: args.query.limit,
        include: {
          person: { select: { id: true, name: true } },
          role: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDto(r)), total };
  }

  async get(args: { tenantId: string; id: string }): Promise<AppointmentDto> {
    const row = await this.prisma.appointment.findUnique({
      where: { id: args.id },
      include: {
        person: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
    if (!row || row.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'appointment_not_found',
          message: 'Назначение не найдено',
        },
      });
    }
    return this.toDto(row);
  }

  async personTimelineByEntity(args: {
    tenantId: string;
    entityId: string;
  }): Promise<{ items: AppointmentTimelineItemDto[] }> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, entityId: args.entityId },
      select: { id: true },
    });
    if (!person) return { items: [] };
    return this.personTimeline({
      tenantId: args.tenantId,
      personId: person.id,
    });
  }

  async personTimeline(args: {
    tenantId: string;
    personId: string;
  }): Promise<{ items: AppointmentTimelineItemDto[] }> {
    const rows = await this.prisma.appointment.findMany({
      where: { tenantId: args.tenantId, personId: args.personId },
      orderBy: [{ validFrom: 'desc' }],
      include: {
        person: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    const items: AppointmentTimelineItemDto[] = rows.map((r) => {
      const dto = this.toDto(r);
      const end = r.validTo ? r.validTo.getTime() : null;
      const durationDays =
        end === null ? null : Math.max(0, Math.floor((end - r.validFrom.getTime()) / 86_400_000));
      return { ...dto, durationDays };
    });

    return { items };
  }

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateAppointmentDto;
  }): Promise<AppointmentDto> {
    await this.assertPersonExists(args.tenantId, args.body.personId);
    await this.assertRoleExists(args.tenantId, args.body.roleId);
    if (args.body.departmentId) {
      await this.assertDepartmentExists(args.tenantId, args.body.departmentId);
    }

    const validFrom = args.body.validFrom ?? new Date();
    const status: AppointmentStatus =
      args.body.status ?? resolveAppointmentStatus(args.body.validTo ?? null);

    try {
      const created = await this.prisma.appointment.create({
        data: {
          tenantId: args.tenantId,
          personId: args.body.personId,
          roleId: args.body.roleId,
          departmentId: args.body.departmentId ?? null,
          loadPercent: args.body.loadPercent ?? 100,
          status,
          validFrom,
          validTo: args.body.validTo ?? null,
          sourceBlockIds: [],
          confidence: new Prisma.Decimal('1.000'),
        },
        include: {
          person: { select: { id: true, name: true } },
          role: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      });

      void this.audit.log({
        userId: args.userId,
        action: 'appointment.created',
        resourceId: created.id,
        metadata: {
          tenantId: args.tenantId,
          personId: args.body.personId,
          roleId: args.body.roleId,
          status,
        },
      });

      void this.refreshAppointmentsGauge(args.tenantId).catch((err) =>
        this.logger.warn(`refreshAppointmentsGauge failed: ${String(err)}`),
      );

      void this.maybeEmitBearerChanged({
        tenantId: args.tenantId,
        roleId: args.body.roleId,
      }).catch((err) => this.logger.warn(`maybeEmitBearerChanged failed (create): ${String(err)}`));

      return this.toDto(created);
    } catch (err) {
      this.handleUniqueViolation(err);
      throw err;
    }
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateAppointmentDto;
  }): Promise<AppointmentDto> {
    const existing = await this.prisma.appointment.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'appointment_not_found',
          message: 'Назначение не найдено',
        },
      });
    }

    if (args.body.departmentId) {
      await this.assertDepartmentExists(args.tenantId, args.body.departmentId);
    }

    const data: Prisma.AppointmentUpdateInput = {};
    if (args.body.departmentId !== undefined) {
      if (args.body.departmentId === null) {
        data.department = { disconnect: true };
      } else {
        data.department = { connect: { id: args.body.departmentId } };
      }
    }
    if (args.body.loadPercent !== undefined) {
      data.loadPercent = args.body.loadPercent;
    }
    if (args.body.status !== undefined) data.status = args.body.status;
    if (args.body.validFrom !== undefined) data.validFrom = args.body.validFrom;
    if (args.body.validTo !== undefined) data.validTo = args.body.validTo;

    try {
      const updated = await this.prisma.appointment.update({
        where: { id: args.id },
        data,
        include: {
          person: { select: { id: true, name: true } },
          role: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      });

      void this.audit.log({
        userId: args.userId,
        action: 'appointment.updated',
        resourceId: args.id,
        metadata: {
          tenantId: args.tenantId,
          changedFields: Object.keys(args.body),
        },
      });

      void this.refreshAppointmentsGauge(args.tenantId).catch((err) =>
        this.logger.warn(`refreshAppointmentsGauge failed: ${String(err)}`),
      );

      void this.maybeEmitBearerChanged({
        tenantId: args.tenantId,
        roleId: existing.roleId,
      }).catch((err) => this.logger.warn(`maybeEmitBearerChanged failed (update): ${String(err)}`));

      return this.toDto(updated);
    } catch (err) {
      this.handleUniqueViolation(err);
      throw err;
    }
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<AppointmentDto> {
    const existing = await this.prisma.appointment.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'appointment_not_found',
          message: 'Назначение не найдено',
        },
      });
    }

    const now = new Date();
    const updated = await this.prisma.appointment.update({
      where: { id: args.id },
      data: {
        status: 'former',
        validTo: existing.validTo ?? now,
      },
      include: {
        person: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    void this.audit.log({
      userId: args.userId,
      action: 'appointment.archived',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });

    void this.refreshAppointmentsGauge(args.tenantId).catch((err) =>
      this.logger.warn(`refreshAppointmentsGauge failed: ${String(err)}`),
    );

    void this.maybeEmitBearerChanged({
      tenantId: args.tenantId,
      roleId: existing.roleId,
    }).catch((err) =>
      this.logger.warn(`maybeEmitBearerChanged failed (softDelete): ${String(err)}`),
    );

    return this.toDto(updated);
  }

  private async assertPersonExists(tenantId: string, personId: string): Promise<void> {
    const p = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!p || p.tenantId !== tenantId || p.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Сотрудник не найден или удалён',
        },
      });
    }
  }

  private async assertRoleExists(tenantId: string, roleId: string): Promise<void> {
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

  private async assertDepartmentExists(tenantId: string, departmentId: string): Promise<void> {
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

  private async maybeEmitBearerChanged(args: { tenantId: string; roleId: string }): Promise<void> {
    if (!this.events) return;

    const activeAppointments = await this.prisma.appointment.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        validTo: null,
      },
      orderBy: [{ loadPercent: 'desc' }, { validFrom: 'desc' }],
      select: { personId: true },
      take: 1,
    });
    const newBearerId = activeAppointments[0]?.personId ?? null;

    const currentPersona = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        scopeRefId: args.roleId,
        status: 'active',
      },
      orderBy: [{ roleVersion: 'desc' }, { snapshotAt: 'desc' }],
      select: { currentBearerPersonId: true },
    });
    const oldBearerId = currentPersona?.currentBearerPersonId ?? null;

    if (oldBearerId === newBearerId) return;

    const payload: RoleBearerChangedEvent = {
      tenantId: args.tenantId,
      roleId: args.roleId,
      oldPersonId: oldBearerId,
      newPersonId: newBearerId,
      changedAt: new Date(),
    };
    void this.events.emitAsync('role.bearer_changed', payload).catch((err) => {
      this.logger.warn(
        {
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role.bearer_changed: emit упал',
      );
    });
  }

  private async refreshAppointmentsGauge(tenantId: string): Promise<void> {
    const groups = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    });
    const top = resolveAppointmentTenantTop(tenantId);
    for (const g of groups) {
      this.metrics.setAppointmentsTotal({
        tenantTop: top,
        status: g.status,
        value: g._count._all,
      });
    }
  }

  private handleUniqueViolation(err: unknown): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'appointment_duplicate',
          message: 'Назначение с такими (personId, roleId, validFrom) уже существует',
        },
      });
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    personId: string;
    roleId: string;
    departmentId: string | null;
    loadPercent: number;
    status: string;
    validFrom: Date;
    validTo: Date | null;
    sourceBlockIds: string[];
    confidence: Prisma.Decimal;
    createdAt: Date;
    updatedAt: Date;
    person?: { id: string; name: string } | null;
    role?: { id: string; name: string } | null;
    department?: { id: string; name: string } | null;
  }): AppointmentDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      personId: row.personId,
      personName: row.person?.name ?? null,
      roleId: row.roleId,
      roleName: row.role?.name ?? null,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      loadPercent: row.loadPercent,
      status: row.status as AppointmentStatus,
      validFrom: row.validFrom.toISOString(),
      validTo: row.validTo ? row.validTo.toISOString() : null,
      sourceBlockIds: row.sourceBlockIds,
      confidence: Number(row.confidence),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
