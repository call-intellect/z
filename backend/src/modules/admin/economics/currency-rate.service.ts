import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SBA α-10 wave 3 — CurrencyRateService.
 *
 * Источник правды для USD→RUB конвертации:
 *   1. Свежая запись CurrencyRate с rateDate ≤ today (top-1 by rateDate desc).
 *   2. Fallback на cfg.budget.currencyFallbackUsdRub (default 90 RUB/USD).
 *
 * Кэширует курс в памяти на 5 минут — RateSync cron обновляет максимум раз в
 * день; для in-flight LLM-вызовов 5-минутный кэш — нормально (snapshot
 * fields в AiUsageLog зафиксируют точную цифру на момент вызова).
 */
@Injectable()
export class CurrencyRateService {
  private readonly logger = new Logger(CurrencyRateService.name);
  private cached: { rate: number; fetchedAt: number } | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Текущий курс USD→RUB. Никогда не throws — гарантирует возврат fallback'а
   * при любой ошибке (биллинг должен работать даже без CurrencyRate).
   */
  async getCurrentUsdRubRate(): Promise<number> {
    const now = Date.now();
    if (
      this.cached &&
      now - this.cached.fetchedAt < CurrencyRateService.CACHE_TTL_MS
    ) {
      return this.cached.rate;
    }

    try {
      const row = await this.prisma.currencyRate.findFirst({
        where: { baseCurrency: 'USD', quoteCurrency: 'RUB' },
        orderBy: { rateDate: 'desc' },
      });
      if (row) {
        const rate = Number(row.rate);
        if (Number.isFinite(rate) && rate > 0) {
          this.cached = { rate, fetchedAt: now };
          return rate;
        }
      }
    } catch (err) {
      this.logger.warn(
        `getCurrentUsdRubRate: db lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const fallback = this.cfg.budget.currencyFallbackUsdRub;
    this.cached = { rate: fallback, fetchedAt: now };
    return fallback;
  }

  /**
   * Сброс кэша (вызывается из CurrencyRateSyncCron при успешном sync'е).
   */
  invalidate(): void {
    this.cached = null;
  }
}
