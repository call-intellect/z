import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  Channel,
  ChannelBinding,
  ChannelKind,
  DataClass,
  Notification,
  NotificationDelivery,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { ChannelRegistry } from '../../conversational/channel-registry';
import type { IChannel } from '../../conversational/types/channel.types';
import { PushService, type PushSignalKind } from '../services/push.service';

@Injectable()
export class PushChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(PushChannelAdapter.name);
  readonly kind: ChannelKind = 'push';
  readonly maxDataClass: DataClass = 'internal';

  constructor(
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(PushService) private readonly push: PushService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
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
    if (!this.cfg.push.chatPushEnabled) {
      this.logger.debug('push send: CHAT_PUSH_ENABLED=false — kill-switch, no-op');
      return { externalMessageId: null };
    }
    const payload = (args.notification.payload ?? {}) as Record<string, unknown>;
    const conversationId =
      typeof payload['conversationId'] === 'string' ? payload['conversationId'] : undefined;
    const kind: PushSignalKind =
      args.notification.eventType === 'chat.new_message' ? 'chat.new_message' : 'system';

    await this.push.sendToUser({
      tenantId: args.notification.tenantId,
      userId: args.binding.userId,
      signal: { kind, ...(conversationId ? { conversationId } : {}) },
    });

    this.logger.debug(
      `push send: userId=${args.binding.userId} eventType=${args.notification.eventType} convId=${conversationId ?? '-'}`,
    );
    return { externalMessageId: null };
  }
}
