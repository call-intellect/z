import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Card } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ProbeService } from '../../probe/probe.service';

import { OwnerResolverService } from './owner-resolver.service';

@Injectable()
export class Specialist34ProbeService {
  private readonly logger = new Logger(Specialist34ProbeService.name);

  static readonly SPECIALIST_NAME = '3-4-project-customer';

  private static readonly MISSING_DEADLINE_AGE_DAYS = 7;
  private static readonly OUTDATED_SUMMARY_AGE_DAYS = 183;
  private static readonly OUTDATED_SUMMARY_FRESH_WINDOW_DAYS = 7;

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
  ) {}

  async checkAndEmitProbes(card: Card): Promise<void> {
    if (card.deletedAt || !card.tenantId) return;

    try {
      await this.checkMissingOwner(card);
    } catch (err) {
      this.logProbeError('card.missing_owner', card.id, err);
    }
    try {
      await this.checkMissingDeadline(card);
    } catch (err) {
      this.logProbeError('card.missing_deadline', card.id, err);
    }
    try {
      await this.checkMergeSuggestion(card);
    } catch (err) {
      this.logProbeError('card.merge_suggestion', card.id, err);
    }
    try {
      await this.checkOutdatedSummary(card);
    } catch (err) {
      this.logProbeError('card.outdated_summary', card.id, err);
    }
  }

  private async checkMissingOwner(card: Card): Promise<void> {
    if (!['client', 'vendor', 'project'].includes(card.kind)) return;
    if (!card.tenantId) return;

    const membership = await this.prisma.membership.findUnique({
      where: {
        orgId_userId: { orgId: card.tenantId, userId: card.ownerId },
      },
      select: { role: true },
    });
    const ownerActive = membership !== null;
    if (ownerActive) return;

    const admins = await this.findOrgAdminsAndOwner(card.tenantId);
    if (admins.length === 0) return;

    const ladder = await this.tryResolveOwner(card);
    let message: string;
    if (ladder.outcome === 'ambiguous' && ladder.candidateNames.length === 1) {
      message = `У карточки «${card.name}» (${this.kindLabel(card.kind)}) нет активного ответственного. Назначить владельцем ${ladder.candidateNames[0]}? Ответьте, кого назначить.`;
    } else if (ladder.outcome === 'ambiguous') {
      message = `У карточки «${card.name}» (${this.kindLabel(card.kind)}) нет активного ответственного. Кого назначить ответственным: ${ladder.candidateNames.join(' или ')}?`;
    } else {
      message = `У карточки «${card.name}» (${this.kindLabel(card.kind)}) нет активного ответственного — кто-то из команды возьмёт?`;
    }
    await this.emit({
      tenantId: card.tenantId,
      cardId: card.id,
      reason: 'card.missing_owner',
      message,
      objectName: card.name,
      objectKindRu: this.kindLabel(card.kind),
      recipients: admins,
      suggestedActions: ['Назначить ответственного', 'Архивировать карточку'],
    });
  }

  private async tryResolveOwner(
    card: Card,
  ): Promise<{ outcome: 'ambiguous'; candidateNames: string[] } | { outcome: 'none' }> {
    if (!this.ownerResolver || !card.tenantId) return { outcome: 'none' };
    try {
      const subjects =
        card.personSubjectIds.length > 0
          ? await this.prisma.person.findMany({
              where: {
                id: { in: card.personSubjectIds },
                tenantId: card.tenantId,
                deletedAt: null,
                userId: { not: null },
              },
              select: { id: true, name: true, userId: true },
              take: 20,
            })
          : [];
      const subjectUserIds = [
        ...new Set(subjects.map((p) => p.userId).filter((u): u is string => !!u)),
      ];
      let candidatePool: string[] = [];
      if (subjectUserIds.length > 0) {
        const activeMembers = await this.prisma.membership.findMany({
          where: { orgId: card.tenantId, userId: { in: subjectUserIds } },
          select: { userId: true },
        });
        const activeSet = new Set(activeMembers.map((m) => m.userId));
        candidatePool = subjectUserIds.filter((u) => activeSet.has(u));
      }
      const resolution = await this.ownerResolver.resolve({
        tenantId: card.tenantId,
        candidatePool,
      });

      if (resolution.kind === 'resolved') {
        const personName = subjects.find((p) => p.userId === resolution.userId)?.name;
        if (personName && personName.length > 0) {
          this.metrics.incOwnerResolution({ outcome: 'ambiguous' });
          return { outcome: 'ambiguous', candidateNames: [personName] };
        }
        this.metrics.incOwnerResolution({ outcome: 'none' });
        return { outcome: 'none' };
      }
      if (resolution.kind === 'ambiguous') {
        this.metrics.incOwnerResolution({ outcome: 'ambiguous' });
        const names = subjects
          .filter((p) => p.userId && resolution.candidates.includes(p.userId))
          .map((p) => p.name)
          .filter((n) => n.length > 0);
        if (names.length >= 2) {
          return { outcome: 'ambiguous', candidateNames: names };
        }
        return { outcome: 'none' };
      }
      this.metrics.incOwnerResolution({ outcome: 'none' });
      return { outcome: 'none' };
    } catch (err) {
      this.logProbeError('card.missing_owner.owner_resolver', card.id, err);
      return { outcome: 'none' };
    }
  }

  private async checkMissingDeadline(card: Card): Promise<void> {
    if (card.kind !== 'project') return;
    if (!card.tenantId) return;
    const ageDays = (Date.now() - card.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < Specialist34ProbeService.MISSING_DEADLINE_AGE_DAYS) return;

    if (this.summaryMentionsDeadline(card.summaryCache)) return;

    const message = `У проекта «${card.name}» не указан дедлайн или milestone — добавить?`;
    await this.emit({
      tenantId: card.tenantId,
      cardId: card.id,
      reason: 'card.missing_deadline',
      message,
      objectName: card.name,
      objectKindRu: this.kindLabel(card.kind),
      recipients: [card.ownerId],
      suggestedActions: ['Указать дедлайн', 'Добавить milestone'],
    });
  }

  private async checkMergeSuggestion(card: Card): Promise<void> {
    if (!card.entityId || !card.tenantId) return;
    const others = await this.prisma.card.findMany({
      where: {
        tenantId: card.tenantId,
        entityId: card.entityId,
        deletedAt: null,
        id: { not: card.id },
      },
      select: { id: true, name: true },
      take: 5,
    });
    if (others.length === 0) return;

    const admins = await this.findOrgAdminsAndOwner(card.tenantId);
    if (admins.length === 0) return;

    const peerNames = others.map((o) => `«${o.name}»`).join(', ');
    const message = `Найдены похожие карточки одной сущности: «${card.name}» и ${peerNames}. Слить или оставить отдельно?`;
    await this.emit({
      tenantId: card.tenantId,
      cardId: card.id,
      reason: 'card.merge_suggestion',
      message,
      objectName: card.name,
      objectKindRu: this.kindLabel(card.kind),
      recipients: admins,
      suggestedActions: ['Слить карточки', 'Оставить отдельно'],
    });
  }

  private async checkOutdatedSummary(card: Card): Promise<void> {
    if (!card.lastConfirmedAt || !card.tenantId) return;
    const ageDays = (Date.now() - card.lastConfirmedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < Specialist34ProbeService.OUTDATED_SUMMARY_AGE_DAYS) return;

    const freshSince = new Date(
      Date.now() -
        Specialist34ProbeService.OUTDATED_SUMMARY_FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const entityIds = [...(card.entityId ? [card.entityId] : []), ...card.relatedEntityIds];
    if (entityIds.length === 0) return;

    const freshBlock = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        entityId: { in: entityIds },
        block: {
          tenantId: card.tenantId,
          status: 'canonical',
          createdAt: { gte: freshSince },
        },
      },
      select: { blockId: true },
    });
    if (!freshBlock) return;

    const message = `Карточка «${card.name}» давно не подтверждалась (последнее обновление — ${this.formatDate(card.lastConfirmedAt)}), а по ней появились свежие материалы. Обновить?`;
    await this.emit({
      tenantId: card.tenantId,
      cardId: card.id,
      reason: 'card.outdated_summary',
      message,
      objectName: card.name,
      objectKindRu: this.kindLabel(card.kind),
      recipients: [card.ownerId],
      suggestedActions: ['Запустить rollup', 'Подтвердить вручную'],
    });
  }

  private async emit(args: {
    tenantId: string;
    cardId: string;
    reason: string;
    message: string;
    objectName?: string;
    objectKindRu?: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
  }): Promise<void> {
    const actionUrl = `/cards/${args.cardId}`;
    if (this.probeService) {
      try {
        await this.probeService.suggest({
          tenantId: args.tenantId,
          emittedByService: Specialist34ProbeService.SPECIALIST_NAME,
          reason: args.reason,
          payload: {
            message: args.message,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            contextCardId: args.cardId,
            contextCardKind: 'card',
            contextCardTitle: (args.objectName ?? args.message).slice(0, 100),
            objectName: args.objectName ?? undefined,
            objectKindRu: args.objectKindRu ?? 'карточка',
            actionUrl,
            dataClass: 'internal',
          },
          recipientCandidates: [...args.recipients],
          priorityHint: 0.5,
          dataClass: 'internal',
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'card',
          reason: args.reason,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            cardId: args.cardId,
            reason: args.reason,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-4 probe: ProbeService.suggest упал — fallback',
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
            specialistName: Specialist34ProbeService.SPECIALIST_NAME,
            reason: args.reason,
            message: args.message,
            cardId: args.cardId,
            suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
            actionUrl,
          },
          dataClass: 'internal',
          contextCardId: args.cardId,
        });
        this.metrics.incCoreSpecialistProbeEvent({
          type: 'card',
          reason: args.reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            cardId: args.cardId,
            reason: args.reason,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-4 probe: ошибка sendNotification — пропускаю получателя',
        );
      }
    }
  }

  private async findOrgAdminsAndOwner(tenantId: string): Promise<string[]> {
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

  private summaryMentionsDeadline(summary: string | null): boolean {
    if (!summary) return false;
    const re = /(дедлайн|deadline|milestone|вех[ау]|срок до|к\s+\d|до\s+\d{1,2}[\s.\-/]\d{1,2})/i;
    return re.test(summary);
  }

  private kindLabel(kind: string): string {
    switch (kind) {
      case 'client':
        return 'клиент';
      case 'vendor':
        return 'поставщик';
      case 'project':
        return 'проект';
      case 'deal':
        return 'сделка';
      case 'topic':
        return 'тема';
      default:
        return kind;
    }
  }

  private formatDate(d: Date): string {
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${d.getUTCFullYear()}`;
  }

  private logProbeError(reason: string, cardId: string, err: unknown): void {
    this.logger.warn(
      {
        cardId,
        reason,
        err: err instanceof Error ? err.message : String(err),
      },
      'specialist-3-4 probe: внутренняя ошибка триггера — пропускаю',
    );
  }
}
