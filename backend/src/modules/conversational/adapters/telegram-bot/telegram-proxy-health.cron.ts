import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../../common/redis/redis.service';

import { TelegramProxyAdminClient } from './telegram-proxy-admin.client';

/**
 * Пингует прокси `telegram.crossmark.ru` раз в N секунд (default 30),
 * пишет результат в Redis (`tg:proxy:healthy` = '1' | '0') с TTL =
 * `2 × interval` секунд (на 2 пропуска cron'а). Этот ключ читает
 * `AdminTelegramBotService.getSettings` для отображения статуса в UI.
 *
 * Лидер-выбор по Redis `SET NX EX` — чтобы при нескольких нодах/воркерах
 * пинг шёл только из одной. Не критично для корректности (несколько
 * параллельных пингов не ломают логику), но уменьшает шум в логах.
 *
 * Источник: plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §8.
 */
@Injectable()
export class TelegramProxyHealthCron implements OnModuleInit {
  private readonly logger = new Logger(TelegramProxyHealthCron.name);

  /**
   * Лидерский ключ. TTL = `interval + 5s` — небольшой запас, чтобы не
   * было дырки между tick'ами.
   */
  private static readonly LEADER_KEY = 'tg:proxy:healthy:leader';
  /**
   * Ключ, в котором лежит сам бул (читается админкой через
   * `AdminTelegramBotService.readProxyHealthy()`).
   */
  private static readonly HEALTH_KEY = 'tg:proxy:healthy';

  /** Имя job'ы для регистрации в SchedulerRegistry. */
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
      this.logger.log(
        'TelegramProxyHealthCron: TELEGRAM_PROXY_ENABLED=false → cron не стартует',
      );
      return;
    }
    if (interval <= 0) {
      this.logger.log(
        'TelegramProxyHealthCron: TELEGRAM_PROXY_HEALTH_INTERVAL_SEC=0 → cron отключён (только для тестов)',
      );
      return;
    }
    // `@Cron` декоратор бывает неудобен для динамического интервала из
    // ENV — регистрируем вручную через SchedulerRegistry.
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
      this.logger.log(
        `TelegramProxyHealthCron: стартован с интервалом ${interval}s ("${cronExp}")`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'TelegramProxyHealthCron: не удалось зарегистрировать cron-job',
      );
    }
  }

  /**
   * Один tick: лидер-выбор, пинг, запись результата. Публичный для
   * unit-тестов (`run()` в TelegramDigestCron — тот же паттерн).
   */
  async tick(): Promise<{ ranAsLeader: boolean; ok?: boolean }> {
    const interval = this.cfg.telegramProxy.healthIntervalSec;
    const leaderTtl = interval + 5;
    // SET NX EX — атомарный лидер на TTL = interval+5. Если не получили
    // лок — пропускаем tick.
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

    // audit С28 (2026-05-29): дополнительный timeout-guard на ping(). Сам
    // ping использует fetchWithTimeout с default'ом, но если конфиг прокси
    // вышел из строя и default увеличился — мы не должны висеть в крон-tick'е
    // дольше interval. Race с TELEGRAM_PROXY_PING_TIMEOUT_SEC или 5s.
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

  /**
   * Декорация `@Cron`-stub — `@nestjs/schedule` требует хоть один
   * `@Cron`-метод в провайдере, чтобы он зарегистрировался в lifecycle.
   * Реальная регистрация через SchedulerRegistry в onModuleInit
   * (динамический интервал).
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  @Cron('0 0 1 1 *')
  noop(): void {}
}
