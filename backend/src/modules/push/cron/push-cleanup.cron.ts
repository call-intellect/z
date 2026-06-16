import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * PushCleanupCron — ежесуточная очистка протухших push-подписок.
 *
 * Запускается в 03:00 UTC (период низкой нагрузки). Удаляет записи
 * `PushSubscription`, у которых:
 *   - `failureCount >= cfg.push.maxFailures` (порог из ENV `PUSH_MAX_FAILURES`),
 *     ИЛИ
 *   - `expiresAt < now()` (если push-сервис когда-либо вернул TTL).
 *
 * Сценарий «авторитетной чистки»: основной путь удаления — `WebPushSender.markFailure`
 * прямо в момент 410/404. Cron — страховка для подписок, на которые мы
 * давно не пытались отправлять (например, user не активен в lеnte, или
 * сразу подписка вернула TTL).
 */
@Injectable()
export class PushCleanupCron {
  private readonly logger = new Logger(PushCleanupCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 3 * * *')
  async cleanup(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'push-cleanup: непойманная ошибка',
      );
    }
  }

  /** Публичный метод — удобно вызывать из тестов. */
  async run(): Promise<{ deleted: number }> {
    const max = this.cfg.push.maxFailures;
    const now = new Date();
    const res = await this.prisma.pushSubscription.deleteMany({
      where: {
        OR: [
          { failureCount: { gte: max } },
          { expiresAt: { lt: now } },
        ],
      },
    });
    if (res.count > 0) {
      this.logger.debug(
        `push-cleanup: удалено подписок ${res.count} (max-failures=${max})`,
      );
    }
    return { deleted: res.count };
  }
}
