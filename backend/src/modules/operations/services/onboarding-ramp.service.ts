import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { DEFAULT_ONBOARDING_SILENT_DAYS, isOnboardingStalled } from './onboarding-ramp.scoring';

export interface OnboardingRampRow {
  personId: string;
  personName: string;
  userId: string | null;
  createdAt: string;
  firstActivityAt: string | null;
  daysSinceJoined: number;
  stalled: boolean;
}

@Injectable()
export class OnboardingRampService {
  private static readonly MAX_NEWCOMERS = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async listForTenant(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ items: OnboardingRampRow[]; silentDays: number }> {
    const silentDays = await this.resolveSilentDays();
    const windowStart = new Date(args.now.getTime() - silentDays * 2 * 86_400_000);

    const newcomers = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        relationship: 'employee',
        deletedAt: null,
        createdAt: { gte: windowStart, lte: args.now },
      },
      select: {
        id: true,
        name: true,
        userId: true,
        entityId: true,
        createdAt: true,
      },
      take: OnboardingRampService.MAX_NEWCOMERS,
    });

    const items: OnboardingRampRow[] = [];
    for (const p of newcomers) {
      const firstActivityAt = await this.firstActivityAt({
        tenantId: args.tenantId,
        personEntityId: p.entityId,
        userId: p.userId,
        since: p.createdAt,
      });
      const stalled = isOnboardingStalled({
        createdAt: p.createdAt,
        firstActivityAt,
        silentDays,
        now: args.now,
      });
      const daysSinceJoined = Math.floor((args.now.getTime() - p.createdAt.getTime()) / 86_400_000);
      items.push({
        personId: p.id,
        personName: p.name,
        userId: p.userId,
        createdAt: p.createdAt.toISOString(),
        firstActivityAt: firstActivityAt ? firstActivityAt.toISOString() : null,
        daysSinceJoined: daysSinceJoined > 0 ? daysSinceJoined : 0,
        stalled,
      });
    }

    items.sort((a, b) => {
      if (a.stalled !== b.stalled) return a.stalled ? -1 : 1;
      return b.daysSinceJoined - a.daysSinceJoined;
    });
    return { items, silentDays };
  }

  private async firstActivityAt(args: {
    tenantId: string;
    personEntityId: string | null;
    userId: string | null;
    since: Date;
  }): Promise<Date | null> {
    const candidates: Date[] = [];

    if (args.personEntityId) {
      const firstBlock = await this.prisma.ideaBlockEntity.findFirst({
        where: {
          entityId: args.personEntityId,
          role: 'subject',
          block: { tenantId: args.tenantId, createdAt: { gte: args.since } },
        },
        select: { block: { select: { createdAt: true } } },
        orderBy: { block: { createdAt: 'asc' } },
      });
      if (firstBlock?.block?.createdAt) {
        candidates.push(firstBlock.block.createdAt);
      }
    }

    if (args.userId) {
      const firstMsg = await this.prisma.chatV2Message.findFirst({
        where: {
          role: 'user',
          createdAt: { gte: args.since },
          conversation: {
            tenantId: args.tenantId,
            userId: args.userId,
          },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      if (firstMsg?.createdAt) candidates.push(firstMsg.createdAt);
    }

    if (candidates.length === 0) return null;
    return candidates.reduce((min, d) => (d < min ? d : min));
  }

  private async resolveSilentDays(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'onboarding.silent_days',
      'ONBOARDING_SILENT_DAYS',
      DEFAULT_ONBOARDING_SILENT_DAYS,
    );
  }
}
