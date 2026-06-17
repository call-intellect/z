import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

import {
  ExecutablePersonaBuildService,
  type PersonaTriggerReason,
} from './executable-persona-build.service';

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

  async triggerRebuild(args: {
    profileId: string;
    reason: PersonaTriggerReason;
    triggerEventAt?: Date | null;
    bypassLock?: boolean;
  }): Promise<
    | { built: true; personaId: string }
    | {
        built: false;
        reason: 'locked' | 'profile_not_found' | 'insufficient_traits' | 'builder_returned_null';
      }
  > {
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
