import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';
import type { SystemLogPipeline } from '@prisma/client';

export interface RequestContextStore {
  requestId?: string;
  route?: string;
  getUserId?: () => string | undefined;
  getUserRole?: () => string | undefined;
  getOrgId?: () => string | undefined;
  pipeline?: SystemLogPipeline;
  traceId?: string;
  module?: string;
}

@Injectable()
export class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, fn: () => T): T {
    return this.als.run(store, fn);
  }

  runWith<T>(patch: Partial<RequestContextStore>, fn: () => T): T {
    const current = this.als.getStore() ?? {};
    return this.als.run({ ...current, ...patch }, fn);
  }

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
