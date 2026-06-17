import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChannelKind } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class ConversationalLinkCodeService {
  private readonly logger = new Logger(ConversationalLinkCodeService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

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

  async consume(args: { kind: ChannelKind; code: string }): Promise<string | null> {
    const key = this.keyFor(args.kind, args.code);
    const userId = await this.redis.client.getdel(key);
    if (!userId) {
      this.logger.debug(
        `consume: код невалиден или истёк kind=${args.kind} code=${redact(args.code)}`,
      );
      return null;
    }
    this.logger.log(`consume: код прожжён userId=${userId} kind=${args.kind}`);
    return userId;
  }

  async generateInviteCode(args: {
    userId: string;
    ttlSec: number;
  }): Promise<{ code: string; ttlSec: number }> {
    const code = randomBytes(8).toString('hex');
    const key = this.inviteKeyFor(code);
    await this.redis.client.set(key, args.userId, 'EX', args.ttlSec);
    this.logger.debug(
      `generateInviteCode: userId=${args.userId} ttl=${args.ttlSec}s code=${redact(code)}`,
    );
    return { code, ttlSec: args.ttlSec };
  }

  async consumeInviteCode(args: { code: string }): Promise<string | null> {
    const key = this.inviteKeyFor(args.code);
    const userId = await this.redis.client.getdel(key);
    if (!userId) {
      this.logger.debug(`consumeInviteCode: код невалиден или истёк code=${redact(args.code)}`);
      return null;
    }
    this.logger.log(`consumeInviteCode: код прожжён userId=${userId}`);
    return userId;
  }

  private inviteKeyFor(code: string): string {
    return `conv:invite:telegram_bot:${code}`;
  }

  private keyFor(kind: ChannelKind, code: string): string {
    return `conv:link:${kind}:${code}`;
  }
}

function redact(code: string): string {
  if (code.length <= 4) return '****';
  return `${code.slice(0, 4)}****`;
}
