/**
 * InnLookupService — единая точка лукапа реквизитов по ИНН.
 *
 * Маршрут по `INN_LOOKUP_PROVIDER`:
 *   - `mock`               → MockAdapter only.
 *   - `dadata`             → DadataAdapter only.
 *   - `tochka_then_dadata` → TochkaAdapter (если настроен OAuth) → DadataAdapter
 *     fallback. На Фазе 2 TochkaAdapter не реализован — режим эквивалентен
 *     `dadata`. Реальная цепочка появится в Фазе 7 (Точка production).
 *
 * Redis-кэш:
 *   - Ключ: `inn-lookup:<source>:<inn>` (TTL `INN_LOOKUP_CACHE_TTL_DAYS` дней,
 *     по умолчанию 30). source — `mock|dadata|tochka` источника, а не запроса.
 *   - Кэшим только успешные ответы (`InnLookupResult != null`). Негативные
 *     ответы не кэшим — `null` от DaData может означать «временно не нашли»
 *     при rate-limit или сети.
 *   - Cache stampede: `SET NX EX <lockTtl>` на ключ-лок. Если лок занят — ждём
 *     до 1.5 сек polling'ом по 100мс. Это анти-thundering-herd, не строгая
 *     синхронизация.
 *
 * Валидация ИНН: regex `^\d{10}$|^\d{12}$` (10 для ЮЛ, 12 для ИП/самозанятых).
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §8.
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { RedisService } from '../../common/redis/redis.service';

import { DadataAdapter } from './adapters/dadata.adapter';
import type { InnLookupResult } from './adapters/inn-lookup.adapter';
import { MockAdapter } from './adapters/mock.adapter';

const INN_REGEX = /^(\d{10}|\d{12})$/;
/** TTL Redis-лока для cache stampede: ~ один HTTP-таймаут DaData. */
const LOCK_TTL_SECONDS = 8;
/** Сколько раз ретраить чтение кэша при занятом локе. */
const LOCK_WAIT_RETRIES = 15;
/** Пауза между ретраями. */
const LOCK_WAIT_INTERVAL_MS = 100;

export interface InnLookupServiceResult extends InnLookupResult {
  /** true если ответ из кэша (для UI/метрик). */
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
  ) {}

  /**
   * Лукап по ИНН. Возвращает результат либо бросает 404, если все источники
   * молчат. Кидает `BadRequestException`-like (через assert ниже) если ИНН
   * не проходит regex.
   */
  async lookup(rawInn: string): Promise<InnLookupServiceResult> {
    const inn = this.normalizeInn(rawInn);

    // 1. Кэш hit (ищем по любому источнику — какой первый ответил, тот и
    //    отдаём). Ключ ниже включает source, так что hit детерминирован.
    const cached = await this.readFromCache(inn);
    if (cached) {
      return { ...cached, cached: true };
    }

    // 2. Cache stampede: пытаемся захватить лок. Если занят — ждём, потом
    //    повторно читаем кэш.
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
      // Лок так и не снят — это не повод падать, идём сами в провайдер.
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
      // Снимаем лок даже если упало — другой запрос не должен висеть.
      await this.redis.client.del(lockKey).catch(() => {});
    }
  }

  /**
   * Сбросить кэш для одного ИНН (используется админ-эндпоинтом).
   * Возвращает число удалённых ключей.
   */
  async invalidate(rawInn: string): Promise<number> {
    const inn = this.normalizeInn(rawInn);
    const keys = await this.redis.client.keys(`inn-lookup:*:${inn}`);
    if (keys.length === 0) return 0;
    return this.redis.client.del(...keys);
  }

  // ────────────────────── маршрут провайдеров ──────────────────────

  private async lookupInProviders(inn: string): Promise<InnLookupResult | null> {
    const provider = this.cfg.billing.innLookup.provider;

    if (provider === 'mock') {
      return this.mock.lookup(inn);
    }

    if (provider === 'dadata') {
      return this.dadata.lookup(inn);
    }

    // `tochka_then_dadata`:
    // Фаза 2: TochkaAdapter ещё не реализован → сразу падаем в DaData.
    // Фаза 7: будет TochkaAdapter.lookup → если null → fallback на DaData.
    // На MVP в проде это поведение эквивалентно `dadata`.
    return this.dadata.lookup(inn);
  }

  // ──────────────────────────── кэш ────────────────────────────

  private async readFromCache(inn: string): Promise<InnLookupResult | null> {
    // Ищем результат от любого источника по `inn-lookup:*:<inn>`.
    const keys = await this.redis.client.keys(`inn-lookup:*:${inn}`);
    if (keys.length === 0) return null;
    const raw = await this.redis.client.get(keys[0] as string);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InnLookupResult;
    } catch (err) {
      this.logger.warn(
        `Битый кэш ${keys[0]}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.redis.client.del(keys[0] as string).catch(() => {});
      return null;
    }
  }

  private async writeToCache(result: InnLookupResult): Promise<void> {
    const ttlSeconds = Math.max(
      60,
      Math.floor(this.cfg.billing.innLookup.cacheTtlDays * 24 * 60 * 60),
    );
    const key = `inn-lookup:${result.source}:${result.inn}`;
    await this.redis.client.set(key, JSON.stringify(result), 'EX', ttlSeconds);
  }

  private lockKey(inn: string): string {
    return `inn-lookup:lock:${inn}`;
  }

  // ──────────────────────────── helpers ────────────────────────────

  private normalizeInn(raw: string): string {
    const trimmed = String(raw ?? '').trim();
    if (!INN_REGEX.test(trimmed)) {
      // Не бросаем здесь — DTO-валидация уже отсекает большую часть. Если
      // долетел мусор (например, из админ-эндпоинта инвалидации) — простой
      // throw, аккуратно ловим выше.
      throw new Error(`Невалидный ИНН: ожидается 10 или 12 цифр`);
    }
    return trimmed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
