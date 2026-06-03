import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import type { SystemLogPipeline } from '@prisma/client';

/**
 * LoggingModule — request-scoped / job-scoped контекст на `AsyncLocalStorage`.
 *
 * Нужен, чтобы `LogService.write()`, вызванный глубоко в бизнес-логике (без
 * прямого доступа к Express `req`), мог обогатить запись `requestId`/`route`/
 * `userId`, а также процессным контуром цепочки `pipeline`/`traceId`/`module`.
 *
 * Два сценария:
 *   - HTTP: `RequestContextMiddleware` вызывает `run()` с ленивыми геттерами по `req`.
 *   - Воркеры/кроны/цепочки: вызывают `runWith({ pipeline, traceId, module })`,
 *     наследуя уже выставленные request-поля (мердж поверх текущего store).
 *
 * См. plans/tz/2026-06-01-logging-module.md §9 и plans/tz/2026-06-03-logging-pipelines-coverage.md.
 */
export interface RequestContextStore {
  requestId?: string;
  route?: string;
  getUserId?: () => string | undefined;
  getUserRole?: () => string | undefined;
  getOrgId?: () => string | undefined;
  /** Процессный контур текущей цепочки. */
  pipeline?: SystemLogPipeline;
  /** Корреляционный id цепочки (напр. mtg_<meetingId>). */
  traceId?: string;
  /** Имя модуля/стадии по умолчанию для логов внутри контекста. */
  module?: string;
}

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContextStore>();

  /** Запускает `fn` внутри нового контекста. */
  run<T>(store: RequestContextStore, fn: () => T): T {
    return this.als.run(store, fn);
  }

  /**
   * Запускает `fn` в контексте, унаследованном от текущего (мердж `patch`
   * поверх существующего store). Если контекста ещё нет — создаёт новый.
   * Используется воркерами/цепочками для проставления `pipeline`/`traceId`.
   */
  runWith<T>(patch: Partial<RequestContextStore>, fn: () => T): T {
    const current = this.als.getStore() ?? {};
    return this.als.run({ ...current, ...patch }, fn);
  }

  /** Текущий store (или undefined вне запроса). */
  store(): RequestContextStore | undefined {
    return this.als.getStore();
  }

  get requestId(): string | undefined {
    return this.als.getStore()?.requestId;
  }

  get route(): string | undefined {
    return this.als.getStore()?.route;
  }

  get userId(): string | undefined {
    const s = this.als.getStore();
    return s?.getUserId?.();
  }

  get userRole(): string | undefined {
    const s = this.als.getStore();
    return s?.getUserRole?.();
  }

  get orgId(): string | undefined {
    const s = this.als.getStore();
    return s?.getOrgId?.();
  }

  get pipeline(): SystemLogPipeline | undefined {
    return this.als.getStore()?.pipeline;
  }

  get traceId(): string | undefined {
    return this.als.getStore()?.traceId;
  }

  get module(): string | undefined {
    return this.als.getStore()?.module;
  }
}
