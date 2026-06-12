import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Card } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityFeedService } from '../../activity-feed/services/activity-feed.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ProbeService } from '../../probe/probe.service';

import { OwnerResolverService } from './owner-resolver.service';

/**
 * SBA α-6 — Specialist34ProbeService.
 *
 * Эмиссия probe-events специалиста 3.4 (Project / Customer Context) согласно
 * §5.4 контракта зонтичного. До появления `ProbeService` в β-5 специалист
 * сам отправляет нотификации через `ConversationalService.sendNotification`
 * с `eventType='specialist.probe'`. После β-5 этот сервис превратится
 * в тонкую обёртку над `probe.suggest()`.
 *
 * 4 trigger'а из sub-TZ §5:
 *   - `card.missing_owner` — Card.kind ∈ {client,vendor,project} И owner некорректен
 *     или такой роли нет в Org. (В текущей модели Card.ownerId — обязателен,
 *     но это owner-creator карточки. «Назначенный ответственный» хранится
 *     отдельно через Card.metadata.ownerUserId — поле появится в β-/γ-.
 *     Пока эвристика: смотрим Membership ownerId в Org. Если creator
 *     уволился (нет активного Membership) → probe.)
 *   - `card.missing_deadline` — Card.kind='project' И в summaryCache нет
 *     явно упомянутой даты-дедлайна И возраст карточки > 7 дней.
 *   - `card.merge_suggestion` — найдены 2+ Card'ы того же tenant'а с
 *     одинаковым `entityId`. Это вырожденный случай (entityId должен быть
 *     уникален в графе), но возможен после reframing'а.
 *   - `card.outdated_summary` — `lastConfirmedAt` старше 6 месяцев И
 *     за последнюю неделю появились новые блоки-источники.
 *
 * Получатели:
 *   - owner Card (User) — всегда первый кандидат.
 *   - admin'ы Org — для `card.missing_owner` и `card.merge_suggestion`.
 *
 * Контракт: сервис НЕ должен бросать. Один упавший probe не валит остальные —
 * лог и продолжение. Каждый успешно отправленный probe увеличивает
 * `core_specialist_probe_events_total{type='card', reason='...'}`.
 */
@Injectable()
export class Specialist34ProbeService {
  private readonly logger = new Logger(Specialist34ProbeService.name);

  static readonly SPECIALIST_NAME = '3-4-project-customer';

