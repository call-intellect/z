import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Prisma } from '@prisma/client';
import IORedis, { type Redis } from 'ioredis';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * Admin-redesign Фаза 0 — `CronManagerService`.
 *
 * Управление расписанием всех cron'ов из админки:
 *   - на старте сканирует @Cron-методы (через DiscoveryService) и
 *     запоминает их как `Map<name, () => Promise<unknown>>`;
 *   - читает таблицу `CronSchedule` и для каждой ВКЛЮЧЕННОЙ записи с
 *     отличающимся `expression` — пересоздаёт CronJob через SchedulerRegistry
 *     (delete + addCronJob). Для `enabled=false` — удаляет cron, чтобы не
 *     дёргать;
 *   - `updateSchedule(name, ...)` — UPDATE строки + пересоздание CronJob +
 *     Redis-publish для других процессов (HTTP/worker);
 *   - `triggerNow(name, userId)` — мгновенно дёргает оригинальный handler,
 *     запись в `CronRunHistory(status: running → success/failed)`.
 *
 * Имена крон-джобов:
 *   - SchedulerRegistry хранит cron'ы по имени, которое задано в декораторе
 *     `@Cron(..., { name })`. Если name не задан — Nest генерирует
 *     `Controller@method`. Здесь мы используем то же имя, что у джоба
 *     зарегистрировано в SchedulerRegistry, и считаем что
 *     `CronSchedule.name` совпадает.
 *
 * Безопасность degradation:
 *   - если БД упала или таблица пуста — bootstrap не ломается, остаются
 *     `@Cron(...)`-дефолты, WARN в логе.
 */

const CHANNEL = 'cron.schedule.updated';

type Handler = () => Promise<unknown> | unknown;

interface CronHandlerEntry {
  name: string;
  defaultExpression: string;
  handler: Handler;
}

