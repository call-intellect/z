import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

/**
 * LoggingModule — request-scoped контекст на `AsyncLocalStorage`.
 *
 * Нужен, чтобы `LogService.write()`, вызванный глубоко в бизнес-логике (без
 * прямого доступа к Express `req`), мог обогатить запись `requestId`/`route`/
 * `userId`. `userId`/`orgId` выставляются guard'ами/middleware ПОСЛЕ
 * `RequestContextMiddleware`, поэтому хранятся как ленивые геттеры по `req`.
 *
 * См. plans/tz/2026-06-01-logging-module.md §9.
 */
export interface RequestContextStore {
  requestId?: string;
  route?: string;
  getUserId?: () => string | undefined;
  getUserRole?: () => string | undefined;
  getOrgId?: () => string | undefined;
}

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContextStore>();

  /** Запускает `fn` внутри нового контекста. */
  run<T>(store: RequestContextStore, fn: () => T): T {
    return this.als.run(store, fn);
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
}
