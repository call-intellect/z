import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PersonalDayNarrativeService } from '../services/personal-day-narrative.service';
import { getLocalHour } from '../utils/local-date';

@Injectable()
export class PersonalDayNarrativeCron {
  private readonly logger = new Logger(PersonalDayNarrativeCron.name);

  private static readonly DEFAULT_MORNING_HOUR = 7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PersonalDayNarrativeService)
    private readonly narratives: PersonalDayNarrativeService,
  ) {}

  @Cron('0 * * * *', { name: 'personal-day-narrative-morning' })
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.personal_day_narrative.enabled',
      'OPERATIONS_PERSONAL_DAY_NARRATIVE_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('personal-day-narrative.cron: disabled, skip');
      return;
    }
    try {
      const now = new Date();
      const morningHour = await this.resolveMorningHour();

      const persons = await this.prisma.person.findMany({
        where: { deletedAt: null, relationship: 'employee', userId: { not: null } },
        select: { id: true, tenantId: true, userId: true, name: true, timezone: true },
        take: 5_000,
      });

      let generated = 0;
      let skippedOutsideWindow = 0;
      let errors = 0;

      for (const p of persons) {
        if (getLocalHour(now, p.timezone) !== morningHour) {
          skippedOutsideWindow++;
          continue;
        }
        try {
          const packageRef = new Date(now.getTime() - 86_400_000);
          await this.narratives.getOrGenerate({
            tenantId: p.tenantId,
            person: { id: p.id, userId: p.userId, name: p.name, timezone: p.timezone },
            now,
            packageRef,
          });
          generated++;
        } catch (err) {
          errors++;
          this.logger.warn(
            {
              tenantId: p.tenantId,
              personId: p.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'personal-day-narrative.cron: генерация письма упала',
          );
        }
      }

      this.logger.log(
        { generated, skippedOutsideWindow, errors, total: persons.length },
        'personal-day-narrative.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'personal-day-narrative.cron: непойманная ошибка',
      );
    }
  }

  private async resolveMorningHour(): Promise<number> {
    const raw = await this.cfg.getDynamic<number>(
      'operations.personal_day_narrative.morning_hour',
      undefined,
      PersonalDayNarrativeCron.DEFAULT_MORNING_HOUR,
    );
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 23) {
      return raw;
    }
    return PersonalDayNarrativeCron.DEFAULT_MORNING_HOUR;
  }
}
