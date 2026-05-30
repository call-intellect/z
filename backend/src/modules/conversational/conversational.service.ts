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
import { ConversationalQueueService } from './queue/conversational-queue.service';
import type {
  ConversationalJson,
  InboundMessage,
} from './types/channel.types';
import { validateEventPayload } from './types/event-payload.registry';
import {
  type ChannelBindingPreferences,
  ChannelBindingPreferencesSchema,
} from './types/preferences.schema';

/** Числовой вес `DataClass` для сравнения «не выше канала». */
const DATA_CLASS_ORDER: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

/**
 * Public input для отправки нотификации. `eventType` свободный — потребители
 * вольны вводить новые типы (например, `idea.status_changed`); если для
 * `eventType` зарегистрирована схема — payload валидируется по ней.
 */
export interface SendNotificationInput {
  tenantId: string;
  recipientUserId: string;
  eventType: string;
  payload: ConversationalJson;
  dataClass?: DataClass;
  contextBlockId?: string;
  contextCardId?: string;
  /** ISO-строка истечения. После — не доставляется и помечается expired. */
  expiresAt?: string;
  /**
   * Если `critical=true` — игнорируются quiet hours и rate-limit
   * пользователя. Используется для security-уведомлений и системных алертов.
   */
  critical?: boolean;
  /**
   * Явный список `ChannelKind`'ов, которые маршрутизатор обязан попробовать
   * (если бы они существуют у пользователя). Если не задано — берётся
   * per-event-type default policy.
   */
  preferredChannelKinds?: ChannelKind[];
  /**
   * W4.3 — Person subject'а уведомления. Используется при `dataClass='private'`:
   * `DataClassPolicyService.canEmit` разрешает доставку только если
   * `recipientPersonId === subjectPersonId` ИЛИ recipient — owner/super_admin.
   */
  subjectPersonId?: string | null;
}

/** Per-event-type default-политика выбора каналов. */
const EVENT_TYPE_CHANNEL_POLICY: Record<string, ChannelKind[]> = {
  'probe.question': ['telegram_bot', 'max_bot', 'in_app'],
  'curation.pending': ['in_app', 'email_smtp'],
  'system.message': ['in_app', 'email_smtp'],
  'idea.status_changed': ['in_app'],
  // SBA α-5: ответ chat-v2 — приоритет тому же каналу, где задан вопрос.
  // Если originChannelBindingId задан в sendChatReply, он перебивает policy.
  'chat.answer': ['in_app', 'telegram_bot', 'max_bot', 'email_smtp'],
  // SBA α-6: probe-event от специалиста Слоя 3 — in_app + email_smtp по
  // дефолту. Telegram/Max не используем — это не вопрос пользователю
  // (см. probe.question), а уведомление-подсказка с suggestedActions.
  'specialist.probe': ['in_app', 'email_smtp'],
  // SBA δ-2: ProactiveWatcher — инициативное уведомление-подсказка («заметил X»).
  // По дефолту in_app + telegram/max для friendly-каналов. Email — нет
  // (это «нытик в почту», что обесценивает proactive-режим).
  'proactive.notification': ['in_app', 'telegram_bot', 'max_bot'],
  // SBA β-8.1: недельная сводка операционного директора. Email уместен
  // (понедельник утром — типичное окно для разбора почты), in_app — fallback.
  'operations.weekly_digest': ['in_app', 'email_smtp', 'telegram_bot', 'max_bot'],
  // T8 (2026-05-24): @-упоминание в комментарии задачи. in-app (бейдж в UI)
  // обязателен; telegram/max — для мгновенных пушей. Email скучен — оставляем
  // как fallback в дайджест-режиме (не в этом event-type'е).
  'issue.mention': ['in_app', 'telegram_bot', 'max_bot'],
  // Calendar MVP (2026-05-25): напоминание о событии календаря. Push не везде
  // подключён — приоритет на бот-каналы + in-app.
  'event.reminder': ['in_app', 'telegram_bot', 'max_bot'],
  // ТЗ 2026-05-29 telegram-self-initiated-checkins: подтверждение
  // самоинициированного чек-ина. Caller обычно передаёт preferredChannelKinds=
  // [originChannelKind], но если не передал — fallback на бот-каналы + in_app.
  'checkin.ack': ['telegram_bot', 'max_bot', 'in_app'],
};

