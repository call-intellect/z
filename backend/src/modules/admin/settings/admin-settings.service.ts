import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import IORedis, { type Redis } from 'ioredis';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * Admin-redesign Фаза 0 — `AdminSettingsService`.
 *
 * Источник «живых» настроек платформы (без перерестарта). Используется через
 * `TypedConfigService.getDynamic(key, envFallbackKey?, default?)` для чтения и
 * через `AdminSettingsController` для записи из админки.
 *
 * Архитектура:
 *   - in-memory LRU-кэш (max 1000 ключей, TTL 30s). Самописный — без зависимости
 *     `lru-cache`.
 *   - pub/sub Redis канал `admin:setting:invalidate` — отдельный subscriber
 *     client (ioredis в subscriber-режиме не умеет команды publish, поэтому
 *     publish'им через основной клиент `RedisService.client`).
 *   - при `set()` — UPDATE/UPSERT в БД (одной транзакцией с записью истории и
 *     SuperAdminAccessLog), затем publish'им invalidation.
 *
 * Optimistic concurrency:
 *   - `set()` принимает опциональный `expectedUpdatedAt: Date`. Если задан и
 *     в БД отличается — throw `ConflictException`.
 *
 * Безопасность:
 *   - Сам сервис guard'ами не защищён — это делает контроллер. Сервис вызывается
 *     также из seed-скриптов (там SuperAdminAccessLog не нужен, поэтому при
 *     `userId === null` мы запись в access-log не делаем).
 */

const CHANNEL = 'admin:setting:invalidate';
const CACHE_MAX = 1000;
const CACHE_TTL_MS = 30_000;

type CacheEntry = { value: unknown; storedAt: number };

interface SetOptions {
  /** ID super_admin'а или null/undefined для серверных/seed-операций. */
  userId?: string | null;
  /** Причина изменения (для high/destructive — обязательна). */
  reason?: string | null;
  /** Optimistic concurrency. Если задан — сравниваем с текущим. */
  expectedUpdatedAt?: Date;
  /**
   * Если true — не пишем SuperAdminAccessLog (для bootstrap/seed-сценариев,
   * где actor — система, а не super_admin).
   */
  skipAuditLog?: boolean;
}

@Injectable()
export class AdminSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminSettingsService.name);

  /**
   * LRU-кэш: вставка обновляет «свежесть» (delete + set ставит ключ в конец).
   * При превышении CACHE_MAX — вытесняем самый старый (Map iteration order =
   * insertion order).
   */
  private readonly cache = new Map<string, CacheEntry>();

  /** Отдельный subscriber client (не используется для publish). */
  private subscriber: Redis | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ──────────────────────────── lifecycle ──────────────────────────────

  async onModuleInit(): Promise<void> {
    try {
      this.subscriber = new IORedis(this.cfg.redis.url, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
      this.subscriber.on('error', (err: Error) => {
        this.logger.warn(
          { err: err.message },
          'AdminSettings subscriber: ошибка соединения',
        );
      });
      await this.subscriber.connect();
      await this.subscriber.subscribe(CHANNEL);
      this.subscriber.on('message', (channel: string, payload: string) => {
        if (channel !== CHANNEL) return;
        try {
          const data = JSON.parse(payload) as { key?: unknown; value?: unknown };
          if (typeof data.key === 'string' && data.key.length > 0) {
            this.cache.delete(data.key);
            // value может быть undefined в payload'ах от старых процессов до
            // обновления — в этом случае applySync(key, undefined) выкинет
            // ключ из cacheMap, и следующий resolveSync пересчитается через
            // ENV. Безопасный fallback.
            this.cfg.applySync(data.key, data.value);
          }
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err), payload },
            'AdminSettings: некорректный pub/sub-payload',
          );
        }
      });
      this.logger.log('AdminSettings: подписка на admin:setting:invalidate');
    } catch (err) {
      // Pub/sub fallback: продолжаем работать без cross-process invalidation.
      // В этом режиме кэш чистится только в текущем процессе по set()/TTL.
      this.subscriber = null;
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'AdminSettings: pub/sub недоступен, продолжаем с локальным кэшем',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    try {
      await this.subscriber.quit();
    } catch {
      // ignore
    } finally {
      this.subscriber = null;
    }
  }

  // ─────────────────────────────── api ─────────────────────────────────

  /**
   * Прочитать одно значение. При отсутствии записи — возвращает
   * `defaultValue` (если задан) или `undefined`. Кэшируется на 30 секунд.
   */
  async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
    const cached = this.readCache(key);
    if (cached !== undefined) return cached as T;

    const row = await this.prisma.adminSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!row) {
      return defaultValue;
    }
    this.writeCache(key, row.value);
    return row.value as T;
  }

  /**
   * Прочитать несколько значений батчем. Возвращает мапу `{ key: value }`.
   * Отсутствующие ключи в результат не попадают.
   */
  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const k of keys) {
      const cached = this.readCache(k);
      if (cached !== undefined) {
        out[k] = cached;
      } else {
        missing.push(k);
      }
    }
    if (missing.length === 0) return out;

    const rows = await this.prisma.adminSetting.findMany({
      where: { key: { in: missing } },
      select: { key: true, value: true },
    });
    for (const r of rows) {
      this.writeCache(r.key, r.value);
      out[r.key] = r.value;
    }
    return out;
  }

  /**
   * Записать значение. Шаги:
   *   1) optimistic concurrency check (если задан `expectedUpdatedAt`).
   *   2) транзакция: UPSERT + AdminSettingHistory + (опц.) SuperAdminAccessLog.
   *   3) drop из локального кэша + publish invalidation в другие процессы.
   */
  async set(
    key: string,
    value: unknown,
    options: SetOptions = {},
  ): Promise<void> {
    const existing = await this.prisma.adminSetting.findUnique({
      where: { key },
      select: { value: true, updatedAt: true },
    });

    if (options.expectedUpdatedAt && existing) {
      const expected = options.expectedUpdatedAt.getTime();
      const actual = existing.updatedAt.getTime();
      if (expected !== actual) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'admin_setting_conflict',
            message:
              'Настройка была изменена параллельно. Перечитайте и повторите запрос.',
          },
        });
      }
    }

    const prevValue = existing?.value ?? null;
    const newValueInput = value as Prisma.InputJsonValue;
    const prevValueInput = (prevValue ?? null) as Prisma.InputJsonValue;
    const userId = options.userId ?? null;

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.adminSetting.update({
          where: { key },
          data: {
            value: newValueInput,
            updatedBy: userId,
            comment: options.reason ?? null,
          },
        });
      } else {
        // Bootstrap-сценарий: запись могла отсутствовать (seed ещё не прошёл).
        // category/section дефолтим — реальный seed их перезапишет.
        await tx.adminSetting.create({
          data: {
            key,
            value: newValueInput,
            category: 'platform',
            section: 'misc',
            severity: 'low',
            updatedBy: userId,
            comment: options.reason ?? null,
          },
        });
      }

      await tx.adminSettingHistory.create({
        data: {
          key,
          prevValue: prevValueInput,
          newValue: newValueInput,
          changedBy: userId ?? 'system',
          reason: options.reason ?? null,
        },
      });

      if (userId && !options.skipAuditLog) {
        await tx.superAdminAccessLog.create({
          data: {
            superAdminUserId: userId,
            accessedTenantId: null,
            route: `admin/settings/${key}`,
            method: 'POST',
            params: { key } as Prisma.InputJsonValue,
            reason: options.reason ?? null,
          },
        });
      }
    });

    this.cache.delete(key);
    this.cfg.applySync(key, value);
    await this.publishInvalidate(key, value);
  }

  /**
   * Перечисление настроек с фильтрами по category/section. Возвращает
   * полный объект записи (для UI).
   */
  async list(filters: { category?: string; section?: string }): Promise<
    Array<{
      key: string;
      value: unknown;
      category: string;
      section: string;
      severity: string;
      schemaId: string | null;
      description: string | null;
      updatedBy: string | null;
      updatedAt: Date;
      comment: string | null;
    }>
  > {
    const where: Prisma.AdminSettingWhereInput = {};
    if (filters.category) where.category = filters.category;
    if (filters.section) where.section = filters.section;

    const rows = await this.prisma.adminSetting.findMany({
      where,
      orderBy: [{ category: 'asc' }, { section: 'asc' }, { key: 'asc' }],
    });

    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      category: r.category,
      section: r.section,
      severity: r.severity,
      schemaId: r.schemaId,
      description: r.description,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
      comment: r.comment,
    }));
  }

  /**
   * Карточка одной настройки. Бросает `NotFoundException`, если ключа нет.
   */
  async getDetail(key: string): Promise<{
    key: string;
    value: unknown;
    category: string;
    section: string;
    severity: string;
    schemaId: string | null;
    description: string | null;
    updatedBy: string | null;
    updatedAt: Date;
    comment: string | null;
  }> {
    const row = await this.prisma.adminSetting.findUnique({ where: { key } });
    if (!row) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'admin_setting_not_found', message: `Ключ ${key} не найден` },
      });
    }
    return {
      key: row.key,
      value: row.value,
      category: row.category,
      section: row.section,
      severity: row.severity,
      schemaId: row.schemaId,
      description: row.description,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
      comment: row.comment,
    };
  }

  /**
   * История изменений ключа, упорядочена по `changedAt DESC`. По умолчанию
   * 50 записей.
   */
  async getHistory(
    key: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      key: string;
      prevValue: unknown;
      newValue: unknown;
      changedBy: string;
      reason: string | null;
      changedAt: Date;
    }>
  > {
    const rows = await this.prisma.adminSettingHistory.findMany({
      where: { key },
      orderBy: { changedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      prevValue: r.prevValue,
      newValue: r.newValue,
      changedBy: r.changedBy,
      reason: r.reason,
      changedAt: r.changedAt,
    }));
  }

  // ─────────────────────────── private ─────────────────────────────────

  private readCache(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    const age = Date.now() - entry.storedAt;
    if (age > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    // LRU touch: переместить в конец.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  private writeCache(key: string, value: unknown): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { value, storedAt: Date.now() });
    // Eviction по размеру.
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.cache.delete(oldest);
    }
  }

  private async publishInvalidate(key: string, value: unknown): Promise<void> {
    try {
      const payload = JSON.stringify({ key, value });
      await this.redis.client.publish(CHANNEL, payload);
    } catch (err) {
      // Pub/sub publish сбой — не блокируем set(), кэш в других процессах
      // протухнет через 30s по TTL.
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'AdminSettings: pub/sub publish сбой (мягкий)',
      );
    }
  }
}
