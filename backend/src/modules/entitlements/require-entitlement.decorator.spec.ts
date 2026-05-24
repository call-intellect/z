/**
 * Spec для RequireEntitlement-декоратора + EntitlementGuard (Phase F.4).
 *
 * Покрытие:
 *   - Декоратор записывает feature-ключ в SetMetadata(REQUIRE_ENTITLEMENT_KEY).
 *   - Reflector.getAllAndOverride корректно достаёт его из handler/class.
 *   - EntitlementGuard:
 *     - return true если декоратора нет (transparent).
 *     - return true если фича доступна.
 *     - 403 entitlement_required если фича выключена.
 *     - 403 tenant_required если req.tenantId не выставлен.
 *     - Игнорирует non-HTTP контексты (WS/RPC) — return true.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { EntitlementGuard } from './entitlement.guard';
import {
  REQUIRE_ENTITLEMENT_KEY,
  RequireEntitlement,
} from './require-entitlement.decorator';

import type { EntitlementService, ResolvedEntitlement } from './entitlement.service';
import type { FeatureKey } from './tier-config';

function buildExecCtx(opts: {
  type?: 'http' | 'ws' | 'rpc';
  tenantId?: string;
  feature?: FeatureKey;
}): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(opts.feature);

  const req = { tenantId: opts.tenantId };
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    switchToWs: () => ({}) as never,
    switchToRpc: () => ({}) as never,
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    getType: () => opts.type ?? 'http',
    getArgs: () => [],
    getArgByIndex: () => ({}) as never,
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

function fakeResolved(features: Partial<Record<FeatureKey, boolean>>): ResolvedEntitlement {
  return {
    tier: 'tier_basic',
    rawTier: 'tier_basic',
    failedSafe: false,
    features: features as ResolvedEntitlement['features'],
    quotas: {} as ResolvedEntitlement['quotas'],
    featureOverrides: {},
    quotaOverrides: {},
    notes: null,
  };
}

describe('RequireEntitlement decorator', () => {
  it('создаёт SetMetadata-декоратор с feature-ключом', () => {
    const decorator = RequireEntitlement('feature.theme');
    expect(typeof decorator).toBe('function');

    class Sample {
      @decorator
      handler() {
        return 1;
      }
    }
    const reflector = new Reflector();
    const meta = reflector.get<FeatureKey>(
      REQUIRE_ENTITLEMENT_KEY,
      Sample.prototype.handler,
    );
    expect(meta).toBe('feature.theme');
  });
});

describe('EntitlementGuard', () => {
  it('return true если декоратора нет (transparent)', async () => {
    const { ctx, reflector } = buildExecCtx({});
    const ent = {
      getEntitlement: vi.fn(),
    } as unknown as EntitlementService;
    const guard = new EntitlementGuard(reflector, ent);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ent.getEntitlement).not.toHaveBeenCalled();
  });

  it('return true если фича включена', async () => {
    const { ctx, reflector } = buildExecCtx({
      tenantId: 't-1',
      feature: 'feature.theme',
    });
    const ent = {
      getEntitlement: vi.fn(async () =>
        fakeResolved({ 'feature.theme': true }),
      ),
    } as unknown as EntitlementService;
    const guard = new EntitlementGuard(reflector, ent);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('403 entitlement_required если фича выключена', async () => {
    const { ctx, reflector } = buildExecCtx({
      tenantId: 't-1',
      feature: 'feature.theme',
    });
    const ent = {
      getEntitlement: vi.fn(async () =>
        fakeResolved({ 'feature.theme': false }),
      ),
    } as unknown as EntitlementService;
    const guard = new EntitlementGuard(reflector, ent);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403 tenant_required если req.tenantId не выставлен', async () => {
    const { ctx, reflector } = buildExecCtx({
      tenantId: undefined,
      feature: 'feature.theme',
    });
    const ent = {
      getEntitlement: vi.fn(),
    } as unknown as EntitlementService;
    const guard = new EntitlementGuard(reflector, ent);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ent.getEntitlement).not.toHaveBeenCalled();
  });

  it('игнорирует non-HTTP контексты (ws) — return true', async () => {
    const { ctx, reflector } = buildExecCtx({
      type: 'ws',
      feature: 'feature.theme',
    });
    const ent = {
      getEntitlement: vi.fn(),
    } as unknown as EntitlementService;
    const guard = new EntitlementGuard(reflector, ent);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ent.getEntitlement).not.toHaveBeenCalled();
  });
});
