import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { SubscriptionService } from '../services/subscription.service';

import { REQUIRE_SUBSCRIPTION_KEY } from './require-subscription.decorator';
import { SubscriptionGuard } from './subscription.guard';

interface ReqStub {
  tenantId?: string;
  method?: string;
  path?: string;
}

function makeContext(
  reqStub: ReqStub,
  metaOverride: boolean | undefined,
  ctxType = 'http',
): { ctx: ExecutionContext; reflector: Reflector } {
  // По умолчанию мутирующий POST с нейтральным путём — большинство тестов
  // именно про paywall-блокировку мутации.
  const req = { method: 'POST', path: '/api/v1/projects', ...reqStub };
  const ctx = {
    getType: () => ctxType,
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  const reflector = {
    getAllAndOverride: vi.fn((_key: string) => metaOverride),
  } as unknown as Reflector;

  return { ctx, reflector };
}

function makeSubService(
  status: string | null,
): SubscriptionService {
  return {
    getByTenant: vi.fn(async () =>
      status ? ({ status, tenantId: 'org-1' } as any) : null,
    ),
  } as unknown as SubscriptionService;
}

describe('SubscriptionGuard', () => {
  describe('без @RequireSubscription', () => {
    it('пропускает запрос (transparent)', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, undefined);
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        REQUIRE_SUBSCRIPTION_KEY,
        expect.any(Array),
      );
    });

    it('пропускает, если декоратор = false', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, false);
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('с @RequireSubscription', () => {
    it('пропускает при status === ACTIVE', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('ACTIVE'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('блокирует при status === DEMO', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('блокирует при status === SUSPENDED', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('SUSPENDED'));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('блокирует при status === CANCELED', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('CANCELED'));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('блокирует при status === EXPIRED', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('EXPIRED'));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('блокирует при status === PAST_DUE', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('PAST_DUE'));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('блокирует, если подписки нет (null → DEMO)', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService(null));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('возвращает правильную структуру ошибки', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));

      try {
        await guard.canActivate(ctx);
        expect.fail('должен был бросить ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const body = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        expect(body.ok).toBe(false);
        const error = body.error as Record<string, unknown>;
        expect(error.code).toBe('subscription_required');
        expect(error.currentStatus).toBe('DEMO');
        expect(error.price).toBe(60_000);
        expect(error.currency).toBe('RUB');
        expect(error.paymentUrl).toBe('/settings/subscription');
      }
    });

    it('возвращает currentStatus=SUSPENDED при SUSPENDED', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('SUSPENDED'));

      try {
        await guard.canActivate(ctx);
        expect.fail('должен был бросить ForbiddenException');
      } catch (err) {
        const body = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        const error = body.error as Record<string, unknown>;
        expect(error.currentStatus).toBe('SUSPENDED');
      }
    });

    it('возвращает currentStatus=DEMO при отсутствии подписки', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService(null));

      try {
        await guard.canActivate(ctx);
        expect.fail('должен был бросить ForbiddenException');
      } catch (err) {
        const body = (err as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        const error = body.error as Record<string, unknown>;
        expect(error.currentStatus).toBe('DEMO');
      }
    });
  });

  describe('edge cases', () => {
    it('блокирует без tenantId (TenantGuard не отработал)', async () => {
      const { ctx, reflector } = makeContext({ tenantId: undefined }, true);
      const guard = new SubscriptionGuard(reflector, makeSubService('ACTIVE'));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('пропускает non-http контекст (WebSocket)', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1' }, true, 'ws');
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ТЗ §3.2 — GET/HEAD/OPTIONS никогда не блокируются (read-only).
  describe('HTTP метод bypass', () => {
    it('пропускает GET-запрос даже при DEMO', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', method: 'GET' },
        true,
      );
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает HEAD-запрос даже при DEMO', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', method: 'HEAD' },
        true,
      );
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает OPTIONS-запрос (CORS preflight) даже при DEMO', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', method: 'OPTIONS' },
        true,
      );
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ТЗ §3.2 — /billing/*, /subscription/*, /auth/* никогда не блокируются.
  describe('path bypass', () => {
    it('пропускает POST /api/v1/billing/pay даже при DEMO', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', method: 'POST', path: '/api/v1/billing/pay' },
        true,
      );
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST /api/v1/subscription/cancel даже при DEMO', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', method: 'POST', path: '/api/v1/subscription/cancel' },
        true,
      );
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST /api/v1/auth/login даже при DEMO', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', method: 'POST', path: '/api/v1/auth/login' },
        true,
      );
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('блокирует POST /api/v1/projects при DEMO (мутирующий, не bypass)', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', method: 'POST', path: '/api/v1/projects' },
        true,
      );
      const guard = new SubscriptionGuard(reflector, makeSubService('DEMO'));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