const DEFAULT_POLICY: ChannelKind[] = ['in_app'];

/**
 * Public-handler для inbound-сообщений. Регистрируется потребителем (α-5
 * подписывается на `chat_query` через `subscribeInbound`).
 */
export type InboundHandler = (msg: InboundMessage) => Promise<void>;

/**
 * Главный сервис ConversationalModule. Публичный API:
 *
 *   - sendNotification(input)            — отправить нотификацию
 *   - respondToProbe(notificationId, userId, payload)
 *   - listMyNotifications(userId, filter)
 *   - linkChannel(userId, kind, externalId, code)
 *   - generateLinkCode(userId, kind)
 *   - subscribeInbound(type, handler)    — α-5/β-1 регистрируют свои handlers
 *   - dispatchInbound(msg)               — единая точка для inbound из адаптеров
 *
 * Routing:
 *   - получает `ChannelBinding`'и пользователя,
 *   - фильтрует по `notification.dataClass <= channel.maxDataClass`,
 *   - фильтрует по preferences (allow/deny eventType, quiet hours, rate-limit),
 *   - per-event policy (или явный `preferredChannelKinds`),
 *   - fallback на `in_app` (он всегда есть).
 */
@Injectable()
export class ConversationalService {
  private readonly logger = new Logger(ConversationalService.name);
  private readonly inboundHandlers = new Map<
    InboundMessage['type'],
    InboundHandler[]
  >();

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
    // W4.3 — outbound gating через единую политику. Optional: тесты, не
    // инжектящие policy, продолжают работать (легаси-фильтр по effectiveMax).
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly policy?: DataClassPolicyService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  // ──────────────────────────── sendNotification ─────────────────────