  /** Возраст карточки для probe `card.missing_deadline`. */
  private static readonly MISSING_DEADLINE_AGE_DAYS = 7;
  /** Порог «устарела» для probe `card.outdated_summary`. */
  private static readonly OUTDATED_SUMMARY_AGE_DAYS = 183; // ~6 месяцев
  /** Окно «новые блоки появились» для probe `card.outdated_summary`. */
  private static readonly OUTDATED_SUMMARY_FRESH_WINDOW_DAYS = 7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional() @Inject(ProbeService)
    private readonly probeService?: ProbeService,
    // W2 autonomy (2026-06-12) — «лестница владельца» + лента «что сделала
    // Кора». Optional: без них работает прежнее поведение (probe).
    @Optional() @Inject(OwnerResolverService)
    private readonly ownerResolver?: OwnerResolverService,
    @Optional() @Inject(ActivityFeedService)
    private readonly activityFeed?: ActivityFeedService,
  ) {}

  /**
   * Главный метод: вызывается из CardRollupV2Service после успешного rollup'а
   * (или из cron'а, который обходит карточки). Best-effort: не бросает.
   */
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

  // ──────────────────────────── triggers ────────────────────────────

  /**
   * `card.missing_owner` — Card.kind ∈ {client,vendor,project} AND owner-creator
   * не имеет активного Membership в Org (уволился) ИЛИ owner-creator
   * совпадает с system-user (что означает, что назначенный ответственный
   * не задан).
   *
   * NB: поле «назначенный ответственный» (Card.metadata.ownerUserId)
   * появится в β-/γ-. Сейчас эвристика только по ownerId-creator.
   */
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

    // Кандидаты-получатели: admin'ы Org.
    const admins = await this.findOrgAdminsAndOwner(card.tenantId);
    if (admins.length === 0) return;

    // W2 autonomy (2026-06-12) — «лестница владельца» ДО probe. Прямое поле
    // владельца — Card.ownerId (userId). Автор = ownerId-creator — это и есть
    // уволившийся, в лестницу его НЕ кладём. Кандидаты — subject-Person'ы
    // карточки с активным Membership: единственный → Кора переназначает сама;
    // несколько → вопрос-выбор с именами; никого → probe как раньше.
    const ladder = await this.tryResolveOwner(card);
    if (ladder.outcome === 'auto') return;
    const message =
      ladder.outcome === 'ambiguous'
        ? `У карточки «${card.name}» (${this.kindLabel(card.kind)}) нет активного ответственного. Кого назначить ответственным: ${ladder.candidateNames.join(' или ')}?`
        : `У карточки «${card.name}» (${this.kindLabel(card.kind)}) нет активного ответственного — кто-то из команды возьмёт?`;
    await this.emit({
      tenantId: card.tenantId,
      cardId: card.id,
      reason: 'card.missing_owner',
      message,
      recipients: admins,
      suggestedActions: ['Назначить ответственного', 'Архивировать карточку'],
    });
  }

  /**
   * W2 autonomy — лестница владельца для `card.missing_owner`.
   * Кандидаты: subject-Person'ы карточки (`personSubjectIds`) с привязанным
   * User И активным Membership в Org (проблема как раз в неактивном владельце).
   * admin'ов в пул не кладём — в Org с одним admin'ом все бесхозные карточки
   * молча падали бы на него.
   */
  private async tryResolveOwner(
    card: Card,
  ): Promise<
    | { outcome: 'auto' }
    | { outcome: 'ambiguous'; candidateNames: string[] }
    | { outcome: 'none' }
  > {
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
        ...new Set(
          subjects.map((p) => p.userId).filter((u): u is string => !!u),
        ),
      ];
      // Только кандидаты с активным Membership (владелец без Membership —
      // и есть исходная проблема).
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
        const updated = await this.prisma.card.updateMany({
          where: { id: card.id, tenantId: card.tenantId },
          data: { ownerId: resolution.userId },
        });
        if (updated.count > 0) {
          this.metrics.incOwnerResolution({ outcome: 'auto' });
          const personName =
            subjects.find((p) => p.userId === resolution.userId)?.name ??
            'участник команды';
          this.logger.log(
            `owner-resolver: Кора назначила ответственного за карточку «${card.name}» — ${personName} (cardId=${card.id})`,
          );
          await this.publishAutoAssignFeed(card, personName);
          return { outcome: 'auto' };
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

  /** Запись в ленту «что сделала Кора» — best-effort. */
  private async publishAutoAssignFeed(
    card: Card,
    personName: string,
  ): Promise<void> {
    if (!this.activityFeed || !card.tenantId) return;
    try {
      await this.activityFeed.publish({
        tenantId: card.tenantId,
        feedType: 'knowledge_change',
        sourceType: 'system',
        sourceAgentName: Specialist34ProbeService.SPECIALIST_NAME,
        relatedEntityType: 'card',
        relatedEntityId: card.id,
        title: `Кора назначила ответственного за карточку «${card.name}»: ${personName}`,
        summary:
          'Прежний ответственный больше не в команде; новый выведен автоматически по «лестнице владельца» (единственный активный участник-кандидат).',
        severity: 'normal',
        visibility: 'public_org',
      });
    } catch (err) {
      this.logger.warn(
        {
          cardId: card.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-4 probe: publish в ленту не удался — назначение уже применено',
      );
    }
  }

  /**
   * `card.missing_deadline` — Card.kind='project' AND в summaryCache нет
   * упоминания дедлайна AND возраст > 7 дней.
   */
  private async checkMissingDeadline(card: Card): Promise<void> {
    if (card.kind !== 'project') return;
    if (!card.tenantId) return;
    const ageDays =
      (Date.now() - card.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < Specialist34ProbeService.MISSING_DEADLINE_AGE_DAYS) return;

    if (this.summaryMentionsDeadline(card.summaryCache)) return;

    const message = `У проекта «${card.name}» не указан дедлайн или milestone — добавить?`;
    await this.emit({
      tenantId: card.tenantId,
      cardId: card.id,
      reason: 'card.missing_deadline',
      message,
      recipients: [card.ownerId],
      suggestedActions: ['Указать дедлайн', 'Добавить milestone'],
    });
  }

  /**
   * `card.merge_suggestion` — найдены 2+ Card одного tenant'а с
   * одинаковым `entityId`. Сейчас Card.entityId не unique (потому что
   * legacy без tenant'а имеет много NULL), поэтому ищем явно по
   * `Card.entityId` для текущей карточки.
   */
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
      recipients: admins,
      suggestedActions: ['Слить карточки', 'Оставить отдельно'],
    });
  }

  /**
   * `card.outdated_summary` — `lastConfirmedAt` старше 6 месяцев AND
   * за последнюю неделю появились новые блоки-источники (есть свежие
   * IdeaBlock'и, связанные с entityId или meeting-IDs карточки).
   */
  private async checkOutdatedSummary(card: Card): Promise<void> {
    if (!card.lastConfirmedAt || !card.tenantId) return;
    const ageDays =
      (Date.now() - card.lastConfirmedAt.getTime()) /
      (1000 * 60 * 60 * 24);
    if (ageDays < Specialist34ProbeService.OUTDATED_SUMMARY_AGE_DAYS) return;

    const freshSince = new Date(
      Date.now() -
        Specialist34ProbeService.OUTDATED_SUMMARY_FRESH_WINDOW_DAYS *
          24 *
          60 *
          60 *
          1000,
    );

    const entityIds = [
      ...(card.entityId ? [card.entityId] : []),
      ...card.relatedEntityIds,
    ];
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
      recipients: [card.ownerId],
      suggestedActions: ['Запустить rollup', 'Подтвердить вручную'],
    });
  }

  // ──────────────────────────── helpers ────────────────────────────

  private async emit(args: {
    tenantId: string;
    cardId: string;
    reason: string;
    message: string;
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
            suggestedActions: args.suggestedActions
              ? [...args.suggestedActions]
              : undefined,
            contextCardId: args.cardId,
            contextCardKind: 'card',
            contextCardTitle: args.message.slice(0, 100),
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
            suggestedActions: args.suggestedActions
              ? [...args.suggestedActions]
              : undefined,
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
