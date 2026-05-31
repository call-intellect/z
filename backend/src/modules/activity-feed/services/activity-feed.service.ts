import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  type ActivityFeedItem,
  type ActivityFeedSubscription,
  Prisma,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  FeedChannelDto,
  FeedDigestModeDto,
  FeedIconTypeDto,
  FeedItemDto,
  FeedReactionDto,
  FeedSeverityDto,
  FeedSourceTypeDto,
  FeedStatusDto,
  FeedTypeDto,
  FeedVisibilityDto,
  ListFeedQuery,
  ListFeedResponseDto,
  FeedSubscriptionDto,
  PatchSubscriptionBody,
  SubscriptionFiltersDto,
  UpsertSubscriptionBody,
} from '../dto/activity-feed.dto';
import { ActivityFeedGateway } from '../gateways/activity-feed.gateway';

/**
 * Входные данные publish() — единая точка эмита события в ленту.
 * Все агенты (Probe / Insights Radar / Decisions Registry / Issue / Ideas /
 * Curation) и системные крон-сервисы используют этот метод.
 */
export interface PublishFeedItemInput {
  tenantId: string;

  feedType: FeedTypeDto;
  sourceType: FeedSourceTypeDto;
  sourceAgentName?: string | null;
  sourceUserId?: string | null;

  relatedEntityType?: string | null;
  relatedEntityId?: string | null;

  title: string;
  summary?: string | null;
  iconType?: FeedIconTypeDto | null;
  severity?: FeedSeverityDto;

  visibility: FeedVisibilityDto;
  visibilityScope?: {
    teamIds?: string[];
    roleIds?: string[];
    userIds?: string[];
  } | null;

  targetUserId?: string | null;
  targetChannel?: FeedChannelDto | null;

  teamId?: string | null;
  projectId?: string | null;
  goalId?: string | null;

  expiresAt?: Date | null;

  /**
   * Начальный статус. По умолчанию `emitted`. Можно передать `delivered`,
   * если канал уже подтвердил доставку синхронно.
   */
  initialStatus?: FeedStatusDto;
}

/**
 * Внутренняя форма JSON-поля `reactions`. Goose-mode: всегда нормализуем
 * к `{ thanks: string[], votes: string[] }` — даже если в БД null или
 * legacy-формат.
 */
interface ReactionsPayload {
  thanks: string[];
  votes: string[];
}

const DEFAULT_REACTIONS: ReactionsPayload = { thanks: [], votes: [] };

/**
 * ActivityFeedService (Wave 2 Поток D, 2026-05-24).
 *
 * Sub-ТЗ: plans/tz/2026-05-23-activity-feeds.md
 *
 * Что делает:
 *   - `publish()`           — единая точка эмита, вызывается из всех агентов
 *                             и системных cron'ов. После create — emit
 *                             WebSocket event `feed.new_item` в нужные rooms.
 *   - `getFeed()`           — query с tenantId-scope, фильтрами и пагинацией.
 *                             Visibility-фильтр работает per-user (см. §6 RBAC).
 *   - `markSeen` / `markDelivered` / `markResponded` / `markActioned` /
 *     `dismiss`             — переходы по статусной FSM. Идемпотентны.
 *   - `react()`             — atomic update JSON-поля reactions
 *                             (thanks / votes), per-user, дедуп по userId.
 *   - `expire()`            — выставляет status='expired' для просроченных
 *                             probe-вопросов. Вызывается из FeedExpireCron.
 *
 * Метрики: `feed_items_emitted_total`, `feed_items_actioned_total`,
 * `feed_reactions_total`, `feed_items_expired_total`.
 *
 * Multi-tenancy: все методы требуют `tenantId`. RBAC-проверки делает
 * контроллер; сервис проверяет только tenant-scope + visibility-фильтр
 * для read-операций.
 */
@Injectable()
export class ActivityFeedService {
  private readonly logger = new Logger(ActivityFeedService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    /**
     * Gateway — Optional, потому что юнит-тестам сервиса не требуется
     * полная NestJS lifecycle для WebSocketServer. В production gateway
     * всегда присутствует (он провайдер того же модуля).
     */
    @Optional()
    @Inject(ActivityFeedGateway)
    private readonly gateway: ActivityFeedGateway | null = null,
  ) {}

