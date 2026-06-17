import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { RbacService } from '../../modules/rbac/rbac.service';

import { DemoObserverGuard } from './demo-observer.guard';

interface ReqStub {
  tenantId?: string;
  method?: string;
  path?: string;
  user?: { id?: string; isSuperAdmin?: boolean } | null;
}

interface RbacCtxStub {
  role: string;
  visibility?: string;
  isSuperAdmin?: boolean;
}

function makeContext(
  reqStub: ReqStub,
  metaOverride: boolean | undefined,
  ctxType = 'http',
): { ctx: ExecutionContext; reflector: Reflector; req: Record<string, unknown> } {
  const req: Record<string, unknown> = {
    method: 'POST',
    path: '/api/v1/projects',
    ...reqStub,
  };
  const ctx = {
    getType: () => ctxType,
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  const reflector = {
    getAllAndOverride: vi.fn((_key: string) => metaOverride),
  } as unknown as Reflector;

  return { ctx, reflector, req };
}

function makeRbac(rbacCtx: RbacCtxStub | null, canMutateResult?: boolean): RbacService {
  const fullCtx = rbacCtx
    ? {
        role: rbacCtx.role,
        visibility: rbacCtx.visibility ?? 'open',
        isSuperAdmin: rbacCtx.isSuperAdmin ?? false,
        fetchedAt: Date.now(),
      }
    : null;

  return {
    loadContext: vi.fn(async () => fullCtx),
    canMutate: vi.fn((role: string) => canMutateResult ?? role !== 'demo_observer'),
  } as unknown as RbacService;
}

describe('DemoObserverGuard', () => {
  describe('HTTP метод bypass', () => {
    it('пропускает GET-запрос', async () => {
      const { ctx, reflector } = makeContext(
        { method: 'GET', tenantId: 'org-1', user: { id: 'u-1' } },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает HEAD-запрос', async () => {
      const { ctx, reflector } = makeContext(
        { method: 'HEAD', tenantId: 'org-1', user: { id: 'u-1' } },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает OPTIONS-запрос (CORS preflight)', async () => {
      const { ctx, reflector } = makeContext(
        { method: 'OPTIONS', tenantId: 'org-1', user: { id: 'u-1' } },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('роль demo_observer', () => {
    it('блокирует POST для demo_observer', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, undefined);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('возвращает code=demo_observer_readonly в теле ошибки', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, undefined);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      try {
        await guard.canActivate(ctx);
        expect.fail('должен был бросить ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const body = (err as ForbiddenException).getResponse() as Record<string, unknown>;
        expect(body.ok).toBe(false);
        const error = body.error as Record<string, unknown>;
        expect(error.code).toBe('demo_observer_readonly');
      }
    });

    it('кэширует rbacContext в req для downstream', async () => {
      const { ctx, reflector, req } = makeContext(
        { tenantId: 'org-1', user: { id: 'u-1' } },
        undefined,
      );
      const guard = new DemoObserverGuard(
        reflector,
        makeRbac({ role: 'demo_observer', visibility: 'restricted' }),
      );
      try {
        await guard.canActivate(ctx);
      } catch {}
      expect(req.rbacContext).toEqual({
        role: 'demo_observer',
        visibility: 'restricted',
        isSuperAdmin: false,
      });
    });
  });

  describe('другие роли', () => {
    it('пропускает POST для owner', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, undefined);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'owner' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST для admin', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, undefined);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'admin' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST для member', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, undefined);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'member' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('super-admin bypass', () => {
    it('пропускает по cached req.user.isSuperAdmin=true без вызова RbacService', async () => {
      const { ctx, reflector } = makeContext(
        {
          tenantId: 'org-1',
          user: { id: 'super-1', isSuperAdmin: true },
        },
        undefined,
      );
      const rbac = makeRbac({ role: 'demo_observer' });
      const guard = new DemoObserverGuard(reflector, rbac);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(rbac.loadContext as any).not.toHaveBeenCalled();
    });

    it('пропускает по rbacCtx.isSuperAdmin=true (lookup в БД)', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', user: { id: 'super-1' } },
        undefined,
      );
      const guard = new DemoObserverGuard(
        reflector,
        makeRbac({ role: 'admin', isSuperAdmin: true }),
      );
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('path bypass', () => {
    it('пропускает POST /api/v1/billing/pay даже для demo_observer', async () => {
      const { ctx, reflector } = makeContext(
        {
          method: 'POST',
          path: '/api/v1/billing/pay',
          tenantId: 'org-1',
          user: { id: 'u-1' },
        },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST /api/v1/subscription/cancel', async () => {
      const { ctx, reflector } = makeContext(
        {
          method: 'POST',
          path: '/api/v1/subscription/cancel',
          tenantId: 'org-1',
          user: { id: 'u-1' },
        },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST /api/v1/auth/login', async () => {
      const { ctx, reflector } = makeContext(
        {
          method: 'POST',
          path: '/api/v1/auth/login',
          tenantId: 'org-1',
          user: { id: 'u-1' },
        },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST /api/v1/accounts/me для demo_observer', async () => {
      const { ctx, reflector } = makeContext(
        {
          method: 'POST',
          path: '/api/v1/accounts/me',
          tenantId: 'org-1',
          user: { id: 'u-1' },
        },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST /api/v1/me/change-password для demo_observer', async () => {
      const { ctx, reflector } = makeContext(
        {
          method: 'POST',
          path: '/api/v1/me/change-password',
          tenantId: 'org-1',
          user: { id: 'u-1' },
        },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает POST /api/v1/entitlements/me для demo_observer', async () => {
      const { ctx, reflector } = makeContext(
        {
          method: 'POST',
          path: '/api/v1/entitlements/me',
          tenantId: 'org-1',
          user: { id: 'u-1' },
        },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('@PublicDemo() декоратор', () => {
    it('пропускает write-эндпоинт при метаданных public_demo=true', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, true);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('НЕ пропускает при метаданных public_demo=false', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, false);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('edge cases', () => {
    it('пропускает non-http контекст (WebSocket)', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: 'org-1', user: { id: 'u-1' } },
        undefined,
        'ws',
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает без user (не аутентифицирован)', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: null }, undefined);
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает без tenantId (TenantGuard разберётся)', async () => {
      const { ctx, reflector } = makeContext(
        { tenantId: undefined, user: { id: 'u-1' } },
        undefined,
      );
      const guard = new DemoObserverGuard(reflector, makeRbac({ role: 'demo_observer' }));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('пропускает без membership (rbacCtx=null)', async () => {
      const { ctx, reflector } = makeContext({ tenantId: 'org-1', user: { id: 'u-1' } }, undefined);
      const guard = new DemoObserverGuard(reflector, makeRbac(null));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
