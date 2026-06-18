import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist39PromiseKeeperService } from '../services/specialist-3-9-promise-keeper.service';
import { getLocalHour } from '../utils/local-date';

@Injectable()
export class CommitmentFollowupCron {
  private readonly logger = new Logger(CommitmentFollowupCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(Specialist39PromiseKeeperService)
    private readonly promiseKeeper: Specialist39PromiseKeeperService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.betaOps.commitmentFollowupEnabled) {
      this.logger.debug('commitment-followup.cron: COMMITMENT_FOLLOWUP_ENABLED=false, skip');
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(stats, 'commitment-followup.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'commitment-followup.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    orgsSkippedOutsideWindow: number;
    followupsSent: number;
    escalationsSent: number;
    errors: number;
  }> {
    const targetHour = this.cfg.betaOps.commitmentFollowupLocalHour;

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true, timezone: true },
      take: 5_000,
    });

    let orgsProcessed = 0;
    let orgsSkippedOutsideWindow = 0;
    let followupsSent = 0;
    let escalationsSent = 0;
    let errors = 0;

    for (const org of orgs) {
      const timezone = org.timezone ?? 'Europe/Moscow';
      const localHour = getLocalHour(now, timezone);
      if (localHour !== targetHour) {
        orgsSkippedOutsideWindow++;
        continue;
      }
      orgsProcessed++;

      try {
        const followupCandidates = await this.promiseKeeper.findFollowupCandidates({
          tenantId: org.id,
          now,
        });
        for (const block of followupCandidates) {
          try {
            const res = await this.promiseKeeper.sendFollowupForBlock({
              blockId: block.id,
              tenantId: block.tenantId,
              authorUserIds: block.authorUserIds,
              questionText: `Ты обещал: «${truncate(block.criticalQuestion, 200)}». Выполнил?`,
              contextSummary: truncate(block.trustedAnswer, 150),
            });
            if (res.sent) followupsSent++;
          } catch (err) {
            errors++;
            this.logger.warn(
              {
                blockId: block.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'commitment-followup.cron: followup упал для блока',
            );
          }
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'commitment-followup.cron: followup-проход упал для Org',
        );
      }

      try {
        const escalationCandidates = await this.promiseKeeper.findEscalationCandidates({
          tenantId: org.id,
          now,
        });
        for (const block of escalationCandidates) {
          try {
            const res = await this.promiseKeeper.sendEscalationForBlock({
              blockId: block.id,
              tenantId: block.tenantId,
              authorUserIds: block.authorUserIds,
              questionText: `Сотрудник молчит про обещание: «${truncate(block.criticalQuestion, 200)}». Уточните напрямую.`,
              contextSummary: truncate(block.trustedAnswer, 150),
            });
            if (res.sent) escalationsSent++;
          } catch (err) {
            errors++;
            this.logger.warn(
              {
                blockId: block.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'commitment-followup.cron: escalation упал для блока',
            );
          }
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'commitment-followup.cron: escalation-проход упал для Org',
        );
      }
    }

    return {
      orgsProcessed,
      orgsSkippedOutsideWindow,
      followupsSent,
      escalationsSent,
      errors,
    };
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
