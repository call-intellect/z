import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Policy, Process, Regulation } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ProbeService } from '../../probe/probe.service';

import { OwnerResolverService } from './owner-resolver.service';

@Injectable()
export class Specialist31ProbeService {
  private readonly logger = new Logger(Specialist31ProbeService.name);

  static readonly SPECIALIST_NAME = '3-1-regulations';

  private static readonly STALE_FRESH_WINDOW_DAYS = 7;
  private static readonly STALE_THRESHOLD_DAYS = 183;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
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
    try {
      await this.checkStale({
        tenantId: reg.tenantId,
        resourceType: 'regulation',
        resourceId: reg.id,
        resourceName: reg.name,
        ownerPersonId: reg.ownerPersonId,
        lastConfirmedAt: reg.lastConfirmedAt,
        sourceBlockIds: reg.sourceBlockIds,
      });
    } catch (err) {
      this.logErr('regulation.stale', reg.id, err);
    }
    try {
      await this.checkScopeUnclear({
        tenantId: reg.tenantId,
        resourceType: 'regulation',
        resourceId: reg.id,
        resourceName: reg.name,
        scope: reg.scope,
        ownerPersonId: reg.ownerPersonId,
        severityHint: null,
      });
    } catch (err) {
      this.logErr('regulation.scope_unclear', reg.id, err);
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
    try {
      await this.checkProcessNoSteps(proc);
    } catch (err) {
      this.logErr('regulation.process_no_steps', proc.id, err);
    }
    try {
      await this.checkStale({
        tenantId: proc.tenantId,
        resourceType: 'process',
        resourceId: proc.id,
        resourceName: proc.name,
        ownerPersonId: proc.ownerPersonId,
        lastConfirmedAt: proc.lastConfirmedAt,
        sourceBlockIds: proc.sourceBlockIds,
      });
    } catch (err) {
      this.logErr('regulation.stale', proc.id, err);
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
    try {
      await this.checkStale({
        tenantId: policy.tenantId,
        resourceType: 'policy',
        resourceId: policy.id,
        resourceName: policy.name,
        ownerPersonId: policy.ownerPersonId,
        lastConfirmedAt: policy.lastConfirmedAt,
        sourceBlockIds: policy.sourceBlockIds,
      });
    } catch (err) {
      this.logErr('regulation.stale', policy.id, err);
    }
    try {
      await this.checkScopeUnclear({
        tenantId: policy.tenantId,
        resourceType: 'policy',
        resourceId: policy.id,
        resourceName: policy.name,
        scope: policy.scope,
        ownerPersonId: policy.ownerPersonId,
        severityHint: policy.severity,
      });
    } catch (err) {
      this.logErr('regulation.scope_unclear', policy.id, err);
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

    const admins = await this.findOrgAdminsUserIds(args.tenantId);
    if (admins.length === 0) return;

    const label = this.kindLabel(args.resourceType);

    if (this.ownerResolver) {
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
            return;
          }
          if (assigned === 'already_assigned') {
            return;
          }
        } else if (resolution.kind === 'ambiguous') {
          this.metrics.incOwnerResolution({ outcome: 'ambiguous' });
          const names = await this.personNamesByUserIds(args.tenantId, resolution.candidates);
          if (names.length >= 2) {
            const message = `У ${label} «${args.resourceName}» нет ответственного. Кого назначить владельцем: ${names.join(' или ')}?`;
            await this.emit({
              tenantId: args.tenantId,
              resourceType: args.resourceType,
              resourceId: args.resourceId,
              reason: 'regulation.missing_owner',
              message,
              objectName: args.resourceName,
              recipients: admins,
              suggestedActions: ['Назначить ответственного', 'Архивировать'],
            });
            return;
          }
        } else {
          this.metrics.incOwnerResolution({ outcome: 'none' });
        }
      } catch (err) {
        this.logger.warn(
          {
            resourceId: args.resourceId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-1 probe: owner-resolver упал — fallback на probe',
        );
      }
    }

    const message = `У ${label} «${args.resourceName}» нет ответственного — назначить владельца?`;
    await this.emit({
      tenantId: args.tenantId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      reason: 'regulation.missing_owner',
      message,
      objectName: args.resourceName,
      recipients: admins,
      suggestedActions: ['Назначить ответственного', 'Архивировать'],
    });
  }

  private async checkProcessNoSteps(proc: Process): Promise<void> {
    if (proc.status !== 'active') return;
    const steps = await this.prisma.processStep.count({
      where: { processId: proc.id, tenantId: proc.tenantId },
    });
    if (steps > 0) return;

    const recipients = await this.resolveOwnerAndAdmins({
      tenantId: proc.tenantId,
      ownerPersonId: proc.ownerPersonId,
    });
    if (recipients.length === 0) return;

    const message = `Процесс «${proc.name}» зафиксирован, но шаги не описаны — добавить структуру?`;
    await this.emit({
      tenantId: proc.tenantId,
      resourceType: 'process',
      resourceId: proc.id,
      reason: 'regulation.process_no_steps',
      message,
      objectName: proc.name,
      recipients,
      suggestedActions: ['Добавить шаги процесса', 'Описать вручную'],
    });
  }

