import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { ExecutablePersonaBuildService } from './executable-persona-build.service';

export interface RoleBearerChangedEvent {
  tenantId: string;
  roleId: string;
  oldPersonId: string | null;
  newPersonId: string | null;
  changedAt: Date;
}

@Injectable()
export class RoleClonePersonaVersioningHandler {
  private readonly logger = new Logger(RoleClonePersonaVersioningHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ExecutablePersonaBuildService)
    private readonly builder: ExecutablePersonaBuildService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  @OnEvent('role.bearer_changed', { async: true })
  async onBearerChanged(event: RoleBearerChangedEvent): Promise<void> {
    try {
      await this.handle(event);
    } catch (err) {
      this.logger.warn(
        {
          roleId: event.roleId,
          tenantId: event.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role.bearer_changed: handler упал — skip (cron доберёт)',
      );
    }
  }

  async handle(event: RoleBearerChangedEvent): Promise<string | null> {
    const role = await this.prisma.role.findUnique({
      where: { id: event.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== event.tenantId) {
      this.logger.debug(
        { roleId: event.roleId },
        'role.bearer_changed: Role не найден / удалён / иной tenant — skip',
      );
      return null;
    }

    const prevActive = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: event.tenantId,
        scope: 'role',
        scopeRefId: event.roleId,
        status: 'active',
      },
      orderBy: [{ roleVersion: 'desc' }, { snapshotAt: 'desc' }],
      select: { id: true, currentBearerPersonId: true },
    });

    if (
      prevActive &&
      event.newPersonId !== null &&
      prevActive.currentBearerPersonId === event.newPersonId
    ) {
      this.logger.debug(
        { roleId: event.roleId, newPersonId: event.newPersonId },
        'role.bearer_changed: active persona уже указывает на newPersonId — skip',
      );
      return null;
    }

    if (event.newPersonId === null) {
      if (prevActive) {
        await this.prisma.executablePersona.updateMany({
          where: { id: prevActive.id, status: 'active' },
          data: { status: 'frozen' },
        });
        this.logger.log(
          {
            roleId: event.roleId,
            roleName: role.name,
            frozenPersonaId: prevActive.id,
          },
          'role.bearer_changed: роль освободилась — текущий клон заморожен (frozen, остаётся доступным)',
        );
      }
      return prevActive?.id ?? null;
    }

    const built = await this.builder.buildForRole({
      tenantId: event.tenantId,
      roleId: event.roleId,
      bearerPersonId: event.newPersonId,
      triggerReason: 'on_demand',
      triggerEventAt: event.changedAt,
    });
    if (built) {
      this.metrics?.incCloneRoleVersionCreated({ roleId: event.roleId });
      this.logger.log(
        {
          roleId: event.roleId,
          roleName: role.name,
          oldPersonId: event.oldPersonId,
          newPersonId: event.newPersonId,
          personaId: built.id,
          roleVersion: built.roleVersion,
        },
        'role.bearer_changed: создана новая active-версия клона роли',
      );
    } else {
      this.logger.debug(
        { roleId: event.roleId, newPersonId: event.newPersonId },
        'role.bearer_changed: buildForRole вернул null (мало traits) — прошлый клон остаётся доступным, cron доберёт',
      );
    }
    return built?.id ?? null;
  }

  private _placeholder(_p: Prisma.ExecutablePersonaWhereInput): void {}
}
