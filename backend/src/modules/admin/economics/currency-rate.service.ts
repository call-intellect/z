import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class CurrencyRateService {
  private readonly logger = new Logger(CurrencyRateService.name);
  private cached: { rate: number; fetchedAt: number } | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getCurrentUsdRubRate(): Promise<number> {
    const now = Date.now();
    if (this.cached && now - this.cached.fetchedAt < CurrencyRateService.CACHE_TTL_MS) {
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

  invalidate(): void {
    this.cached = null;
  }
}
