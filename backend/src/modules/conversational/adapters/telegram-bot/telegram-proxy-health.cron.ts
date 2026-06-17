import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../../common/redis/redis.service';

import { TelegramProxyAdminClient } from './telegram-proxy-admin.client';

@Injectable()
export class TelegramProxyHealthCron implements OnModuleInit {
  private readonly logger = new Logger(TelegramProxyHealthCron.name);

  private static readonly LEADER_KEY = 'tg:proxy:healthy:leader';
  private static readonly HEALTH_KEY = 'tg:proxy:healthy';

  private static readonly JOB_NAME = 'telegram-proxy-health';

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TelegramProxyAdminClient)
    private readonly proxyAdmin: TelegramProxyAdminClient,
    @Inject(SchedulerRegistry)
    private readonly scheduler: SchedulerRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    const interval = this.cfg.telegramProxy.healthIntervalSec;
    if (!this.cfg.telegramProxy.enabled) {
      this.logger.debug('TelegramProxyHealthCron: TELEGRAM_PROXY_ENABLED=false → cron не стартует');
      return;
    }
    if (interval <= 0) {
      this.logger.debug(
        'TelegramProxyHealthCron: TELEGRAM_PROXY_HEALTH_INTERVAL_SEC=0 → cron отключён (только для тестов)',
      );
      return;
    }
    const cronExp = `*/${interval} * * * * *`;
    const job = new CronJob(cronExp, () => {
      this.tick().catch((err) => {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'TelegramProxyHealthCron.tick failed',
        );
      });
    });
    try {
      this.scheduler.addCronJob(TelegramProxyHealthCron.JOB_NAME, job as never);
      job.start();
      this.logger.debug(
        `TelegramProxyHealthCron: стартован с интервалом ${interval}s ("${cronExp}")`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'TelegramProxyHealthCron: не удалось зарегистрировать cron-job',
      );
    }
  }

  async tick(): Promise<{ ranAsLeader: boolean; ok?: boolean }> {
    const interval = this.cfg.telegramProxy.healthIntervalSec;
    const leaderTtl = interval + 5;
    const acquired = await this.redis.client.set(
      TelegramProxyHealthCron.LEADER_KEY,
      process.pid.toString(),
      'EX',
      leaderTtl,
      'NX',
    );
    if (acquired !== 'OK') {
      return { ranAsLeader: false };
    }

    const pingTimeoutMs = this.cfg.telegramProxy.pingTimeoutSec * 1000;
    const timeoutPromise = new Promise<{
      ok: false;
      status: number;
      durationMs: number;
      error: string;
    }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok: false,
            status: 0,
            durationMs: pingTimeoutMs,
            error: `cron timeout >${pingTimeoutMs}ms`,
          }),
        pingTimeoutMs,
      ),
    );
    const r = await Promise.race([this.proxyAdmin.ping(), timeoutPromise]);
    const ok = r.ok;
    try {
      await this.redis.client.set(
        TelegramProxyHealthCron.HEALTH_KEY,
        ok ? '1' : '0',
        'EX',
        Math.max(interval * 2, 60),
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'TelegramProxyHealthCron: write health-key failed',
      );
    }
    this.metrics.incTelegramProxyHealthCheck({
      outcome: ok ? 'ok' : 'fail',
    });
    if (!ok) {
      this.logger.warn(
        { status: r.status, durationMs: r.durationMs, error: r.error },
        'TelegramProxyHealthCron: прокси НЕ отвечает',
      );
    }
    return { ranAsLeader: true, ok };
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  @Cron('0 0 1 1 *')
  noop(): void {}
}