@Injectable()
export class CronManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronManagerService.name);

  /** Реестр всех @Cron-обработчиков, найденных через DiscoveryService. */
  private readonly handlers = new Map<string, CronHandlerEntry>();

  private subscriber: Redis | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SchedulerRegistry)
    private readonly scheduler: SchedulerRegistry,
  ) {}

  // ──────────────────────────── lifecycle ──────────────────────────────

  async onModuleInit(): Promise<void> {
    this.collectHandlers();
    await this.applyOverridesFromDb();
    await this.subscribeInvalidations();
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

  // ──────────────────────────── public api ─────────────────────────────

  /**
   * Список всех зарегистрированных в SchedulerRegistry cron'ов с их текущими
   * выражениями и последним запуском из БД.
   */
  async list(): Promise<
    Array<{
      name: string;
      expression: string;
      defaultExpression: string;
      enabled: boolean;
      description: string | null;
      lastRunAt: Date | null;
      lastRunDurationMs: number | null;
      lastRunError: string | null;
      lastRun: {
        startedAt: Date;
        durationMs: number | null;
        status: string;
        error: string | null;
        triggeredBy: string | null;
      } | null;
    }>
  > {
    const rows = await this.prisma.cronSchedule.findMany({
      orderBy: { name: 'asc' },
    });
    const rowsByName = new Map(rows.map((r) => [r.name, r] as const));

    // Последний запуск по каждому cronName.
    const lastRuns = new Map<
      string,
      {
        startedAt: Date;
        durationMs: number | null;
        status: string;
        error: string | null;
        triggeredBy: string | null;
      }
    >();
    if (rows.length > 0) {
      const cronNames = rows.map((r) => r.name);
      const histories = await this.prisma.cronRunHistory.findMany({
        where: { cronName: { in: cronNames } },
        orderBy: { startedAt: 'desc' },
      });
      for (const h of histories) {
        if (!lastRuns.has(h.cronName)) {
          lastRuns.set(h.cronName, {
            startedAt: h.startedAt,
            durationMs: h.durationMs,
            status: h.status,
            error: h.error,
            triggeredBy: h.triggeredBy,
          });
        }
      }
    }

    // Объединяем зарегистрированные handler'ы + БД-записи. Имена из обоих
    // источников — чтобы UI видел и «новые» @Cron, ещё не описанные в БД,
    // и «осиротевшие» БД-записи без handler'а в коде.
    const allNames = new Set<string>([
      ...this.handlers.keys(),
      ...rows.map((r) => r.name),
    ]);

    const result = [];
    for (const name of allNames) {
      const row = rowsByName.get(name);
      const handler = this.handlers.get(name);
      result.push({
        name,
        expression: row?.expression ?? handler?.defaultExpression ?? '',
        defaultExpression:
          row?.defaultExpression ?? handler?.defaultExpression ?? '',
        enabled: row?.enabled ?? true,
        description: row?.description ?? null,
        lastRunAt: row?.lastRunAt ?? null,
        lastRunDurationMs: row?.lastRunDurationMs ?? null,
        lastRunError: row?.lastRunError ?? null,
        lastRun: lastRuns.get(name) ?? null,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Обновить расписание/состояние cron'а из админки. Шаги:
   *   1) upsert CronSchedule (создаём строку, если её нет — с
   *      `defaultExpression` из реестра handler'ов);
   *   2) SuperAdminAccessLog;
   *   3) пересоздать CronJob в SchedulerRegistry;
   *   4) publish `cron.schedule.updated` для других процессов.
   */
  async updateSchedule(
    name: string,
    patch: { expression?: string; enabled?: boolean },
    userId: string,
    reason?: string | null,
  ): Promise<void> {
    const entry = this.handlers.get(name);
    const existing = await this.prisma.cronSchedule.findUnique({
      where: { name },
    });

    if (!entry && !existing) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'cron_not_found', message: `Cron ${name} не найден` },
      });
    }

    const defaultExpression =
      existing?.defaultExpression ?? entry?.defaultExpression ?? '';
    const nextExpression =
      patch.expression ?? existing?.expression ?? defaultExpression;
    const nextEnabled = patch.enabled ?? existing?.enabled ?? true;

    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.cronSchedule.update({
          where: { name },
          data: {
            expression: nextExpression,
            enabled: nextEnabled,
            updatedBy: userId,
          },
        });
      } else {
        await tx.cronSchedule.create({
          data: {
            name,
            expression: nextExpression,
            defaultExpression,
            enabled: nextEnabled,
            updatedBy: userId,
          },
        });
      }
      await tx.superAdminAccessLog.create({
        data: {
          superAdminUserId: userId,
          accessedTenantId: null,
          route: `admin/crons/${name}`,
          method: 'PATCH',
          params: { name, ...patch } as Prisma.InputJsonValue,
          reason: reason ?? null,
        },
      });
    });

    this.applyToScheduler(name, nextExpression, nextEnabled);
    await this.publishInvalidate(name);
  }

  /**
   * Запустить cron вручную. Запись в `CronRunHistory(status='running' →
   * 'success'/'failed')` + audit.
   */
  async triggerNow(
    name: string,
    userId: string,
  ): Promise<{ ok: boolean; durationMs: number; error?: string }> {
    const entry = this.handlers.get(name);
    if (!entry) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'cron_not_found', message: `Cron ${name} не найден` },
      });
    }

    const run = await this.prisma.cronRunHistory.create({
      data: {
        cronName: name,
        status: 'running',
        triggeredBy: userId,
      },
    });
    await this.prisma.superAdminAccessLog.create({
      data: {
        superAdminUserId: userId,
        accessedTenantId: null,
        route: `admin/crons/${name}/run`,
        method: 'POST',
        params: { name } as Prisma.InputJsonValue,
      },
    });

    const startedAt = Date.now();
    try {
      await entry.handler();
      const durationMs = Date.now() - startedAt;
      await this.prisma.$transaction([
        this.prisma.cronRunHistory.update({
          where: { id: run.id },
          data: { status: 'success', durationMs },
        }),
        this.prisma.cronSchedule.updateMany({
          where: { name },
          data: {
            lastRunAt: new Date(),
            lastRunDurationMs: durationMs,
            lastRunError: null,
          },
        }),
      ]);
      return { ok: true, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.$transaction([
        this.prisma.cronRunHistory.update({
          where: { id: run.id },
          data: { status: 'failed', durationMs, error: message },
        }),
        this.prisma.cronSchedule.updateMany({
          where: { name },
          data: {
            lastRunAt: new Date(),
            lastRunDurationMs: durationMs,
            lastRunError: message,
          },
        }),
      ]);
      this.logger.warn(
        { err: message, name },
        'CronManager.triggerNow: ручной запуск завершился с ошибкой',
      );
      return { ok: false, durationMs, error: message };
    }
  }

  // ─────────────────────────── internals ───────────────────────────────

  /**
   * Сканируем все провайдеры приложения и собираем `@Cron`-методы.
   * Для каждого сохраняем `(name, defaultExpression, () => instance[method]())`.
   */
  private collectHandlers(): void {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance);
      if (!proto) continue;

      // Совместимость с разными версиями MetadataScanner.
      const methodNames = this.getMethodNames(proto);
      for (const methodName of methodNames) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;

        // SchedulerRegistry хранит cron'ы под ключом, который ставит
        // ScheduleModule. Мы не пытаемся переиграть ScheduleModule —
        // он сам зарегистрирует cron'ы по умолчанию (через @Cron).
        // Здесь мы только формируем mapping `name → handler`, чтобы знать
        // как дёргать вручную и какие cron'ы вообще существуют.
        const cronOptions = this.reflector.get<
          { name?: string; cronTime?: string } | undefined
        >('SCHEDULE_CRON_OPTIONS', method) ?? undefined;
        const cronTime = this.reflector.get<string | undefined>(
          'SCHEDULE_CRON_TIME',
          method,
        );
        if (!cronOptions && !cronTime) continue;

        const defaultExpression =
          (cronOptions?.cronTime as string | undefined) ?? cronTime ?? '';
        const explicitName = cronOptions?.name;
        const fallbackName = `${proto.constructor?.name ?? 'Unknown'}.${methodName}`;
        const name = explicitName && explicitName.length > 0 ? explicitName : fallbackName;

        const bound = (method as Handler).bind(instance);
        this.handlers.set(name, {
          name,
          defaultExpression,
          handler: bound,
        });
      }
    }
    this.logger.log(`CronManager: найдено ${this.handlers.size} @Cron-методов`);
  }

  private getMethodNames(proto: object): string[] {
    try {
      // В новых версиях @nestjs/core MetadataScanner экспортирует
      // getAllMethodNames; для старых — fallback на собственный обход.
      const fn = (
        this.scanner as unknown as {
          getAllMethodNames?: (p: object) => string[];
        }
      ).getAllMethodNames;
      if (typeof fn === 'function') {
        return fn.call(this.scanner, proto);
      }
    } catch {
      // ignore — fallback ниже.
    }
    const out: string[] = [];
    let cur: object | null = proto;
    while (cur && cur !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(cur)) {
        if (k === 'constructor') continue;
        if (!out.includes(k)) out.push(k);
      }
      cur = Object.getPrototypeOf(cur);
    }
    return out;
  }

  /**
   * Применить БД-override к SchedulerRegistry. Шаги:
   *   - для каждой строки CronSchedule с enabled=true и expression != defaultExpression:
   *     deleteCronJob(name) → addCronJob(name, new CronJob(...)).
   *   - для enabled=false: deleteCronJob(name) (если есть).
   *
   * При сбое подключения к БД — просто warn'им и оставляем дефолтные @Cron'ы.
   */
  private async applyOverridesFromDb(): Promise<void> {
    let rows: Array<{
      name: string;
      expression: string;
      defaultExpression: string;
      enabled: boolean;
    }>;
    try {
      rows = await this.prisma.cronSchedule.findMany({
        select: {
          name: true,
          expression: true,
          defaultExpression: true,
          enabled: true,
        },
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'CronManager: БД недоступна, оставляем bootstrap-дефолты @Cron',
      );
      return;
    }

    for (const row of rows) {
      try {
        this.applyToScheduler(row.name, row.expression, row.enabled);
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err), name: row.name },
          'CronManager: не удалось применить override',
        );
      }
    }
  }

  /**
   * Перевесить SchedulerRegistry для конкретного cron'а:
   *   - enabled=false → удаляем (если был).
   *   - enabled=true → удаляем + добавляем заново с новым выражением,
   *     чтобы любой override (даже совпадающий с дефолтом) был чистым.
   */
  private applyToScheduler(
    name: string,
    expression: string,
    enabled: boolean,
  ): void {
    const handler = this.handlers.get(name);
    if (!handler) {
      // Осиротевшая БД-запись — handler'а в коде нет. Тишина.
      return;
    }

    // Безопасное удаление: SchedulerRegistry.deleteCronJob бросает если cron
    // не зарегистрирован.
    try {
      this.scheduler.deleteCronJob(name);
    } catch {
      // ignore — возможно ScheduleModule зарегистрировал его под другим именем.
    }

    if (!enabled) {
      return;
    }

    const job = new CronJob(
      expression || handler.defaultExpression,
      () => {
        void this.runWrapped(name, handler.handler);
      },
      null,
      true,
    );
    this.scheduler.addCronJob(name, job as unknown as Parameters<
      SchedulerRegistry['addCronJob']
    >[1]);
  }

  /** Обёртка для scheduled-вызовов — пишет CronRunHistory и lastRun*. */
  private async runWrapped(name: string, handler: Handler): Promise<void> {
    const run = await this.prisma.cronRunHistory
      .create({
        data: { cronName: name, status: 'running', triggeredBy: null },
      })
      .catch(() => null);
    const startedAt = Date.now();
    try {
      await handler();
      const durationMs = Date.now() - startedAt;
      if (run) {
        await this.prisma.cronRunHistory.update({
          where: { id: run.id },
          data: { status: 'success', durationMs },
        });
      }
      await this.prisma.cronSchedule.updateMany({
        where: { name },
        data: {
          lastRunAt: new Date(),
          lastRunDurationMs: durationMs,
          lastRunError: null,
        },
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      if (run) {
        await this.prisma.cronRunHistory.update({
          where: { id: run.id },
          data: { status: 'failed', durationMs, error: message },
        });
      }
      await this.prisma.cronSchedule.updateMany({
        where: { name },
        data: {
          lastRunAt: new Date(),
          lastRunDurationMs: durationMs,
          lastRunError: message,
        },
      });
      this.logger.warn({ err: message, name }, 'CronManager: scheduled run failed');
    }
  }

  private async subscribeInvalidations(): Promise<void> {
    try {
      this.subscriber = new IORedis(this.cfg.redis.url, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      });
      this.subscriber.on('error', (err: Error) => {
        this.logger.warn(
          { err: err.message },
          'CronManager subscriber: ошибка соединения',
        );
      });
      await this.subscriber.connect();
      await this.subscriber.subscribe(CHANNEL);
      this.subscriber.on('message', async (channel: string, payload: string) => {
        if (channel !== CHANNEL) return;
        try {
          const data = JSON.parse(payload) as { name?: unknown };
          if (typeof data.name === 'string' && data.name.length > 0) {
            const row = await this.prisma.cronSchedule.findUnique({
              where: { name: data.name },
              select: { expression: true, enabled: true },
            });
            if (row) {
              this.applyToScheduler(data.name, row.expression, row.enabled);
            }
          }
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err), payload },
            'CronManager: некорректный pub/sub-payload',
          );
        }
      });
    } catch (err) {
      this.subscriber = null;
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'CronManager: pub/sub недоступен, hot-reload отключён',
      );
    }
  }

  private async publishInvalidate(name: string): Promise<void> {
    try {
      await this.redis.client.publish(CHANNEL, JSON.stringify({ name }));
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err), name },
        'CronManager: publish сбой (мягкий)',
      );
    }
  }

  // ─────────────────────────── for tests ───────────────────────────────

  /** Только для unit-тестов: ручная регистрация handler-mapping'а. */
  registerHandlerForTest(
    name: string,
    handler: Handler,
    defaultExpression: string,
  ): void {
    this.handlers.set(name, { name, defaultExpression, handler });
  }
}

