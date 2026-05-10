import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../../core-queue/worker-org-gate';

import { EmailFetchService } from './email-fetch.service';

/**
 * Cron-обёртка email-fetcher'а (Фаза 10 knowledge-core).
 *
 * Расписание из `ENV` `EMAIL_FETCH_CRON` (default `*\/5 * * * *`). Cron-decorator
 * `@Cron` принимает только литерал — значение из ENV используется только
 * для будущей перерегистрации через `SchedulerRegistry` (vNext).
 *
 * Каждые 5 минут проходим по `Source(type='email', isActive=true)` всех Org,
 * для каждого вызываем `EmailFetchService.fetchOne(...)`. Перед каждым
 * fetch — `WorkerOrgGate.checkOrThrow(tenantId, 'email-fetch')` (Org-Admin
 * может выключить email-ingest).
 *
 * Если `cfg.emailFetch.enabled === false` — cron выходит сразу.
 */
@Injectable()
export class EmailFetchCron {
  private readonly logger = new Logger(EmailFetchCron.name);
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmailFetchService) private readonly svc: EmailFetchService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async sweep(): Promise<void> {
    if (!this.cfg.emailFetch.enabled) {
      return;
    }
    if (this.running) {
      // Не запускаем второй экземпляр пока предыдущий не закончил.
      this.logger.debug('email-fetch.cron: prev run in progress, skip');
      return;
    }
    this.running = true;
    try {
      const sources = await this.prisma.source.findMany({
        where: { type: 'email', isActive: true },
        select: { id: true, tenantId: true, name: true },
      });
      for (const s of sources) {
        try {
          await this.gate.checkOrThrow(s.tenantId, 'email-fetch');
        } catch (err) {
          this.logger.debug(
            { sourceId: s.id, tenantId: s.tenantId, err: err instanceof Error ? err.message : String(err) },
            'email-fetch.cron: org-gate disabled',
          );
          continue;
        }
        try {
          const result = await this.svc.fetchOne(s.id);
          this.logger.log(
            {
              sourceId: s.id,
              tenantId: s.tenantId,
              name: s.name,
              ingested: result.ingested,
              skipped: result.skipped,
            },
            'email-fetch.cron: source done',
          );
        } catch (err) {
          this.logger.warn(
            {
              sourceId: s.id,
              tenantId: s.tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            'email-fetch.cron: source failed',
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
