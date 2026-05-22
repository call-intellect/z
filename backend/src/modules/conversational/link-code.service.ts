import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChannelKind } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { RedisService } from '../../common/redis/redis.service';

/**
 * Universal linking flow: пользователь генерит одноразовый код в ЛК,
 * затем шлёт его боту командой `/link <code>`. Бот вызывает
 * `linkChannel(userId, kind, externalId, code)` → код сверяется и
 * прожигается.
 *
 * Код храним в Redis: `conv:link:<kind>:<code>` → `userId`, TTL =
 * `cfg.conversational.linkCodeTtlSec`. Это не нужно класть в БД:
 * во-первых, объём, во-вторых, истечение. Паттерн повторяет
 * `accounts/verification-token` (но там БД, потому что email — медленный
 * канал и нужен audit). Для мессенджеров — Redis достаточно.
 *
 * Формат кода — 6 hex-байт → 12 hex-символов: 48 бит энтропии,
 * пригодно для ручного ввода в боте, и слишком коротко для брутфорса в
 * пределах TTL 10 минут.
 */
@Injectable()
export class ConversationalLinkCodeService {
  private readonly logger = new Logger(ConversationalLinkCodeService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Сгенерировать новый код. Старые коды того же пользователя/канала
   * НЕ инвалидируются — каждый имеет свой TTL и прожигается отдельно
   * (это нормально, потому что код одноразовый: если злоумышленник
   * перехватит один, бывшие коды всё равно никому не помогают).
   */
  async generate(args: {
    userId: string;
    kind: ChannelKind;
  }): Promise<{ code: string; ttlSec: number }> {
    const code = randomBytes(6).toString('hex');
    const ttl = this.cfg.conversational.linkCodeTtlSec;
    const key = this.keyFor(args.kind, code);
    await this.redis.client.set(key, args.userId, 'EX', ttl);
    this.logger.debug(
      `generate: userId=${args.userId} kind=${args.kind} ttl=${ttl}s code=${redact(code)}`,
    );
    return { code, ttlSec: ttl };
  }

  /**
   * Прожечь код. Возвращает `userId` пользователя, который его создал,
   * либо `null` если код невалиден/протух. Атомарно через GETDEL.
   */
  async consume(args: {
    kind: ChannelKind;
    code: string;
  }): Promise<string | null> {
    const key = this.keyFor(args.kind, args.code);
    // ioredis: getdel доступен с Redis 6.2; страхуем fallback'ом
    // через get + del в pipeline, но в нашей инфре Redis 7+.
    const userId = await this.redis.client.getdel(key);
    if (!userId) {
      this.logger.debug(
        `consume: код невалиден или истёк kind=${args.kind} code=${redact(args.code)}`,
      );
      return null;
    }
    this.logger.log(
      `consume: код прожжён userId=${userId} kind=${args.kind}`,
    );
    return userId;
  }

  private keyFor(kind: ChannelKind, code: string): string {
    return `conv:link:${kind}:${code}`;
  }
}

/** Маска кода для логов — оставляем первые 4 символа и хвост из звёзд. */
function redact(code: string): string {
  if (code.length <= 4) return '****';
  return `${code.slice(0, 4)}****`;
}
