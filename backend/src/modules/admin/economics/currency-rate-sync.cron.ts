import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { CurrencyRateService } from './currency-rate.service';

/**
 * SBA α-10 wave 3 — CurrencyRateSyncCron.
 *
 * Daily 07:00 UTC — fetch'ит курс USD→RUB от ЦБ РФ
 * (https://www.cbr-xml-daily.ru/daily_json.js, override через ENV
 * CURRENCY_RATE_API_URL). Парсит { Valute: { USD: { Value: number } } }.
 *
 * Upsert по unique [base, quote, rateDate, source]. Idempotent.
 *
 * При недоступности API:
 *   - logger.warn
 *   - metrics.incCurrencyRateSync('failed')
 *   - cached CurrencyRateService.getCurrentUsdRubRate() вернёт fallback
 *     из ENV CURRENCY_RATE_FALLBACK_USD_RUB (default 90).
 */
@Injectable()
export class CurrencyRateSyncCron {
  private readonly logger = new Logger(CurrencyRateSyncCron.name);
  private static readonly FETCH_TIMEOUT_MS = 15_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CurrencyRateService) private readonly fx: CurrencyRateService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 7 * * *', { name: 'currency-rate-sync' })
  async runScheduled(): Promise<void> {
    try {
      const result = await this.runOnce();
      this.logger.debug(result, 'currency-rate-sync.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'currency-rate-sync.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(): Promise<{
    rate: number;
    source: 'cbr' | 'fallback';
    dateIso: string;
  }> {
    const url = this.cfg.budget.currencyRateApiUrl;
    let rate: number | null = null;
    let source: 'cbr' | 'fallback' = 'fallback';
    let rateDate = new Date();
    try {
      const fetched = await this.fetchFromApi(url);
      rate = fetched.rate;
      rateDate = fetched.rateDate;
      source = 'cbr';
    } catch (err) {
      this.logger.warn(
        `currency-rate-sync: API ${url} недоступен: ${err instanceof Error ? err.message : String(err)}; fallback rate`,
      );
      this.metrics.incCurrencyRateSync('failed');
    }

    if (rate == null) {
      rate = this.cfg.budget.currencyFallbackUsdRub;
      source = 'fallback';
      this.metrics.incCurrencyRateSync('fallback');
    } else {
      this.metrics.incCurrencyRateSync('success');
    }

    const rateDateOnly = new Date(
      Date.UTC(
        rateDate.getUTCFullYear(),
        rateDate.getUTCMonth(),
        rateDate.getUTCDate(),
      ),
    );

    try {
      await this.prisma.currencyRate.upsert({
        where: {
          baseCurrency_quoteCurrency_rateDate_source: {
            baseCurrency: 'USD',
            quoteCurrency: 'RUB',
            rateDate: rateDateOnly,
            source,
          },
        },
        create: {
          baseCurrency: 'USD',
          quoteCurrency: 'RUB',
          rate: new Prisma.Decimal(rate.toFixed(6)),
          source,
          rateDate: rateDateOnly,
        },
        update: {
          rate: new Prisma.Decimal(rate.toFixed(6)),
          fetchedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `currency-rate-sync: upsert не удался: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.fx.invalidate();
    this.metrics.setCurrencyRateUsdRub(rate);

    return {
      rate,
      source,
      dateIso: rateDateOnly.toISOString(),
    };
  }

  /**
   * Public для тестов — позволяет передавать mock URL и не использовать
   * глобальный fetch напрямую.
   */
  async fetchFromApi(url: string): Promise<{ rate: number; rateDate: Date }> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CurrencyRateSyncCron.FETCH_TIMEOUT_MS,
    );
    let resp: Response;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    type CbrPayload = {
      Date?: string;
      Valute?: { USD?: { Value?: number } };
    };
    const data = (await resp.json()) as CbrPayload;
    const value = data?.Valute?.USD?.Value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('Невалидный rate в ответе ЦБ РФ');
    }
    const dateIso = data?.Date ?? new Date().toISOString();
    const rateDate = new Date(dateIso);
    return { rate: value, rateDate };
  }
}
