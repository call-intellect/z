import {
  BadRequestException,
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

import {
  MIN_REASON_LENGTH,
  getSchemaForKey,
  hasSchemaForKey,
} from './admin-setting-schema-registry';

const REASON_REQUIRED_SEVERITIES = new Set(['high', 'destructive']);

const CHANNEL = 'admin:setting:invalidate';
const CACHE_MAX = 1000;
const CACHE_TTL_MS = 30_000;

type CacheEntry = { value: unknown; storedAt: number };

interface SetOptions {
  userId?: string | null;
  reason?: string | null;
  expectedUpdatedAt?: Date;
  skipAuditLog?: boolean;
}

@Injectable()
export class AdminSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminSettingsService.name);

  private readonly cache = new Map<string, CacheEntry>();

  private subscriber: Redis | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.subscriber = new IORedis(this.cfg.redis.url, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
      this.subscriber.on('error', (err: Error) => {
        this.logger.warn({ err: err.message }, 'AdminSettings subscriber: ошибка соединения');
      });
      await this.subscriber.connect();
      await this.subscriber.subscribe(CHANNEL);
      this.subscriber.on('message', (channel: string, payload: string) => {
        if (channel !== CHANNEL) return;
        try {
          const data = JSON.parse(payload) as { key?: unknown; value?: unknown };
          if (typeof data.key === 'string' && data.key.length > 0) {
            this.cache.delete(data.key);
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
    } finally {
      this.subscriber = null;
    }
  }

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

  async set(key: string, value: unknown, options: SetOptions = {}): Promise<void> {
    if (hasSchemaForKey(key)) {
      const parsed = getSchemaForKey(key).safeParse(value);
      if (!parsed.success) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'admin_setting_invalid_value',
            message: 'Невалидное значение настройки',
            key,
            issues: parsed.error.issues,
          },
        });
      }
    }

    const existing = await this.prisma.adminSetting.findUnique({
      where: { key },
      select: { value: true, updatedAt: true, severity: true },
    });

    if (!existing && !hasSchemaForKey(key)) {
      this.logger.warn(`set() для незарегистрированного ключа ${key}`);
    }

    if (existing && REASON_REQUIRED_SEVERITIES.has(existing.severity)) {
      const reason = options.reason?.trim() ?? '';
      if (reason.length < MIN_REASON_LENGTH) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'admin_setting_reason_required',
            message: `Для настройки этого уровня требуется причина изменения (не короче ${MIN_REASON_LENGTH} символов)`,
            key,
          },
        });
      }
    }

    if (options.expectedUpdatedAt && existing) {
      const expected = options.expectedUpdatedAt.getTime();
      const actual = existing.updatedAt.getTime();
      if (expected !== actual) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'admin_setting_conflict',
            message: 'Настройка была изменена параллельно. Перечитайте и повторите запрос.',
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

  private readCache(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    const age = Date.now() - entry.storedAt;
    if (age > CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  private writeCache(key: string, value: unknown): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { value, storedAt: Date.now() });
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
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'AdminSettings: pub/sub publish сбой (мягкий)',
      );
    }
  }
}