  async sendNotification(
    input: SendNotificationInput,
  ): Promise<Notification> {
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

    // 1. Создаём Notification.
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
        responseStatus:
          input.eventType === 'probe.question' ? 'pending' : null,
      },
    });

    // 2. Резолвим bindings + ensureInAppForUser (он всегда должен быть).
    await this.ensureInAppForUser({
      tenantId: input.tenantId,
      userId: input.recipientUserId,
    });
    const bindings = await this.resolveBindings({
      tenantId: input.tenantId,
      userId: input.recipientUserId,
    });

    // 3. Выбираем каналы по политике.
    const policy =
      input.preferredChannelKinds ??
      EVENT_TYPE_CHANNEL_POLICY[input.eventType] ??
      DEFAULT_POLICY;

    const selected = this.selectBindingsForNotification({
      bindings,
      policy,
      dataClass,
      eventType: input.eventType,
      critical: input.critical === true,
      subjectPersonId: input.subjectPersonId ?? null,
    });

    if (selected.length === 0) {
      // ensureInAppForUser обычно гарантирует in_app. Случай «0 каналов» теперь
      // имеет два корня: (а) in_app не нашёлся (легаси-ветка) — пишем `failed`;
      // (б) W4.3 — все каналы, включая in_app fallback, заблокированы canEmit
      // (например, private payload, а recipient ≠ subject и не owner).
      // Во втором случае фиксируем `dropped_dataclass_gate` в ProbeEvent
      // (если payload пришёл от probe-эмитента) — для аудита через UI.
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

    // 4. Создаём NotificationDelivery + enqueue.
    for (const { binding } of selected) {
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
    }

    this.metrics.incConversationalNotification({
      eventType: input.eventType,
      status: 'queued',
    });

    this.logger.log(
      `sendNotification: id=${notification.id} user=${input.recipientUserId} eventType=${input.eventType} channels=[${selected.map((s) => s.binding.channel.kind).join(',')}]`,
    );
    return notification;
  }

  // ──────────────────────────── sendChatReply (SBA α-5) ──────────────

  /**
   * Outbound chat-ответ для модуля chat-v2 (SBA α-5). Создаёт
   * `Notification(eventType='chat.answer', payload={conversationId, text,
   * citationsCount, ...})` и маршрутизирует через стандартный outbound-
   * pipeline. Если задан `originChannelBindingId` — приоритет отправки этому
   * binding'у (binding принадлежит userId — проверяется); иначе работает
   * стандартная policy.
   *
   * Возвращает созданный `Notification` (id — для логов/корреляции с
   * ChatV2Message).
   */
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
    /**
     * Класс данных. Chat-ответ может содержать sensitive/private факты —
     * по умолчанию `sensitive`. Routing отфильтрует каналы с меньшим
     * `maxDataClass`.
     */
    dataClass?: DataClass;
  }): Promise<Notification> {
    // Если задан originChannelBindingId — определим preferredChannelKinds
    // как [kind того binding'а], чтобы routing выбрал именно его.
    let preferredKinds: ChannelKind[] | undefined;
    if (args.originChannelBindingId) {
      const binding = await this.prisma.channelBinding.findUnique({
        where: { id: args.originChannelBindingId },
        include: { channel: true },
      });
      if (
        binding &&
        binding.userId === args.userId &&
        binding.channel.tenantId === args.tenantId &&
        binding.channel.status === 'active'
      ) {
        preferredKinds = [binding.channel.kind];
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

    return this.sendNotification({
      tenantId: args.tenantId,
      recipientUserId: args.userId,
      eventType: 'chat.answer',
      payload,
      dataClass: args.dataClass ?? 'sensitive',
      preferredChannelKinds: preferredKinds,
      // chat-ответ — не critical (нет смысла будить ночью), но и не
      // подавляется quiet hours для in_app (in_app — fallback всегда).
      critical: false,
    });
  }

  // ──────────────────────────── respondToProbe ────────────────────────

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
        error: { code: 'not_recipient', message: 'Это уведомление адресовано другому пользователю' },
      });
    }
    if (notif.responseStatus === 'answered') {
      // Идемпотентность: повторный respond — no-op. Возвращаем текущее
      // состояние.
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

    // Помечаем все доставки этой нотификации как responded — нужно,
    // чтобы во внешних каналах при появлении ответа можно было
    // ответить «уже отвечено» (β-1 reply-парсер).
    await this.prisma.notificationDelivery.updateMany({
      where: { notificationId: notif.id },
      data: { respondedAt: new Date(), status: 'responded' },
    });

    this.metrics.incConversationalNotification({
      eventType: notif.eventType,
      status: 'responded',
    });

    // SBA β-5 — эмитим событие, чтобы ProbeModule мог записать ответ обратно
    // в pipeline (новый RawEvent через ingest).
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

  /**
   * ТЗ 2026-05-29 telegram-self-initiated-checkins §Backend.10 —
   * пометить открытый `checkin.prompt` как answered БЕЗ эмиссии
   * `notification.responded`. Используется `CheckinResponseHandler.processSelfInitiated`
   * чтобы закрыть висящий cron-вопрос, когда сотрудник сам прислал план/отчёт
   * боту (не reply).
   *
   * Симметрия с `respondToProbe`:
   *   - идемпотентный (повтор — no-op);
   *   - обновляет Notification и связанные NotificationDelivery записи;
   *   - НЕ эмитит `notification.responded` — иначе `CheckinResponseHandler.handle`
   *     сработает ещё раз и зациклит upsert (в payload нет text → пустой rawText,
   *     parser confidence=0, и lowConfidence перезапишет реальные данные с
   *     curatorReview=true).
   *
   * Возвращает обновлённый Notification (или текущий если уже answered).
   * Бросает NotFound/Forbidden как `respondToProbe` для безопасности.
   */
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
    // ВАЖНО: не эмитим `notification.responded` — см. JSDoc выше.
    this.logger.log(
      `markAsAnsweredByCheckin: notificationId=${notif.id} userId=${args.userId}`,
    );
    return updated;
  }

  /** Помечаем notification как прочитанное (read receipt из UI). */
  async markRead(args: {
    notificationId: string;
    userId: string;
  }): Promise<void> {
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

  /** «Пропустить»/dismiss probe-уведомление (без ответа). */
  async dismissProbe(args: {
    notificationId: string;
    userId: string;
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
        error: { code: 'not_recipient', message: 'Это уведомление адресовано другому пользователю' },
      });
    }
    return this.prisma.notification.update({
      where: { id: notif.id },
      data: { responseStatus: 'dismissed', status: 'read' },
    });
  }

  // ──────────────────────────── listMyNotifications ───────────────────

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

  // ──────────────────────────── channels (my) ─────────────────────────

  async listMyChannels(args: {
    userId: string;
    tenantId: string;
  }): Promise<
    Array<{
      channel: Channel;
      binding: ChannelBinding | null;
    }>
  > {
    const channels = await this.prisma.channel.findMany({
      where: { tenantId: args.tenantId, status: 'active' },
      orderBy: { kind: 'asc' },
    });
    const bindings = await this.prisma.channelBinding.findMany({
      where: { userId: args.userId, channelId: { in: channels.map((c) => c.id) } },
    });
    const byChannel = new Map<string, ChannelBinding>(
      bindings.map((b) => [b.channelId, b]),
    );
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

  /**
   * W4.3 — пользователь меняет потолок чувствительности своей привязки.
   * Доступны только `public`/`internal`/`sensitive` (private через UI нельзя —
   * это «личное» для in_app, и его не выбирают вручную). Если пользователь
   * пытается поднять потолок выше channel-level (admin-настройка) — это
   * остаётся допустимым на уровне записи, но эффективным остаётся min(channel, binding).
   */
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

  async unlinkChannel(args: {
    userId: string;
    bindingId: string;
  }): Promise<void> {
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

  // ──────────────────────────── linking flow ─────────────────────────

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

  /**
   * Прожечь код + создать `ChannelBinding`. Вызывается ботом канала
   * (β-1: telegram/max). Возвращает созданный binding.
   *
   * Для α-1 эндпоинт `linkChannel` не публикуем в /me/* (нет ботов);
   * это инфра-метод для β-1, но реализован сейчас, чтобы schema была
   * стабильной.
   */
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
    this.logger.log(
      `linkChannel: userId=${userId} kind=${args.kind} bindingId=${binding.id}`,
    );
    return binding;
  }

  // ──────────────────────────── inbound dispatch ──────────────────────

  /**
   * Регистрация handler'а для inbound-сообщений. Например, α-5 регистрирует
   * `subscribeInbound('chat_query', chatService.handleChatQuery)`. Если
   * никто не зарегистрирован — сообщение просто логируется.
   */
  subscribeInbound(type: InboundMessage['type'], handler: InboundHandler): void {
    const list = this.inboundHandlers.get(type) ?? [];
    list.push(handler);
    this.inboundHandlers.set(type, list);
    this.logger.log(`subscribeInbound: type=${type} handlers=${list.length}`);
  }

  /**
   * Единая точка для inbound. Вызывается из адаптеров (β-1: telegram/max) и
   * из REST-эндпоинта `/me/notifications` (для free_note из UI).
   */
  async dispatchInbound(msg: InboundMessage): Promise<void> {
    this.metrics.incConversationalInbound({
      kind: 'in_app',
      type: msg.type,
    });
    const handlers = this.inboundHandlers.get(msg.type) ?? [];
    if (handlers.length === 0) {
      // 'response' обычно обработан через REST `respondToProbe` до dispatchInbound,
      // поэтому отсутствие handler'а здесь — норма для него. Для всех остальных
      // типов (free_note, chat_query) отсутствие handler'а — регрессия:
      // сообщение теряется. WARN, чтобы поймать такие случаи в проде.
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

  // ──────────────────────────── helpers (internal) ────────────────────

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

  /**
   * Получить активные подтверждённые bindings пользователя в Org вместе
   * с каналом (eager). Tenant-scoping — через `channel.tenantId`.
   */
  private async resolveBindings(args: {
    tenantId: string;
    userId: string;
  }): Promise<Array<ChannelBinding & { channel: Channel }>> {
    return this.prisma.channelBinding.findMany({
      where: {
        userId: args.userId,
        verifiedAt: { not: null },
        channel: { tenantId: args.tenantId, status: 'active' },
      },
      include: { channel: true },
    });
  }

  /**
   * Гарантировать наличие `Channel(kind='in_app')` для Org +
   * `ChannelBinding` для пользователя. In-app — равноправный канал и
   * обязан существовать всегда (это и есть fallback).
   */
  private async ensureInAppForUser(args: {
    tenantId: string;
    userId: string;
  }): Promise<void> {
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

  /**
   * Применить per-event policy + dataClass + preferences к множеству bindings.
   *
   * W4.3: dataClass-фильтр идёт через `DataClassPolicyService.canEmit` (если
   * injected) с учётом `min(Channel.maxDataClass, ChannelBinding.maxDataClass)`
   * + `subjectPersonId`. Если policy не доступна — fallback на легаси
   * `ch.maxDataClass`-фильтр.
   */
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
    // in_app — последний шанс fallback'а. Если ни один канал из policy не
    // подошёл — мы всё равно добавим in_app, чтобы пользователь не пропустил
    // важное событие.
    let inAppBinding: (ChannelBinding & { channel: Channel }) | null = null;

    for (const binding of args.bindings) {
      const ch = binding.channel;
      if (ch.status !== 'active') continue;

      // 1. dataClass filter — W4.3 через policy.canEmit + min(channel, binding).
      const effectiveMax = this.minDataClass(
        ch.maxDataClass,
        binding.maxDataClass,
      );
      const gate = this.policy?.canEmit({
        payloadDataClass: args.dataClass,
        payloadSubjectPersonId: args.subjectPersonId,
        sink: {
          kind: 'channel_binding',
          maxDataClass: effectiveMax,
          channel: `${ch.kind}#${binding.id.slice(-6)}`,
          recipientUserId: binding.userId,
          // recipientPersonId / recipientIsOwnerOrSuper не резолвятся здесь —
          // для private gating потребуется доп. запрос. На W4.3 fallback:
          // если payload=private и subject известен, считаем не-subject; в
          // in_app dropped→ дальше fallback на in_app, при необходимости.
          recipientPersonId: null,
          recipientIsOwnerOrSuper: false,
        },
      });
      if (gate) {
        if (!gate.allowed) {
          // Не игнорируем silent — fallback на in_app сработает ниже.
          continue;
        }
      } else if (
        DATA_CLASS_ORDER[args.dataClass] > DATA_CLASS_ORDER[effectiveMax]
      ) {
        // Legacy-fallback когда policy не inj — простой lattice по effectiveMax.
        continue;
      }

      if (ch.kind === 'in_app') {
        inAppBinding = binding;
      }

      // 2. policy filter — берём только те kinds, что попадают в policy.
      if (!policySet.has(ch.kind)) continue;

      // 3. preferences filter.
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

      // 4. quiet hours filter (не применяем для critical).
      if (!args.critical && nowQuiet) {
        // На α-1 — пропускаем «во время сна», в β+ заведём delayed delivery.
        continue;
      }

      selected.push({ binding });
    }

    if (selected.length === 0 && inAppBinding) {
      // Fallback: in_app живёт даже в quiet hours и игнорирует
      // pref-фильтры (это «безопасный канал последней надежды»).
      selected.push({ binding: inAppBinding });
    }

    return selected;
  }

  /**
   * W4.3 — минимум по lattice DataClass. Используется для эффективного потолка
   * binding'а: `min(Channel.maxDataClass, ChannelBinding.maxDataClass)`. То есть
   * пользователь МОЖЕТ опустить свой потолок ниже channel-level, но не поднять
   * выше (channel-level — admin-настройка, выше — нельзя).
   */
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

  /**
   * Простая проверка тихих часов по серверной TZ. Для α-1 достаточно;
   * локализация TZ-пользователя — задача β+.
   */
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
    // Перекрытие через полночь.
    return minutesNow >= minutesStart || minutesNow < minutesEnd;
  }
}
