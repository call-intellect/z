import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type Channel,
  type ChannelBinding,
  type ChannelKind,
  type DataClass,
  type Notification,
  type NotificationDelivery,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DataClassPolicyService } from '../knowledge-core/services/dataclass-policy.service';

import { ChannelRegistry } from './channel-registry';
import { ConversationalLinkCodeService } from './link-code.service';
import { NotificationBudgetService } from './notification-budget.service';
import { ConversationalQueueService } from './queue/conversational-queue.service';
import type { ConversationalJson, InboundMessage } from './types/channel.types';
import { validateEventPayload } from './types/event-payload.registry';
import {
  type ChannelBindingPreferences,
  ChannelBindingPreferencesSchema,
} from './types/preferences.schema';

const DATA_CLASS_ORDER: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

export interface SendNotificationInput {
  tenantId: string;
  recipientUserId: string;
  eventType: string;
  payload: ConversationalJson;
  dataClass?: DataClass;
  contextBlockId?: string;
  contextCardId?: string;
  expiresAt?: string;
  critical?: boolean;
  preferredChannelKinds?: ChannelKind[];
  subjectPersonId?: string | null;
  priorityTier?: number;
}

const EVENT_TYPE_CHANNEL_POLICY: Record<string, ChannelKind[]> = {
  'chat.new_message': ['in_app', 'telegram_bot', 'max_bot', 'push'],
  'probe.question': ['telegram_bot', 'max_bot', 'in_app'],
  'probe.digest': ['telegram_bot', 'max_bot', 'in_app'],
  'probe.clarify': ['telegram_bot', 'max_bot', 'in_app'],
  'probe.confirm': ['telegram_bot', 'max_bot', 'in_app'],
  'probe.answer_acknowledged': ['telegram_bot', 'max_bot', 'in_app'],
  'curation.pending': ['in_app', 'email_smtp'],
  'system.message': ['in_app', 'email_smtp'],
  'idea.status_changed': ['in_app', 'telegram_bot'],
  'chat.answer': ['in_app', 'telegram_bot', 'max_bot', 'email_smtp'],
  'specialist.probe': ['in_app', 'email_smtp'],
  'proactive.notification': ['in_app', 'telegram_bot', 'max_bot'],
  'operations.weekly_digest': ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
  'operations.daily_digest': ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
  'goals.pulse': ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
  'operations.monthly_recap': ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
  'issue.mention': ['in_app', 'telegram_bot', 'max_bot'],
  'issue.assigned': ['in_app', 'telegram_bot', 'max_bot'],
  'issue.overdue': ['in_app', 'telegram_bot', 'max_bot'],
  'task.closed_for_review': ['in_app', 'telegram_bot', 'max_bot'],
  'event.reminder': ['in_app', 'telegram_bot', 'max_bot'],
  'checkin.ack': ['telegram_bot', 'max_bot', 'in_app'],
  'note.ack': ['in_app', 'telegram_bot', 'max_bot'],
  'actions.reminder': ['telegram_bot', 'max_bot', 'in_app'],
  'meeting.invite': ['telegram_bot', 'email_smtp', 'in_app'],
  'checkin.prompt': ['telegram_bot', 'max_bot', 'in_app'],
  'support.ticket_created': ['telegram_bot', 'email_smtp', 'in_app'],
  'support.ticket_reply': ['telegram_bot', 'email_smtp', 'in_app'],
  'tasks.daily_open': ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
};

const DEFAULT_POLICY: ChannelKind[] = ['in_app'];

export type InboundHandler = (msg: InboundMessage) => Promise<void>;