  private async checkStale(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    resourceName: string;
    ownerPersonId: string | null;
    lastConfirmedAt: Date | null;
    sourceBlockIds: string[];
  }): Promise<void> {
    if (!args.lastConfirmedAt) return;
    const ageDays = (Date.now() - args.lastConfirmedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < Specialist31ProbeService.STALE_THRESHOLD_DAYS) return;
    if (args.sourceBlockIds.length === 0) return;

    const freshSince = new Date(
      Date.now() - Specialist31ProbeService.STALE_FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const freshBlock = await this.prisma.ideaBlock.findFirst({
      where: {
        id: { in: args.sourceBlockIds },
        tenantId: args.tenantId,
        createdAt: { gte: freshSince },
      },
      select: { id: true },
    });
    if (!freshBlock) return;

    const recipients = await this.resolveOwnerAndAdmins({
      tenantId: args.tenantId,
      ownerPersonId: args.ownerPersonId,
    });
    if (recipients.length === 0) return;

    const label = this.kindLabel(args.resourceType);
    const message = `${label} «${args.resourceName}» давно не подтверждался(ась), а появились свежие материалы. Подтвердить актуальность?`;
    await this.emit({
      tenantId: args.tenantId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      reason: 'regulation.stale',
      message,
      objectName: args.resourceName,
      recipients,
      suggestedActions: ['Подтвердить актуальность', 'Обновить вручную'],
    });
  }

  private async checkScopeUnclear(args: {
    tenantId: string;
    resourceType: 'regulation' | 'policy';
    resourceId: string;
    resourceName: string;
    scope: string | null;
    ownerPersonId: string | null;
    severityHint: string | null;
  }): Promise<void> {
    if (args.scope) return;
    if (
      args.resourceType === 'policy' &&
      args.severityHint !== 'mandatory' &&
      args.severityHint !== 'blocking'
    ) {
      return;
    }
    const admins = await this.findOrgAdminsUserIds(args.tenantId);
    if (admins.length === 0) return;

    const label = this.kindLabel(args.resourceType);
    const message = `Не указана область действия ${label} «${args.resourceName}». На кого распространяется — на всех, на отдел или на роль?`;
    await this.emit({
      tenantId: args.tenantId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      reason: 'regulation.scope_unclear',
      message,
      objectName: args.resourceName,
      recipients: admins,
      suggestedActions: ['Указать область действия', 'Сузить до отдела/роли'],
    });
  }

  private async emit(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    reason: string;
    message: string;
    objectName: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
  }): Promise<void> {
    const actionUrl = `/regulations/${args.resourceId}?kind=${args.resourceType}`;
    if (this.probeService) {
      try {
        await this.probeService.suggest({
          tenantId: args.tenantId,
          emittedByService: Specialist31ProbeService.SPECIALIST_NAME,
          reason: args.reason,
          payload: {
            message: args.message,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            contextCardId: args.resourceId,
            contextCardKind: args.resourceType,
            contextCardTitle: args.objectName.slice(0, 100),
            objectName: args.objectName,
            objectKindRu: this.kindLabelNominative(args.resourceType),
            actionUrl,
            dataClass: 'internal',
          },
          recipientCandidates: [...args.recipients],
          priorityHint: 0.5,
          dataClass: 'internal',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: args.resourceType,
          reason: args.reason,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            resourceId: args.resourceId,
            reason: args.reason,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-1 probe: ProbeService.suggest упал — fallback на sendNotification',
        );
      }
    }
    for (const userId of args.recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: userId,
          eventType: 'specialist.probe',
          payload: {
            specialistName: Specialist31ProbeService.SPECIALIST_NAME,
            reason: args.reason,
            message: args.message,
            cardId: args.resourceId,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            actionUrl,
          },
          dataClass: 'internal',
          contextCardId: args.resourceId,
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: args.resourceType,
          reason: args.reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            resourceId: args.resourceId,
            reason: args.reason,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-1 probe: ошибка sendNotification — пропускаю получателя',
        );
      }
    }
  }

  private async findOrgAdminsUserIds(tenantId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
      take: 20,
    });
    return memberships.map((m) => m.userId);
  }

  private async resolveOwnerAndAdmins(args: {
    tenantId: string;
    ownerPersonId: string | null;
  }): Promise<string[]> {
    const ownerUserId = await this.personUserId(args.ownerPersonId);
    const admins = await this.findOrgAdminsUserIds(args.tenantId);
    const recipients = new Set<string>();
    if (ownerUserId) recipients.add(ownerUserId);
    for (const a of admins) recipients.add(a);
    return [...recipients];
  }

  private async personUserId(personId: string | null): Promise<string | null> {
    if (!personId) return null;
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      select: { userId: true },
    });
    return person?.userId ?? null;
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

  private async personNamesByUserIds(
    tenantId: string,
    userIds: readonly string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const persons = await this.prisma.person.findMany({
      where: { tenantId, userId: { in: [...userIds] }, deletedAt: null },
      select: { name: true },
      take: 10,
    });
    return persons.map((p) => p.name).filter((n) => n.length > 0);
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

  private kindLabelNominative(
    kind: 'regulation' | 'process' | 'policy',
  ): string {
    switch (kind) {
      case 'regulation':
        return 'регламент';
      case 'process':
        return 'процесс';
      case 'policy':
        return 'политика';
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
