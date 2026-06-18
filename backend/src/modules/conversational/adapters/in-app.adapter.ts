import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
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

@Injectable()
export class InAppChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(InAppChannelAdapter.name);
  readonly kind: ChannelKind = 'in_app';
  readonly maxDataClass: DataClass = 'private';

  constructor(@Inject(ChannelRegistry) private readonly registry: ChannelRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async send(args: {
    delivery: NotificationDelivery;
    notification: Notification;
    binding: ChannelBinding;
    channel: Channel;
  }): Promise<{ externalMessageId: string | null }> {
    this.logger.debug(
      `InApp send: deliveryId=${args.delivery.id} userId=${args.binding.userId} eventType=${args.notification.eventType}`,
    );
    return { externalMessageId: null };
  }
}
