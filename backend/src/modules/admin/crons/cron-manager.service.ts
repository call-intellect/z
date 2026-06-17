import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { CronJob } from 'cron';
import IORedis, { type Redis } from 'ioredis';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

const CHANNEL = 'cron.schedule.updated';

type Handler = () => Promise<unknown> | unknown;

interface CronHandlerEntry {
  name: string;
  defaultExpression: string;
  handler: Handler;
}

@Injectable()
export class CronManagerService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CronManagerService.name);

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

  async onModuleInit(): Promise<void> {
    this.collectHandlers();
    await this.subscribeInvalidations();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.applyOverridesFromDb();
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

    const allNames = new Set<string>([...this.handlers.keys(), ...rows.map((r) => r.name)]);

    const result = [];
    for (const name of allNames) {
      const row = rowsByName.get(name);
      const handler = this.handlers.get(name);
      result.push({
        name,
        expression: row?.expression ?? handler?.defaultExpression ?? '',
        defaultExpression: row?.defaultExpression ?? handler?.defaultExpression ?? '',
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

    const defaultExpression = existing?.defaultExpression ?? entry?.defaultExpression ?? '';
    const nextExpression = patch.expression ?? existing?.expression ?? defaultExpression;
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

  async listWithHistory(): Promise<
    Array<{
      name: string;
      expression: string;
      defaultExpression: string;
      enabled: boolean;
      description: string | null;
      lastRunAt: Date | null;
      lastRunDurationMs: number | null;
      lastRunError: string | null;
      recentRuns: Array<{
        startedAt: Date;
        durationMs: number | null;
        status: string;
        error: string | null;
        triggeredBy: string | null;
      }>;
    }>
  > {
    const rows = await this.prisma.cronSchedule.findMany({
      orderBy: { name: 'asc' },
    });
    const rowsByName = new Map(rows.map((r) => [r.name, r] as const));

    const recentByName = new Map<
      string,
      Array<{
        startedAt: Date;
        durationMs: number | null;
        status: string;
        error: string | null;
        triggeredBy: string | null;
      }>
    >();

    const allNames = new Set<string>([...this.handlers.keys(), ...rows.map((r) => r.name)]);

    if (allNames.size > 0) {
      const cap = Math.max(50, allNames.size * 12);
      const histories = await this.prisma.cronRunHistory.findMany({
        where: { cronName: { in: Array.from(allNames) } },
        orderBy: { startedAt: 'desc' },
        take: cap,
      });
      for (const h of histories) {
        const arr = recentByName.get(h.cronName) ?? [];
        if (arr.length >= 10) continue;
        arr.push({
          startedAt: h.startedAt,
          durationMs: h.durationMs,
          status: h.status,
          error: h.error,
          triggeredBy: h.triggeredBy,
        });
        recentByName.set(h.cronName, arr);
      }
    }

    const result = [];
    for (const name of allNames) {
      const row = rowsByName.get(name);
      const handler = this.handlers.get(name);
      result.push({
        name,
        expression: row?.expression ?? handler?.defaultExpression ?? '',
        defaultExpression: row?.defaultExpression ?? handler?.defaultExpression ?? '',
        enabled: row?.enabled ?? true,
        description: row?.description ?? null,
        lastRunAt: row?.lastRunAt ?? null,
        lastRunDurationMs: row?.lastRunDurationMs ?? null,
        lastRunError: row?.lastRunError ?? null,
        recentRuns: recentByName.get(name) ?? [],
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getHistory(
    name: string,
    limit = 20,
  ): Promise<
    Array<{
      id: string;
      startedAt: Date;
      durationMs: number | null;
      status: string;
      error: string | null;
      triggeredBy: string | null;
    }>
  > {
    const take = Math.min(Math.max(limit, 1), 500);
    const rows = await this.prisma.cronRunHistory.findMany({
      where: { cronName: name },
      orderBy: { startedAt: 'desc' },
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      status: r.status,
      error: r.error,
      triggeredBy: r.triggeredBy,
    }));
  }

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

  private collectHandlers(): void {
    const providers = this.discovery.getProviders();
    for (const wrapper of providers) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance);
      if (!proto) continue;

      const methodNames = this.getMethodNames(proto);
      for (const methodName of methodNames) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;

        const cronOptions =
          this.reflector.get<{ name?: string; cronTime?: string } | undefined>(
            'SCHEDULE_CRON_OPTIONS',
            method,
          ) ?? undefined;
        const cronTime = this.reflector.get<string | undefined>('SCHEDULE_CRON_TIME', method);
        if (!cronOptions && !cronTime) continue;

        const defaultExpression = (cronOptions?.cronTime as string | undefined) ?? cronTime ?? '';
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
      const fn = (
        this.scanner as unknown as {
          getAllMethodNames?: (p: object) => string[];
        }
      ).getAllMethodNames;
      if (typeof fn === 'function') {
        return fn.call(this.scanner, proto);
      }
    } catch {}
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

  private applyToScheduler(name: string, expression: string, enabled: boolean): void {
    const handler = this.handlers.get(name);
    if (!handler) {
      return;
    }

    try {
      this.scheduler.deleteCronJob(name);
    } catch {}

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
    this.scheduler.addCronJob(
      name,
      job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
    );
  }

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
        this.logger.warn({ err: err.message }, 'CronManager subscriber: ошибка соединения');
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

  registerHandlerForTest(name: string, handler: Handler, defaultExpression: string): void {
    this.handlers.set(name, { name, defaultExpression, handler });
  }
}
