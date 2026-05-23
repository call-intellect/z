import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

import {
  ExecutablePersonaBuildService,
  type PersonaTriggerReason,
} from './executable-persona-build.service';

/**
 * SBA γ-1 доделки — ExecutablePersonaVersioningService.
 *
 * Один публичный метод `triggerRebuild` — обёртка над
 * `ExecutablePersonaBuildService.buildForProfile`, добавляющая:
 *   - Idempotency-замок через Redis SETNX TTL `minRebuildIntervalMinutes`
 *     (по умолчанию 60 мин) — защита от шквала событий по одной persona.
 *   - Подсчёт `EligibleResult` (нужен ли rebuild вообще: threshold/critical/manual).
 *   - Передача `triggerReason` + `triggerEventAt` в builder.
 *
 * Источники вызовов:
 *   - `ExecutablePersonaTriggerWatcherCron` (каждые 15 минут).
 *   - Admin endpoint `/api/v1/clones/persons/:personId/persona/snapshot`.
 *   - Future: real-time webhook на mark_as_misleading (severity=critical).
 */
@Injectable()
export class ExecutablePersonaVersioningService {
  private readonly logger = new Logger(ExecutablePersonaVersioningService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ExecutablePersonaBuildService)
    private readonly builder: ExecutablePersonaBuildService,
  ) {}

  /**
   * Триггерить rebuild persona для profileId.
   * Возвращает `{ built: true, personaId }` если новый snapshot создан,
   * `{ built: false, reason }` если skip.
   */
  async triggerRebuild(args: {
    profileId: string;
    reason: PersonaTriggerReason;
    triggerEventAt?: Date | null;
    /** Если true — игнорировать idempotency-замок (для manual). */
    bypassLock?: boolean;
  }): Promise<
    | { built: true; personaId: string }
    | {
        built: false;
        reason:
          | 'locked'
          | 'profile_not_found'
          | 'insufficient_traits'
          | 'builder_returned_null';
      }
  > {
    // 1. Idempotency-замок (если не manual).
    if (!args.bypassLock) {
      const acquired = await this.acquireLock(args.profileId);
      if (!acquired) {
        this.logger.debug(
          { profileId: args.profileId, reason: args.reason },
          'persona-versioning: lock — skip',
        );
        return { built: false, reason: 'locked' };
      }
    }

    // 2. Pre-check: профиль существует, traits ≥ minTraits.
    const profile = await this.prisma.skillProfile.findUnique({
      where: { id: args.profileId },
      select: {
        id: true,
        status: true,
        _count: { select: { traits: { where: { status: 'active' } } } },
      },
    });
    if (!profile) {
      return { built: false, reason: 'profile_not_found' };
    }
    if (profile._count.traits < this.cfg.persona.minTraits) {
      return { built: false, reason: 'insufficient_traits' };
    }

    // 3. Запуск builder'а.
    const newPersona = await this.builder.buildForProfile({
      profileId: args.profileId,
      triggerReason: args.reason,
      triggerEventAt: args.triggerEventAt ?? null,
    });
    if (!newPersona) {
      return { built: false, reason: 'builder_returned_null' };
    }
    return { built: true, personaId: newPersona.id };
  }

  /**
   * Acquire Redis SETNX lock per profileId. TTL — minRebuildIntervalMinutes
   * (по умолчанию 60 мин). Возвращает true если замок взят, false если уже
   * занят.
   */
  private async acquireLock(profileId: string): Promise<boolean> {
    const key = `persona:rebuild:${profileId}`;
    const ttlSec = Math.max(60, this.cfg.persona.minRebuildIntervalMinutes * 60);
    try {
      const result = await this.redis.client.set(key, '1', 'EX', ttlSec, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.warn(
        {
          profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'persona-versioning: Redis lock упал — fail-open (разрешаем rebuild)',
      );
      return true;
    }
  }
}
