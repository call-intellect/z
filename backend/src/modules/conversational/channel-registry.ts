import { Injectable, Logger } from '@nestjs/common';
import type { ChannelKind } from '@prisma/client';

import type { IChannel } from './types/channel.types';

@Injectable()
export class ChannelRegistry {
  private readonly logger = new Logger(ChannelRegistry.name);
  private readonly adapters = new Map<ChannelKind, IChannel>();

  register(adapter: IChannel): void {
    if (this.adapters.has(adapter.kind)) {
      throw new Error(`ChannelRegistry: адаптер для kind=${adapter.kind} уже зарегистрирован`);
    }
    this.adapters.set(adapter.kind, adapter);
    this.logger.log(`ChannelRegistry: зарегистрирован адаптер kind=${adapter.kind}`);
  }

  get(kind: ChannelKind): IChannel | null {
    return this.adapters.get(kind) ?? null;
  }

  require(kind: ChannelKind): IChannel {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new Error(
        `ChannelRegistry.require: адаптер для kind=${kind} не зарегистрирован. ` +
          'Проверь, что соответствующий ChannelAdapter добавлен в ConversationalModule.providers.',
      );
    }
    return adapter;
  }

  listKinds(): ChannelKind[] {
    return Array.from(this.adapters.keys());
  }
}
