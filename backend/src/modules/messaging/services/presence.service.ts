import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { RedisService } from '../../../common/redis/redis.service';

interface PresenceEntry {
  displayName: string;
  expiresAt: number;
}

interface JoinArgs {
  conversationId: string;
  userId: string;
  displayName: string;
}

interface LeaveArgs {
  conversationId: string;
  userId: string;
}

export interface PresenceUser {
  userId: string;
  displayName: string;
}

const PRESENCE_TTL_KEY = 'chat_presence_ttl_seconds';
const PRESENCE_TTL_FALLBACK_SECONDS = 60;

@Injectable()
export class PresenceService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async join(args: JoinArgs): Promise<void> {
    const ttlMs = (await this.ttlSeconds()) * 1000;
    const entry: PresenceEntry = {
      displayName: args.displayName,
      expiresAt: Date.now() + ttlMs,
    };
    const key = this.key(args.conversationId);
    await this.redis.client.hset(key, args.userId, JSON.stringify(entry));
    await this.redis.client.pexpire(key, ttlMs);
  }

  async heartbeat(args: JoinArgs): Promise<void> {
    await this.join(args);
  }

  async leave(args: LeaveArgs): Promise<void> {
    await this.redis.client.hdel(this.key(args.conversationId), args.userId);
  }

  async collect(conversationId: string): Promise<PresenceUser[]> {
    const key = this.key(conversationId);
    const raw = await this.redis.client.hgetall(key);
    const now = Date.now();
    const result: PresenceUser[] = [];
    const expired: string[] = [];

    for (const [userId, value] of Object.entries(raw)) {
      const entry = this.parse(value);
      if (!entry || entry.expiresAt < now) {
        expired.push(userId);
        continue;
      }
      result.push({ userId, displayName: entry.displayName });
    }

    if (expired.length > 0) {
      await this.redis.client.hdel(key, ...expired);
    }
    return result;
  }

  private key(conversationId: string): string {
    return `presence:conv:${conversationId}`;
  }

  private parse(value: string): PresenceEntry | null {
    try {
      const parsed = JSON.parse(value) as Partial<PresenceEntry>;
      if (typeof parsed.displayName !== 'string' || typeof parsed.expiresAt !== 'number') {
        return null;
      }
      return { displayName: parsed.displayName, expiresAt: parsed.expiresAt };
    } catch {
      return null;
    }
  }

  private async ttlSeconds(): Promise<number> {
    const value = await this.cfg.getDynamic<number>(
      PRESENCE_TTL_KEY,
      undefined,
      PRESENCE_TTL_FALLBACK_SECONDS,
    );
    return value > 0 ? value : PRESENCE_TTL_FALLBACK_SECONDS;
  }
}
