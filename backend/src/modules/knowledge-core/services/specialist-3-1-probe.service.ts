import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Policy, Process, Regulation } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';

import { OwnerResolverService } from './owner-resolver.service';

@Injectable()
export class Specialist31ProbeService {
  private readonly logger = new Logger(Specialist31ProbeService.name);

  static readonly SPECIALIST_NAME = '3-1-regulations';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(OwnerResolverService)
    private readonly ownerResolver?: OwnerResolverService,
    @Optional()
    @Inject(ActivityFeedService)
    private readonly activityFeed?: ActivityFeedService,
  ) {}

  async checkAndEmitProbesRegulation(reg: Regulation): Promise<void> {
    try {
      await this.checkMissingOwner({
        tenantId: reg.tenantId,
        resourceType: 'regulation',
        resourceId: reg.id,
        resourceName: reg.name,
        ownerPersonId: reg.ownerPersonId,
        status: reg.status,
        ownerRoleId: null,
        scope: reg.scope,
      });
    } catch (err) {
      this.logErr('regulation.missing_owner', reg.id, err);
    }
  }

  async checkAndEmitProbesProcess(proc: Process): Promise<void> {
    try {
      await this.checkMissingOwner({
        tenantId: proc.tenantId,
        resourceType: 'process',
        resourceId: proc.id,
        resourceName: proc.name,
        ownerPersonId: proc.ownerPersonId,
        status: proc.status,
        ownerRoleId: proc.ownerRoleId,
        scope: proc.scope,
      });
    } catch (err) {
      this.logErr('regulation.missing_owner', proc.id, err);
    }
  }

  async checkAndEmitProbesPolicy(policy: Policy): Promise<void> {
    try {
      await this.checkMissingOwner({
        tenantId: policy.tenantId,
        resourceType: 'policy',
        resourceId: policy.id,
        resourceName: policy.name,
        ownerPersonId: policy.ownerPersonId,
        status: policy.status,
        ownerRoleId: null,
        scope: policy.scope,
      });
    } catch (err) {
      this.logErr('regulation.missing_owner', policy.id, err);
    }
  }

  private async checkMissingOwner(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    resourceName: string;
    ownerPersonId: string | null;
    status: string;
    ownerRoleId?: string | null;
    scope?: string | null;
  }): Promise<void> {
    if (args.ownerPersonId) return;
    if (args.status !== 'active') return;
    if (!this.ownerResolver) return;

    try {
      const roleId = args.ownerRoleId ?? this.roleIdFromScope(args.scope);
      const resolution = await this.ownerResolver.resolve({
        tenantId: args.tenantId,
        parentOwnerUserId: null,
        roleId,
        authorUserId: null,
      });
      if (resolution.kind === 'resolved') {
        const assigned = await this.autoAssignOwner({
          tenantId: args.tenantId,
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          resourceName: args.resourceName,
          userId: resolution.userId,
        });
        if (assigned === 'assigned') {
          this.metrics.incOwnerResolution({ outcome: 'auto' });
        }
        return;
      }
      if (resolution.kind === 'ambiguous') {
        this.metrics.incOwnerResolution({ outcome: 'ambiguous' });
        return;
      }
      this.metrics.incOwnerResolution({ outcome: 'none' });
    } catch (err) {
      this.logger.warn(
        {
          resourceId: args.resourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1 owner-resolver: авто-назначение владельца упало — пропускаю',
      );
    }
  }

  private async autoAssignOwner(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    resourceName: string;
    userId: string;
  }): Promise<'assigned' | 'no_person' | 'already_assigned'> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!person) return 'no_person';

    const where = {
      id: args.resourceId,
      tenantId: args.tenantId,
      ownerPersonId: null,
    };
    const data = { ownerPersonId: person.id };
    let updated: number;
    if (args.resourceType === 'process') {
      updated = (await this.prisma.process.updateMany({ where, data })).count;
    } else if (args.resourceType === 'policy') {
      updated = (await this.prisma.policy.updateMany({ where, data })).count;
    } else {
      updated = (await this.prisma.regulation.updateMany({ where, data })).count;
    }
    if (updated === 0) {
      this.logger.log(
        `owner-resolver: владелец ${this.kindLabel(args.resourceType)} уже назначен параллельно — пропускаю (resourceId=${args.resourceId})`,
      );
      return 'already_assigned';
    }

    const label = this.kindLabel(args.resourceType);
    this.logger.log(
      `owner-resolver: Кора назначила владельца ${label} «${args.resourceName}» — ${person.name} (resourceId=${args.resourceId})`,
    );
    if (this.activityFeed) {
      try {
        await this.activityFeed.publish({
          tenantId: args.tenantId,
          feedType: 'knowledge_change',
          sourceType: 'system',
          sourceAgentName: Specialist31ProbeService.SPECIALIST_NAME,
          relatedEntityType: args.resourceType,
          relatedEntityId: args.resourceId,
          title: `Кора назначила владельца ${label} «${args.resourceName}»: ${person.name}`,
          summary:
            'Владелец выведен автоматически по «лестнице владельца» (единственный действующий держатель роли).',
          severity: 'normal',
          visibility: 'public_org',
        });
      } catch (err) {
        this.logger.warn(
          {
            resourceId: args.resourceId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-1 probe: publish в ленту не удался — назначение уже применено',
        );
      }
    }
    return 'assigned';
  }

  private roleIdFromScope(scope: string | null | undefined): string | null {
    if (!scope) return null;
    if (!scope.startsWith('role:')) return null;
    const roleId = scope.slice('role:'.length).trim();
    return roleId.length > 0 ? roleId : null;
  }

  private kindLabel(kind: 'regulation' | 'process' | 'policy'): string {
    switch (kind) {
      case 'regulation':
        return 'регламента';
      case 'process':
        return 'процесса';
      case 'policy':
        return 'политики';
      default:
        return kind;
    }
  }

  private logErr(reason: string, id: string, err: unknown): void {
    this.logger.warn(
      {
        resourceId: id,
        reason,
        err: err instanceof Error ? err.message : String(err),
      },
      'specialist-3-1 probe: внутренняя ошибка триггера — пропускаю',
    );
  }
}