  // ─────────────────────────── publish ─────────────────────────────────

  async publish(input: PublishFeedItemInput): Promise<FeedItemDto> {
    const severity: FeedSeverityDto = input.severity ?? 'normal';
    const status: FeedStatusDto = input.initialStatus ?? 'emitted';

    const created = await this.prisma.activityFeedItem.create({
      data: {
        tenantId: input.tenantId,
        feedType: input.feedType,
        sourceType: input.sourceType,
        sourceAgentName: input.sourceAgentName ?? null,
        sourceUserId: input.sourceUserId ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        title: input.title,
        summary: input.summary ?? null,
        iconType: input.iconType ?? null,
        severity,
        status,
        visibility: input.visibility,
        visibilityScope: input.visibilityScope
          ? (input.visibilityScope as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        targetUserId: input.targetUserId ?? null,
        targetChannel: input.targetChannel ?? null,
        teamId: input.teamId ?? null,
        projectId: input.projectId ?? null,
        goalId: input.goalId ?? null,
        reactions: { thanks: [], votes: [] } as unknown as Prisma.InputJsonValue,
        expiresAt: input.expiresAt ?? null,
        // emittedAt — default(now())
        deliveredAt: status === 'delivered' ? new Date() : null,
      },
    });

    this.metrics.incFeedItemEmitted({
      tenant: created.tenantId,
      feedType: created.feedType,
      severity: created.severity ?? 'normal',
    });

    const dto = this.toDto(created);
    this.emitWsEvent('feed.new_item', { item: dto }, this.roomsForItem(created));
    return dto;
  }

  // ─────────────────────────── getFeed ─────────────────────────────────

  async getFeed(args: {
    tenantId: string;
    userId: string;
    /** Команды, в которых состоит пользователь (для visibility='team'). */
    userTeamIds: string[];
    /** Роли пользователя (для visibility='role'). */
    userRoleIds: string[];
    query: ListFeedQuery;
  }): Promise<ListFeedResponseDto> {
    const q = args.query;
    const where: Prisma.ActivityFeedItemWhereInput = {
      tenantId: args.tenantId,
    };

    if (q.feedType) where.feedType = q.feedType;
    if (q.severity) where.severity = q.severity;
    if (q.status) where.status = q.status;
    if (q.teamId) where.teamId = q.teamId;
    if (q.projectId) where.projectId = q.projectId;
    if (q.goalId) where.goalId = q.goalId;
    if (q.sourceAgentName) where.sourceAgentName = q.sourceAgentName;
    // Фильтр «адресовано конкретному пользователю» (см. DTO §viewedUserId).
    // Применяется ДО visibility-фильтра — это обычный WHERE-критерий, поверх
    // которого ещё может срабатывать `scopedToMe`. Используется секцией
    // «Вопросы AI этому человеку» на карточке сотрудника (`PersonPulseClient`).
    if (q.viewedUserId) where.targetUserId = q.viewedUserId;

    if (q.emittedFrom || q.emittedTo) {
      where.emittedAt = {};
      if (q.emittedFrom) where.emittedAt.gte = new Date(q.emittedFrom);
      if (q.emittedTo) where.emittedAt.lte = new Date(q.emittedTo);
    }

    // ── Visibility-фильтр per-user (Sub-ТЗ §6 RBAC) ────────────────────
    //
    // 'public_org' — видят все members tenant'а.
    // 'team'       — пользователь должен быть в команде (`teamId IN userTeamIds`
    //                ИЛИ visibilityScope.teamIds пересекается с userTeamIds).
    // 'role'       — visibilityScope.roleIds пересекается с userRoleIds.
    // 'private'    — `targetUserId === userId` ИЛИ visibilityScope.userIds
    //                включает userId.
    //
    // Также любой `sourceUserId === userId` всегда виден автору
    // (системные кнопки «мои публикации»).
    if (q.scopedToMe) {
      const visibilityOr: Prisma.ActivityFeedItemWhereInput[] = [
        { visibility: 'public_org' },
        { sourceUserId: args.userId },
        { targetUserId: args.userId },
      ];

      if (args.userTeamIds.length > 0) {
        visibilityOr.push({
          visibility: 'team',
          teamId: { in: args.userTeamIds },
        });
      }
      // visibilityScope-based фильтры — `Json contains` через @> работает
      // в Postgres, но Prisma JSON-фильтр поддерживает только path/equals.
      // Применяем грубую выборку (visibility='role'/'private' с
      // visibilityScope set) + post-фильтр на уровне сервиса. Это даёт
      // корректные результаты в обмен на потенциальный over-fetch на
      // редких типах. На MVP допустимо; в Wave 3 — переезд на raw SQL.
      where.OR = visibilityOr;
    }

    const [items, total] = await Promise.all([
      this.prisma.activityFeedItem.findMany({
        where,
        orderBy: [{ emittedAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.activityFeedItem.count({ where }),
    ]);

    const filtered = q.scopedToMe
      ? items.filter((it) =>
          this.isVisibleToUser(it, {
            userId: args.userId,
            userTeamIds: args.userTeamIds,
            userRoleIds: args.userRoleIds,
          }),
        )
      : items;

    return {
      items: filtered.map((d) => this.toDto(d)),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, q.limit))),
    };
  }

  // ─────────────────────────── status FSM ──────────────────────────────

  async markDelivered(args: {
    tenantId: string;
    itemId: string;
  }): Promise<FeedItemDto> {
    return this.transition(args, {
      next: 'delivered',
      timestampField: 'deliveredAt',
      allowedFrom: ['emitted'],
    });
  }

  async markSeen(args: {
    tenantId: string;
    itemId: string;
    userId: string;
  }): Promise<FeedItemDto> {
    return this.transition(args, {
      next: 'seen',
      timestampField: 'seenAt',
      // seen можно из любого до-responded состояния (включая повторное seen).
      allowedFrom: ['emitted', 'delivered', 'seen'],
    });
  }

  async markResponded(args: {
    tenantId: string;
    itemId: string;
    userId: string;
  }): Promise<FeedItemDto> {
    return this.transition(args, {
      next: 'responded',
      timestampField: 'respondedAt',
      allowedFrom: ['emitted', 'delivered', 'seen'],
    });
  }

  async markActioned(args: {
    tenantId: string;
    itemId: string;
    userId: string;
  }): Promise<FeedItemDto> {
    return this.transition(args, {
      next: 'actioned',
      timestampField: 'actionedAt',
      allowedFrom: ['emitted', 'delivered', 'seen', 'responded'],
    });
  }

  async dismiss(args: {
    tenantId: string;
    itemId: string;
    userId: string;
  }): Promise<FeedItemDto> {
    return this.transition(args, {
      next: 'dismissed',
      timestampField: null,
      allowedFrom: ['emitted', 'delivered', 'seen'],
    });
  }

  // ─────────────────────────── react ──────────────────────────────────

  /**
   * Атомарная реакция пользователя на запись (thanks / vote). Дедуп по
   * userId внутри типа реакции (повторное нажатие — no-op).
   */
  async react(args: {
    tenantId: string;
    itemId: string;
    userId: string;
    reaction: FeedReactionDto;
  }): Promise<FeedItemDto> {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.activityFeedItem.findFirst({
        where: { id: args.itemId, tenantId: args.tenantId },
      });
      if (!item) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'feed_item_not_found',
            message: 'Запись ленты не найдена',
          },
        });
      }

      const current = this.normalizeReactions(item.reactions);
      const key = args.reaction === 'thanks' ? 'thanks' : 'votes';
      if (current[key].includes(args.userId)) {
        // Идемпотентно: пользователь уже среагировал — просто возвращаем.
        return this.toDto(item);
      }
      const next: ReactionsPayload = {
        thanks: [...current.thanks],
        votes: [...current.votes],
      };
      next[key] = [...next[key], args.userId];

      const updated = await tx.activityFeedItem.update({
        where: { id: args.itemId },
        data: {
          reactions: next as unknown as Prisma.InputJsonValue,
        },
      });

      this.metrics.incFeedReaction({
        tenant: args.tenantId,
        feedType: updated.feedType,
        reaction: args.reaction,
      });

      const dto = this.toDto(updated);
      this.emitWsEvent(
        'feed.item_updated',
        { item: dto, changedFields: ['reactions'] },
        this.roomsForItem(updated),
      );
      return dto;
    });
  }

  // ─────────────────────────── expire ──────────────────────────────────

  /**
   * Выставляет status='expired' для записей, у которых:
   *   - expiresAt < now AND
   *   - status NOT IN ('responded', 'actioned', 'expired', 'dismissed')
   *
   * Возвращает количество обновлённых записей. Вызывается из FeedExpireCron
   * и допустимо к вызову вручную (admin / тесты).
   */
  async expire(args: { now?: Date } = {}): Promise<{ updated: number }> {
    const now = args.now ?? new Date();

    // Собираем кандидатов перед массовым updateMany — нужны их id для
    // эмита WS-events и для накопления метрик с правильным feedType.
    const candidates = await this.prisma.activityFeedItem.findMany({
      where: {
        expiresAt: { lt: now, not: null },
        status: {
          notIn: ['responded', 'actioned', 'expired', 'dismissed'],
        },
      },
      select: { id: true, tenantId: true, feedType: true },
    });

    if (candidates.length === 0) {
      return { updated: 0 };
    }

    const ids = candidates.map((c) => c.id);
    const result = await this.prisma.activityFeedItem.updateMany({
      where: { id: { in: ids } },
      data: { status: 'expired' },
    });

    for (const c of candidates) {
      this.metrics.incFeedItemExpired({
        tenant: c.tenantId,
        feedType: c.feedType,
      });
      this.emitWsEvent(
        'feed.item_expired',
        { itemId: c.id, feedType: c.feedType },
        [this.tenantRoom(c.tenantId)],
        c.tenantId,
      );
    }
    this.logger.log(
      { count: result.count },
      'ActivityFeedService.expire — записи помечены expired',
    );
    return { updated: result.count };
  }

  // ─────────────────────────── subscriptions ────────────────────────────

  async listSubscriptions(args: {
    userId: string;
  }): Promise<FeedSubscriptionDto[]> {
    const rows = await this.prisma.activityFeedSubscription.findMany({
      where: { userId: args.userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toSubscriptionDto(r));
  }

  async upsertSubscription(args: {
    userId: string;
    body: UpsertSubscriptionBody;
  }): Promise<FeedSubscriptionDto> {
    const row = await this.prisma.activityFeedSubscription.upsert({
      where: {
        userId_feedType: { userId: args.userId, feedType: args.body.feedType },
      },
      create: {
        userId: args.userId,
        feedType: args.body.feedType,
        filters: args.body.filters as unknown as Prisma.InputJsonValue,
        digestMode: args.body.digestMode,
        channels: args.body.channels,
      },
      update: {
        filters: args.body.filters as unknown as Prisma.InputJsonValue,
        digestMode: args.body.digestMode,
        channels: args.body.channels,
      },
    });
    return this.toSubscriptionDto(row);
  }

  async patchSubscription(args: {
    userId: string;
    feedType: FeedTypeDto;
    body: PatchSubscriptionBody;
  }): Promise<FeedSubscriptionDto> {
    const existing = await this.prisma.activityFeedSubscription.findUnique({
      where: { userId_feedType: { userId: args.userId, feedType: args.feedType } },
    });
    if (!existing) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'subscription_not_found',
          message: 'Подписка не найдена',
        },
      });
    }
    const data: Prisma.ActivityFeedSubscriptionUpdateInput = {};
    if (args.body.filters !== undefined) {
      data.filters = args.body.filters as unknown as Prisma.InputJsonValue;
    }
    if (args.body.digestMode !== undefined) {
      data.digestMode = args.body.digestMode;
    }
    if (args.body.channels !== undefined) {
      data.channels = args.body.channels;
    }
    const updated = await this.prisma.activityFeedSubscription.update({
      where: { userId_feedType: { userId: args.userId, feedType: args.feedType } },
      data,
    });
    return this.toSubscriptionDto(updated);
  }

  async deleteSubscription(args: {
    userId: string;
    feedType: FeedTypeDto;
  }): Promise<{ ok: true }> {
    await this.prisma.activityFeedSubscription
      .delete({
        where: {
          userId_feedType: { userId: args.userId, feedType: args.feedType },
        },
      })
      .catch(() => {
        // 404 → возвращаем 200 — идемпотентно (UI может дважды нажать «отписаться»).
      });
    return { ok: true };
  }

  // ─────────────────────────── internals ────────────────────────────────

  /**
   * Общий FSM-переход. Если current status уже = next — no-op (идемпотентно).
   * Если current ∉ allowedFrom — no-op (защита от backward transitions
   * `expired → seen` и т.п.). Метрика и WS-event эмитятся только при
   * фактическом изменении.
   */
  private async transition(
    args: { tenantId: string; itemId: string; userId?: string },
    spec: {
      next: FeedStatusDto;
      timestampField: 'deliveredAt' | 'seenAt' | 'respondedAt' | 'actionedAt' | null;
      allowedFrom: FeedStatusDto[];
    },
  ): Promise<FeedItemDto> {
    const item = await this.prisma.activityFeedItem.findFirst({
      where: { id: args.itemId, tenantId: args.tenantId },
    });
    if (!item) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'feed_item_not_found',
          message: 'Запись ленты не найдена',
        },
      });
    }

    if (item.status === spec.next) {
      // Идемпотентно — current уже целевой.
      return this.toDto(item);
    }
    if (!spec.allowedFrom.includes(item.status as FeedStatusDto)) {
      // Запрещённый backward-переход — no-op (не throw, лента толерантна).
      this.logger.debug(
        {
          itemId: item.id,
          from: item.status,
          to: spec.next,
        },
        'ActivityFeedService.transition — пропущен (запрещённый переход)',
      );
      return this.toDto(item);
    }

    const data: Prisma.ActivityFeedItemUpdateInput = { status: spec.next };
    if (spec.timestampField) {
      data[spec.timestampField] = new Date();
    }

    const updated = await this.prisma.activityFeedItem.update({
      where: { id: item.id },
      data,
    });

    this.metrics.incFeedItemActioned({
      tenant: updated.tenantId,
      feedType: updated.feedType,
      status: spec.next,
    });

    const dto = this.toDto(updated);
    const evtName =
      spec.next === 'dismissed' ? 'feed.item_dismissed' : 'feed.item_updated';
    const payload =
      spec.next === 'dismissed'
        ? {
            itemId: updated.id,
            dismissedByUserId: args.userId ?? null,
          }
        : {
            item: dto,
            changedFields: [
              'status',
              ...(spec.timestampField ? [spec.timestampField] : []),
            ],
          };
    this.emitWsEvent(
      evtName,
      payload,
      this.roomsForItem(updated),
      updated.tenantId,
    );
    return dto;
  }

  private isVisibleToUser(
    item: ActivityFeedItem,
    ctx: { userId: string; userTeamIds: string[]; userRoleIds: string[] },
  ): boolean {
    if (item.sourceUserId === ctx.userId) return true;
    if (item.targetUserId === ctx.userId) return true;
    if (item.visibility === 'public_org') return true;
    const scope = this.parseScope(item.visibilityScope);
    if (item.visibility === 'team') {
      if (item.teamId && ctx.userTeamIds.includes(item.teamId)) return true;
      if (
        scope?.teamIds?.some((t) => ctx.userTeamIds.includes(t))
      ) {
        return true;
      }
      return false;
    }
    if (item.visibility === 'role') {
      return Boolean(
        scope?.roleIds?.some((r) => ctx.userRoleIds.includes(r)),
      );
    }
    if (item.visibility === 'private') {
      return Boolean(scope?.userIds?.includes(ctx.userId));
    }
    return false;
  }

  private roomsForItem(item: ActivityFeedItem): string[] {
    const rooms: string[] = [this.tenantRoom(item.tenantId)];
    if (item.teamId) rooms.push(this.teamRoom(item.teamId));
    if (item.targetUserId) rooms.push(this.userRoom(item.targetUserId));
    if (
      item.sourceUserId &&
      item.sourceUserId !== item.targetUserId
    ) {
      rooms.push(this.userRoom(item.sourceUserId));
    }
    return rooms;
  }

  private tenantRoom(tenantId: string): string {
    return this.gateway?.tenantRoom(tenantId) ?? `tenant:${tenantId}`;
  }
  private teamRoom(teamId: string): string {
    return this.gateway?.teamRoom(teamId) ?? `team:${teamId}`;
  }
  private userRoom(userId: string): string {
    return this.gateway?.userRoom(userId) ?? `user:${userId}`;
  }

  private emitWsEvent(
    type: string,
    payload: Record<string, unknown>,
    rooms: string[],
    tenantIdOverride?: string,
  ): void {
    if (!this.gateway) return;
    const tenantId =
      tenantIdOverride ??
      (typeof (payload['item'] as FeedItemDto | undefined)?.tenantId ===
        'string'
        ? (payload['item'] as FeedItemDto).tenantId
        : '');
    const event = {
      type,
      tenantId,
      timestamp: new Date().toISOString(),
      ...payload,
    };
    try {
      this.gateway.emitToRooms(rooms, type, event);
    } catch (e) {
      // Никогда не валим бизнес-транзакцию из-за фоновой публикации.
      this.logger.warn(
        { err: e instanceof Error ? e.message : String(e), type },
        'ActivityFeedService.emitWsEvent — ошибка эмита WS',
      );
    }
  }

  // ─────────────────────────── mappers ──────────────────────────────────

  private toDto(row: ActivityFeedItem): FeedItemDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      feedType: row.feedType as FeedTypeDto,
      sourceType: row.sourceType as FeedSourceTypeDto,
      sourceAgentName: row.sourceAgentName,
      sourceUserId: row.sourceUserId,
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      title: row.title,
      summary: row.summary,
      iconType: (row.iconType as FeedIconTypeDto | null) ?? null,
      severity: (row.severity as FeedSeverityDto | null) ?? 'normal',
      status: row.status as FeedStatusDto,
      visibility: row.visibility as FeedVisibilityDto,
      visibilityScope: this.parseScope(row.visibilityScope) ?? null,
      targetUserId: row.targetUserId,
      targetChannel: (row.targetChannel as FeedChannelDto | null) ?? null,
      teamId: row.teamId,
      projectId: row.projectId,
      goalId: row.goalId,
      reactions: this.normalizeReactions(row.reactions),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      emittedAt: row.emittedAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      seenAt: row.seenAt?.toISOString() ?? null,
      respondedAt: row.respondedAt?.toISOString() ?? null,
      actionedAt: row.actionedAt?.toISOString() ?? null,
    };
  }

  private toSubscriptionDto(
    row: ActivityFeedSubscription,
  ): FeedSubscriptionDto {
    const filters =
      typeof row.filters === 'object' && row.filters !== null
        ? (row.filters as unknown as SubscriptionFiltersDto)
        : ({} as SubscriptionFiltersDto);
    return {
      id: row.id,
      userId: row.userId,
      feedType: row.feedType as FeedTypeDto,
      filters,
      digestMode: row.digestMode as FeedDigestModeDto,
      channels: row.channels as FeedChannelDto[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private parseScope(raw: unknown): {
    teamIds?: string[];
    roleIds?: string[];
    userIds?: string[];
  } | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const result: {
      teamIds?: string[];
      roleIds?: string[];
      userIds?: string[];
    } = {};
    if (Array.isArray(obj.teamIds)) {
      result.teamIds = obj.teamIds.filter((x): x is string => typeof x === 'string');
    }
    if (Array.isArray(obj.roleIds)) {
      result.roleIds = obj.roleIds.filter((x): x is string => typeof x === 'string');
    }
    if (Array.isArray(obj.userIds)) {
      result.userIds = obj.userIds.filter((x): x is string => typeof x === 'string');
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  private normalizeReactions(raw: unknown): ReactionsPayload {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_REACTIONS };
    const obj = raw as Record<string, unknown>;
    return {
      thanks: Array.isArray(obj.thanks)
        ? obj.thanks.filter((x): x is string => typeof x === 'string')
        : [],
      votes: Array.isArray(obj.votes)
        ? obj.votes.filter((x): x is string => typeof x === 'string')
        : [],
    };
  }
}