@Injectable()
export class ConversationalService {
  private readonly logger = new Logger(ConversationalService.name);
  private readonly inboundHandlers = new Map<InboundMessage['type'], InboundHandler[]>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(ConversationalQueueService)
    private readonly queue: ConversationalQueueService,
    @Inject(ConversationalLinkCodeService)
    private readonly linkCode: ConversationalLinkCodeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(NotificationBudgetService)
    private readonly budget?: NotificationBudgetService,
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly policy?: DataClassPolicyService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  async sendNotification(input: SendNotificationInput): Promise<Notification> {
    const payload = this.validatePayload(input.eventType, input.payload);
    const dataClass: DataClass = input.dataClass ?? 'internal';
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_expires_at',
          message: '`expiresAt` должно быть валидной ISO-строкой',
        },
      });
    }

    const notification = await this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        recipientUserId: input.recipientUserId,
        eventType: input.eventType,
        payload: payload as Prisma.InputJsonValue,
        dataClass,
        contextBlockId: input.contextBlockId ?? null,
        contextCardId: input.contextCardId ?? null,
        expiresAt,
        priorityTier: input.priorityTier ?? 2,
        responseStatus:
          input.eventType === 'probe.question' ||
          input.eventType === 'probe.clarify' ||
          input.eventType === 'probe.confirm'
            ? 'pending'
            : null,
      },
    });

    await this.ensureInAppForUser({
      tenantId: input.tenantId,
      userId: input.recipientUserId,
    });
    const bindings = await this.resolveBindings({
      tenantId: input.tenantId,
      userId: input.recipientUserId,
    });

    const policy =
      input.preferredChannelKinds ?? EVENT_TYPE_CHANNEL_POLICY[input.eventType] ?? DEFAULT_POLICY;

    const selected = this.selectBindingsForNotification({
      bindings,
      policy,
      dataClass,
      eventType: input.eventType,
      critical: input.critical === true,
      subjectPersonId: input.subjectPersonId ?? null,
    });

    if (selected.length === 0) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'failed' },
      });
      this.metrics.incConversationalNotification({
        eventType: input.eventType,
        status: 'failed',
      });
      this.logger.warn(
        `sendNotification: ни одного канала для user=${input.recipientUserId} eventType=${input.eventType}; либо in_app не нашёлся, либо все binding'и отвергнуты canEmit (W4.3 dataclass gate)`,
      );
      return { ...notification, status: 'failed' };
    }

    let toDeliver = selected;
    const pushBindings = selected.filter((s) => s.binding.channel.kind !== 'in_app');
    if (this.budget && pushBindings.length > 0) {
      const consume = await this.budget.tryConsume({
        tenantId: input.tenantId,
        recipientUserId: input.recipientUserId,
        eventType: input.eventType,
        priorityTier: input.priorityTier ?? 2,
        critical: input.critical === true,
      });
      if (!consume.allowed) {
        toDeliver = selected.filter((s) => s.binding.channel.kind === 'in_app');
        this.logger.log(
          `sendNotification: push отложен бюджетом (reason=${consume.reason ?? 'unknown'}) ` +
            `user=${input.recipientUserId} eventType=${input.eventType}; in_app доставлен`,
        );
      }
    }

    for (const { binding } of toDeliver) {
      const delivery = await this.prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channelBindingId: binding.id,
        },
      });
      await this.queue.enqueueSend({ deliveryId: delivery.id });
      this.metrics.incConversationalDelivery({
        kind: binding.channel.kind,
        status: 'queued',
      });
      if (input.eventType === 'checkin.prompt') {
        this.metrics.incCheckinPromptDelivered({ channel: binding.channel.kind });
      }
    }

    this.metrics.incConversationalNotification({
      eventType: input.eventType,
      status: 'queued',
    });

    this.logger.log(
      `sendNotification: id=${notification.id} user=${input.recipientUserId} eventType=${input.eventType} channels=[${toDeliver.map((s) => s.binding.channel.kind).join(',')}]`,
    );
    return notification;
  }

  async sendChatReply(args: {
    tenantId: string;
    userId: string;
    conversationId: string;
    messageId: string;
    text: string;
    citationsCount: number;
    mode?: 'factual' | 'synthetic' | 'clone_style';
    uncertaintyNote?: string;
    originChannelBindingId?: string;
    dataClass?: DataClass;
    solicited?: boolean;
  }): Promise<Notification> {
    let preferredKinds: ChannelKind[] | undefined;
    if (args.originChannelBindingId) {
      const kinds = await this.resolveOriginChannelKinds({
        originChannelBindingId: args.originChannelBindingId,
        userId: args.userId,
        tenantId: args.tenantId,
      });
      if (kinds.length > 0) {
        preferredKinds = kinds;
      } else {
        this.logger.warn(
          { originChannelBindingId: args.originChannelBindingId },
          'sendChatReply: originChannelBindingId не валиден или не принадлежит юзеру/Org — fallback на policy',
        );
      }
    }

    const payload: Record<string, unknown> = {
      conversationId: args.conversationId,
      messageId: args.messageId,
      text: args.text,
      citationsCount: args.citationsCount,
    };
    if (args.mode) payload.mode = args.mode;
    if (args.uncertaintyNote) payload.uncertaintyNote = args.uncertaintyNote;

    const critical = args.solicited === true && preferredKinds !== undefined;

    return this.sendNotification({
      tenantId: args.tenantId,
      recipientUserId: args.userId,
      eventType: 'chat.answer',
      payload,
      dataClass: args.dataClass ?? 'sensitive',
      preferredChannelKinds: preferredKinds,
      critical,
    });
  }

  async resolveOriginChannelKinds(args: {
    originChannelBindingId?: string;
    userId: string;
    tenantId: string;
  }): Promise<ChannelKind[]> {
    if (!args.originChannelBindingId) return [];
    const binding = await this.prisma.channelBinding.findUnique({
      where: { id: args.originChannelBindingId },
      include: { channel: true },
    });
    if (!binding) return [];
    if (binding.userId !== args.userId) return [];
    if (binding.channel.tenantId && binding.channel.tenantId !== args.tenantId) {
      return [];
    }
    if (binding.channel.status !== 'active') return [];
    return [binding.channel.kind];
  }

  async respondToProbe(args: {
    notificationId: string;
    userId: string;
    payload: ConversationalJson;
  }): Promise<Notification> {
    const notif = await this.prisma.notification.findUnique({
      where: { id: args.notificationId },
    });
    if (!notif) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'notification_not_found', message: 'Уведомление не найдено' },
      });
    }
    if (notif.recipientUserId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_recipient',
          message: 'Это уведомление адресовано другому пользователю',
        },
      });
    }
    if (notif.responseStatus === 'answered') {
      return notif;
    }
    if (notif.expiresAt && notif.expiresAt < new Date()) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'notification_expired', message: 'Срок ответа на это уведомление истёк' },
      });
    }

    const updated = await this.prisma.notification.update({
      where: { id: notif.id },
      data: {
        responseStatus: 'answered',
        responsePayload: args.payload as Prisma.InputJsonValue,
        respondedAt: new Date(),
        status: 'responded',
      },
    });

    await this.prisma.notificationDelivery.updateMany({
      where: { notificationId: notif.id },
      data: { respondedAt: new Date(), status: 'responded' },
    });

    this.metrics.incConversationalNotification({
      eventType: notif.eventType,
      status: 'responded',
    });

    try {
      this.eventEmitter?.emit('notification.responded', {
        tenantId: notif.tenantId,
        notificationId: notif.id,
        recipientUserId: notif.recipientUserId,
        eventType: notif.eventType,
        payload: (args.payload ?? {}) as Record<string, unknown>,
        contextBlockId: notif.contextBlockId ?? null,
        contextCardId: notif.contextCardId ?? null,
      });
    } catch (err) {
      this.logger.warn(
        {
          notificationId: notif.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'respondToProbe: EventEmitter.emit failed — продолжаю',
      );
    }

    this.logger.log(
      `respondToProbe: notificationId=${notif.id} userId=${args.userId} eventType=${notif.eventType}`,
    );
    return updated;
  }

  async markAsAnsweredByCheckin(args: {
    notificationId: string;
    userId: string;
    fromSelfInitiated: true;
  }): Promise<Notification> {
    const notif = await this.prisma.notification.findUnique({
      where: { id: args.notificationId },
    });
    if (!notif) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'notification_not_found',
          message: 'Уведомление не найдено',
        },
      });
    }
    if (notif.recipientUserId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_recipient',
          message: 'Это уведомление адресовано другому пользователю',
        },
      });
    }
    if (notif.responseStatus === 'answered') {
      return notif;
    }
    const updated = await this.prisma.notification.update({
      where: { id: notif.id },
      data: {
        responseStatus: 'answered',
        responsePayload: {
          fromSelfInitiated: args.fromSelfInitiated,
        } as Prisma.InputJsonValue,
        respondedAt: new Date(),
        status: 'responded',
      },
    });
    await this.prisma.notificationDelivery.updateMany({
      where: { notificationId: notif.id },
      data: { respondedAt: new Date(), status: 'responded' },
    });
    this.metrics.incConversationalNotification({
      eventType: notif.eventType,
      status: 'responded',
    });
    this.logger.log(`markAsAnsweredByCheckin: notificationId=${notif.id} userId=${args.userId}`);
    return updated;
  }

  async markRead(args: { notificationId: string; userId: string }): Promise<void> {
    const notif = await this.prisma.notification.findUnique({
      where: { id: args.notificationId },
    });
    if (!notif || notif.recipientUserId !== args.userId) return;
    if (notif.status === 'read' || notif.status === 'responded') return;
    await this.prisma.notification.update({
      where: { id: notif.id },
      data: { status: 'read' },
    });
    await this.prisma.notificationDelivery.updateMany({
      where: { notificationId: notif.id, status: { in: ['sent', 'delivered'] } },
      data: { status: 'read', readAt: new Date() },
    });
  }

  async dismissProbe(args: { notificationId: string; userId: string }): Promise<Notification> {
    const notif = await this.prisma.notification.findUnique({
      where: { id: args.notificationId },
    });
    if (!notif) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'notification_not_found', message: 'Уведомление не найдено' },
      });
    }
    if (notif.recipientUserId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_recipient',
          message: 'Это уведомление адресовано другому пользователю',
        },
      });
    }
    const updated = await this.prisma.notification.update({
      where: { id: notif.id },
      data: { responseStatus: 'dismissed', status: 'read' },
    });
    await this.prisma.notificationDelivery.updateMany({
      where: { notificationId: notif.id },
      data: { respondedAt: new Date(), status: 'responded' },
    });
    return updated;
  }

  async listMyNotifications(args: {
    userId: string;
    tenantId: string;
    status?: 'unread' | 'all' | 'pending_response';
    limit?: number;
    cursor?: string;
  }): Promise<{ items: Notification[]; nextCursor: string | null }> {
    const limit = Math.min(args.limit ?? 50, 200);
    const where: Prisma.NotificationWhereInput = {
      tenantId: args.tenantId,
      recipientUserId: args.userId,
    };
    if (args.status === 'unread') {
      where.status = { in: ['queued', 'sent_partial', 'delivered'] };
    } else if (args.status === 'pending_response') {
      where.responseStatus = 'pending';
    }
    const items = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    return {
      items: items.slice(0, limit),
      nextCursor: hasMore ? items[limit - 1]!.id : null,
    };
  }

  async getMyNotification(args: {
    userId: string;
    tenantId: string;
    notificationId: string;
  }): Promise<Notification & { deliveries: NotificationDelivery[] }> {
    const item = await this.prisma.notification.findFirst({
      where: {
        id: args.notificationId,
        tenantId: args.tenantId,
        recipientUserId: args.userId,
      },
      include: { deliveries: true },
    });
    if (!item) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'notification_not_found', message: 'Уведомление не найдено' },
      });
    }
    return item;
  }

  async listMyChannels(args: { userId: string; tenantId: string }): Promise<
    Array<{
      channel: Channel;
      binding: ChannelBinding | null;
    }>
  > {
    const channels = await this.prisma.channel.findMany({
      where: {
        status: 'active',
        OR: [
          { tenantId: args.tenantId },
          { tenantId: null, kind: { in: ['telegram_bot', 'max_bot'] } },
        ],
      },
      orderBy: { kind: 'asc' },
    });
    const bindings = await this.prisma.channelBinding.findMany({
      where: { userId: args.userId, channelId: { in: channels.map((c) => c.id) } },
    });
    const byChannel = new Map<string, ChannelBinding>(bindings.map((b) => [b.channelId, b]));
    return channels.map((channel) => ({
      channel,
      binding: byChannel.get(channel.id) ?? null,
    }));
  }

  async updatePreferences(args: {
    userId: string;
    bindingId: string;
    preferences: ChannelBindingPreferences;
  }): Promise<ChannelBinding> {
    const binding = await this.prisma.channelBinding.findUnique({
      where: { id: args.bindingId },
    });
    if (!binding) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'binding_not_found', message: 'Привязка канала не найдена' },
      });
    }
    if (binding.userId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'not_owner', message: 'Эта привязка принадлежит другому пользователю' },
      });
    }
    const validated = ChannelBindingPreferencesSchema.parse(args.preferences);
    return this.prisma.channelBinding.update({
      where: { id: binding.id },
      data: { preferences: validated as Prisma.InputJsonValue },
    });
  }

  async updateBindingMaxDataClass(args: {
    userId: string;
    bindingId: string;
    maxDataClass: 'public' | 'internal' | 'sensitive';
  }): Promise<ChannelBinding> {
    const binding = await this.prisma.channelBinding.findUnique({
      where: { id: args.bindingId },
    });
    if (!binding) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'binding_not_found',
          message: 'Привязка канала не найдена',
        },
      });
    }
    if (binding.userId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_owner',
          message: 'Эта привязка принадлежит другому пользователю',
        },
      });
    }
    return this.prisma.channelBinding.update({
      where: { id: binding.id },
      data: { maxDataClass: args.maxDataClass },
    });
  }

  async unlinkChannel(args: { userId: string; bindingId: string }): Promise<void> {
    const binding = await this.prisma.channelBinding.findUnique({
      where: { id: args.bindingId },
    });
    if (!binding) return;
    if (binding.userId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'not_owner', message: 'Эта привязка принадлежит другому пользователю' },
      });
    }
    await this.prisma.channelBinding.delete({ where: { id: binding.id } });
    this.logger.log(`unlinkChannel: userId=${args.userId} bindingId=${binding.id}`);
  }

  async generateLinkCode(args: {
    userId: string;
    kind: ChannelKind;
  }): Promise<{ code: string; ttlSec: number }> {
    if (args.kind === 'in_app') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'in_app_no_linking', message: 'Канал in_app не требует привязки' },
      });
    }
    const result = await this.linkCode.generate(args);
    this.metrics.incConversationalLinkAttempt({
      kind: args.kind,
      status: 'generated',
    });
    return result;
  }

  async linkChannel(args: {
    tenantId: string;
    kind: ChannelKind;
    externalId: string;
    code: string;
  }): Promise<ChannelBinding> {
    const userId = await this.linkCode.consume({ kind: args.kind, code: args.code });
    if (!userId) {
      this.metrics.incConversationalLinkAttempt({
        kind: args.kind,
        status: 'invalid_code',
      });
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_or_expired_code', message: 'Код невалиден или истёк' },
      });
    }

    const channel = await this.prisma.channel.findUnique({
      where: { tenantId_kind: { tenantId: args.tenantId, kind: args.kind } },
    });
    if (!channel) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: `Канал ${args.kind} не настроен в Org. Обратитесь к администратору.`,
        },
      });
    }

    const binding = await this.prisma.channelBinding.upsert({
      where: { channelId_externalId: { channelId: channel.id, externalId: args.externalId } },
      update: { userId, verifiedAt: new Date() },
      create: {
        userId,
        channelId: channel.id,
        externalId: args.externalId,
        verifiedAt: new Date(),
      },
    });

    this.metrics.incConversationalLinkAttempt({
      kind: args.kind,
      status: 'verified',
    });
    this.logger.log(`linkChannel: userId=${userId} kind=${args.kind} bindingId=${binding.id}`);
    return binding;
  }

  subscribeInbound(type: InboundMessage['type'], handler: InboundHandler): void {
    const list = this.inboundHandlers.get(type) ?? [];
    list.push(handler);
    this.inboundHandlers.set(type, list);
    this.logger.log(`subscribeInbound: type=${type} handlers=${list.length}`);
  }

  async dispatchInbound(msg: InboundMessage): Promise<void> {
    this.metrics.incConversationalInbound({
      kind: 'in_app',
      type: msg.type,
    });
    const handlers = this.inboundHandlers.get(msg.type) ?? [];
    if (handlers.length === 0) {
      this.logger.warn(
        `dispatchInbound: нет handlers для type=${msg.type}; userId=${msg.userId} tenantId=${msg.tenantId}`,
      );
      return;
    }
    for (const h of handlers) {
      try {
        await h(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { type: msg.type, userId: msg.userId, err: message },
          'dispatchInbound: handler упал',
        );
      }
    }
  }

  private validatePayload(eventType: string, payload: unknown): Record<string, unknown> {
    try {
      return validateEventPayload(eventType, payload);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issues = err.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'invalid_payload',
            message: `Невалидный payload для eventType=${eventType}: ${issues}`,
          },
        });
      }
      throw err;
    }
  }

  private async resolveBindings(args: {
    tenantId: string;
    userId: string;
  }): Promise<Array<ChannelBinding & { channel: Channel }>> {
    return this.prisma.channelBinding.findMany({
      where: {
        userId: args.userId,
        verifiedAt: { not: null },
        channel: {
          status: 'active',
          OR: [
            { tenantId: args.tenantId },
            { tenantId: null, kind: { in: ['telegram_bot', 'max_bot'] } },
          ],
        },
      },
      include: { channel: true },
    });
  }

  private async ensureInAppForUser(args: { tenantId: string; userId: string }): Promise<void> {
    const channel = await this.prisma.channel.upsert({
      where: { tenantId_kind: { tenantId: args.tenantId, kind: 'in_app' } },
      update: {},
      create: {
        tenantId: args.tenantId,
        kind: 'in_app',
        direction: 'bidirectional',
        maxDataClass: 'private',
        status: 'active',
      },
    });
    await this.prisma.channelBinding.upsert({
      where: { channelId_externalId: { channelId: channel.id, externalId: args.userId } },
      update: { verifiedAt: new Date() },
      create: {
        userId: args.userId,
        channelId: channel.id,
        externalId: args.userId,
        verifiedAt: new Date(),
      },
    });
  }

  private selectBindingsForNotification(args: {
    bindings: Array<ChannelBinding & { channel: Channel }>;
    policy: ChannelKind[];
    dataClass: DataClass;
    eventType: string;
    critical: boolean;
    subjectPersonId: string | null;
  }): Array<{ binding: ChannelBinding & { channel: Channel } }> {
    const selected: Array<{ binding: ChannelBinding & { channel: Channel } }> = [];
    const nowQuiet = this.isQuietHour(new Date());

    const policySet = new Set<ChannelKind>(args.policy);
    let inAppBinding: (ChannelBinding & { channel: Channel }) | null = null;

    for (const binding of args.bindings) {
      const ch = binding.channel;
      if (ch.status !== 'active') continue;

      const effectiveMax = this.minDataClass(ch.maxDataClass, binding.maxDataClass);
      const gate = this.policy?.canEmit({
        payloadDataClass: args.dataClass,
        payloadSubjectPersonId: args.subjectPersonId,
        sink: {
          kind: 'channel_binding',
          maxDataClass: effectiveMax,
          channel: `${ch.kind}#${binding.id.slice(-6)}`,
          recipientUserId: binding.userId,
          recipientPersonId: null,
          recipientIsOwnerOrSuper: false,
        },
      });
      if (gate) {
        if (!gate.allowed) {
          continue;
        }
      } else if (DATA_CLASS_ORDER[args.dataClass] > DATA_CLASS_ORDER[effectiveMax]) {
        continue;
      }

      if (ch.kind === 'in_app') {
        inAppBinding = binding;
      }

      if (!policySet.has(ch.kind)) continue;

      const prefs = this.readPreferences(binding);
      if (prefs.eventTypeDeny?.includes(args.eventType)) continue;
      if (
        prefs.eventTypeAllow &&
        prefs.eventTypeAllow.length > 0 &&
        !prefs.eventTypeAllow.includes(args.eventType)
      ) {
        continue;
      }
      if (prefs.disabledUntil) {
        const until = new Date(prefs.disabledUntil);
        if (Number.isFinite(until.getTime()) && until > new Date()) {
          continue;
        }
      }

      if (!args.critical && nowQuiet) {
        continue;
      }

      selected.push({ binding });
    }

    if (selected.length === 0 && inAppBinding) {
      selected.push({ binding: inAppBinding });
    }

    return selected;
  }

  private minDataClass(a: DataClass, b: DataClass): DataClass {
    return DATA_CLASS_ORDER[a] <= DATA_CLASS_ORDER[b] ? a : b;
  }

  private readPreferences(binding: ChannelBinding): ChannelBindingPreferences {
    const raw = binding.preferences as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const parsed = ChannelBindingPreferencesSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `readPreferences: невалидный preferences-blob у binding=${binding.id} — используем дефолт`,
      );
      return {};
    }
    return parsed.data;
  }

  private isQuietHour(now: Date): boolean {
    const window = this.cfg.conversational.quietHoursDefault;
    const match = window.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return false;
    const startH = Number(match[1]);
    const startM = Number(match[2]);
    const endH = Number(match[3]);
    const endM = Number(match[4]);
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const minutesStart = startH * 60 + startM;
    const minutesEnd = endH * 60 + endM;
    if (minutesStart === minutesEnd) return false;
    if (minutesStart < minutesEnd) {
      return minutesNow >= minutesStart && minutesNow < minutesEnd;
    }
    return minutesNow >= minutesStart || minutesNow < minutesEnd;
  }
}
