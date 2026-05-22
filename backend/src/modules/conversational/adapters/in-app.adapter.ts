import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  Channel,
  ChannelBinding,
  ChannelKind,
  DataClass,
  Notification,
  NotificationDelivery,
} from '@prisma/client';

import { ChannelRegistry } from '../channel-registry';
import type { IChannel } from '../types/channel.types';

/**
 * InApp-адаптер. Это «полноценный канал» (не «UI»): мы не выполняем
 * никакой external transport — доставка считается успешной сразу после
 * `NotificationDelivery.status='delivered'`, потому что веб-UI ЛК
 * читает из БД через REST.
 *
 * Inbound для in_app происходит через REST-эндпоинты (см.
 * `/me/notifications/:id/respond` и `/me/notifications` для free-note),
 * не через `ingest`. Поэтому `IChannel.ingest` тут не реализован.
 *
 * Поддерживаемый `maxDataClass` — `private`: in_app не покидает наш
 * периметр, поэтому даже sensitive/private payload'ы можно отдавать.
 * Per-`Channel.maxDataClass` может быть строже — это уважается
 * маршрутизатором.
 */
@Injectable()
export class InAppChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(InAppChannelAdapter.name);
  readonly kind: ChannelKind = 'in_app';
  readonly maxDataClass: DataClass = 'private';

  constructor(
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async send(args: {
    delivery: NotificationDelivery;
    notification: Notification;
    binding: ChannelBinding;
    channel: Channel;
  }): Promise<{ externalMessageId: string | null }> {
    // In-app не нуждается в реальной отправке: воркер уже обновит
    // delivery.status='sent'/'delivered'. Здесь возвращаем null —
    // никакого external id нет.
    this.logger.debug(
      `InApp send: deliveryId=${args.delivery.id} userId=${args.binding.userId} eventType=${args.notification.eventType}`,
    );
    return { externalMessageId: null };
  }
}
