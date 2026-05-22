import { Injectable, Logger } from '@nestjs/common';
import type { ChannelKind } from '@prisma/client';

import type { IChannel } from './types/channel.types';

/**
 * Реестр зарегистрированных адаптеров каналов. Заполняется адаптерами в
 * `onModuleInit` через `register(...)`. `ConversationalService` и
 * outbound-воркер ищут адаптер по `ChannelKind`.
 *
 * α-1 — `in_app`, `email_smtp`. β-1 добавит `telegram_bot`, `max_bot`,
 * `email_imap` без правки реестра — достаточно зарегистрировать.
 */
@Injectable()
export class ChannelRegistry {
  private readonly logger = new Logger(ChannelRegistry.name);
  private readonly adapters = new Map<ChannelKind, IChannel>();

  register(adapter: IChannel): void {
    if (this.adapters.has(adapter.kind)) {
      // Дубликат — это конфликт регистрации. Бросаем явно, чтобы заметить
      // на старте, а не словить тонкий баг в продовом трафике.
      throw new Error(
        `ChannelRegistry: адаптер для kind=${adapter.kind} уже зарегистрирован`,
      );
    }
    this.adapters.set(adapter.kind, adapter);
    this.logger.log(`ChannelRegistry: зарегистрирован адаптер kind=${adapter.kind}`);
  }

  get(kind: ChannelKind): IChannel | null {
    return this.adapters.get(kind) ?? null;
  }

  /**
   * `require` с понятной ошибкой — для outbound-воркера. Если адаптер
   * не зарегистрирован, мы хотим явный failure, а не silent skip.
   */
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

  /** Полезно для health/admin: список зарегистрированных каналов. */
  listKinds(): ChannelKind[] {
    return Array.from(this.adapters.keys());
  }
}
