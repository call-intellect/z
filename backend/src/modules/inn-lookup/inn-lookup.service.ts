import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { RedisService } from '../../common/redis/redis.service';

import { DadataAdapter } from './adapters/dadata.adapter';
import type { InnLookupResult } from './adapters/inn-lookup.adapter';
import { MockAdapter } from './adapters/mock.adapter';
import { TochkaOpenBankingAdapter } from './adapters/tochka.adapter';

const INN_REGEX = /^(\d{10}|\d{12})$/;
const LOCK_TTL_SECONDS = 8;
const LOCK_WAIT_RETRIES = 15;
const LOCK_WAIT_INTERVAL_MS = 100;

export interface InnLookupServiceResult extends InnLookupResult {
  cached: boolean;
}

@Injectable()
export class InnLookupService {
  private readonly logger = new Logger(InnLookupService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(MockAdapter) private readonly mock: MockAdapter,
    @Inject(DadataAdapter) private readonly dadata: DadataAdapter,
    @Inject(TochkaOpenBankingAdapter)
    private readonly tochka: TochkaOpenBankingAdapter,
  ) {}

  async lookup(rawInn: string): Promise<InnLookupServiceResult> {
    const inn = this.normalizeInn(rawInn);

    const cached = await this.readFromCache(inn);
    if (cached) {
      return { ...cached, cached: true };
    }

    const lockKey = this.lockKey(inn);
    const locked = await this.redis.client.set(
      lockKey,
      Date.now().toString(),
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );

    if (locked !== 'OK') {
      for (let i = 0; i < LOCK_WAIT_RETRIES; i += 1) {
        await this.sleep(LOCK_WAIT_INTERVAL_MS);
        const recheck = await this.readFromCache(inn);
        if (recheck) return { ...recheck, cached: true };
      }
      this.logger.warn(
        `InnLookupService: лок ${lockKey} не освободился за ${
          LOCK_WAIT_RETRIES * LOCK_WAIT_INTERVAL_MS
        }мс, иду в провайдер без лока`,
      );
    }

    try {
      const result = await this.lookupInProviders(inn);
      if (!result) {
        throw new NotFoundException(`Организация с ИНН ${inn} не найдена`);
      }
      await this.writeToCache(result);
      return { ...result, cached: false };
    } finally {
      await this.redis.client.del(lockKey).catch(() => {});
    }
  }

  async invalidate(rawInn: string): Promise<number> {
    const inn = this.normalizeInn(rawInn);
    return this.redis.client.del(this.cacheKey(inn));
  }

  private async lookupInProviders(inn: string): Promise<InnLookupResult | null> {
    const provider = this.cfg.billing.innLookup.provider;

    if (provider === 'mock') {
      return this.mock.lookup(inn);
    }

    if (provider === 'dadata') {
      return this.dadata.lookup(inn);
    }

    const fromTochka = await this.tochka.lookup(inn).catch(() => null);
    if (fromTochka) return fromTochka;
    return this.dadata.lookup(inn);
  }

  private async readFromCache(inn: string): Promise<InnLookupResult | null> {
    const key = this.cacheKey(inn);
    const raw = await this.redis.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InnLookupResult;
    } catch (err) {
      this.logger.warn(`Битый кэш ${key}: ${err instanceof Error ? err.message : String(err)}`);
      await this.redis.client.del(key).catch(() => {});
      return null;
    }
  }

  private async writeToCache(result: InnLookupResult): Promise<void> {
    const ttlSeconds = Math.max(
      60,
      Math.floor(this.cfg.billing.innLookup.cacheTtlDays * 24 * 60 * 60),
    );
    const key = this.cacheKey(result.inn);
    await this.redis.client.set(key, JSON.stringify(result), 'EX', ttlSeconds);
  }

  private cacheKey(inn: string): string {
    return `inn-lookup:${inn}`;
  }

  private lockKey(inn: string): string {
    return `inn-lookup:lock:${inn}`;
  }

  private normalizeInn(raw: string): string {
    const trimmed = String(raw ?? '').trim();
    if (!INN_REGEX.test(trimmed)) {
      throw new Error(`Невалидный ИНН: ожидается 10 или 12 цифр`);
    }
    return trimmed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
