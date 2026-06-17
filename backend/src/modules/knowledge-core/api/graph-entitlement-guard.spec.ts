/**
 * G1 (MASTER §6) — гард-тест: платная feature.graph не обходится через
 * entity/block граф-эндпоинты, а mark-wrong ограничен rate-limit'ом.
 *
 * Контекст: KnowledgeGraphController целиком гейтится @RequireEntitlement(
 * 'feature.graph') на уровне класса. Но тот же графовый контент отдают
 * entity-centric / block-centric эндпоинты в KnowledgeEntitiesController и
 * KnowledgeBlocksController — без декоратора они были обходом paywall'а.
 *
 * Покрытие:
 *   - Граф/связь-эндпоинты несут метадату feature.graph (handler) → глобальный
 *     EntitlementGuard на выключенной фиче бросает 403 entitlement_required.
 *   - Базовые просмотровые эндпоинты (list/byId) НЕ гейтятся (FREE сохранён).
 *   - mark-wrong несёт throttle-метадату (limit=30/мин) → rate-limit применён.
 *
 * Тест работает на метаданных декораторов (без БД) — детерминирован.
 */
import 'reflect-metadata';

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { EntitlementGuard } from '../../entitlements/entitlement.guard';
import type {
  EntitlementService,
  ResolvedEntitlement,
} from '../../entitlements/entitlement.service';
import { REQUIRE_ENTITLEMENT_KEY } from '../../entitlements/require-entitlement.decorator';
import type { FeatureKey } from '../../entitlements/tier-config';

import { KnowledgeBlocksController } from './blocks.controller';
import { KnowledgeEntitiesController } from './entities.controller';

const reflector = new Reflector();

/** feature-ключ, навешанный на handler контроллера (или undefined). */
function featureOf(
  ctor: new (...args: never[]) => object,
  method: string,
): FeatureKey | undefined {
  const handler = (ctor.prototype as Record<string, unknown>)[method];
  return reflector.get(REQUIRE_ENTITLEMENT_KEY, handler as never) as
    | FeatureKey
    | undefined;
}

function fakeResolved(
  features: Partial<Record<FeatureKey, boolean>>,
): ResolvedEntitlement {
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

describe('G1 — feature.graph закрывает обходные граф-эндпоинты', () => {
  it('entity/block граф+связи помечены feature.graph', () => {
    expect(featureOf(KnowledgeEntitiesController, 'links')).toBe('feature.graph');
    expect(featureOf(KnowledgeEntitiesController, 'getGraph')).toBe(
      'feature.graph',
    );
    expect(featureOf(KnowledgeBlocksController, 'links')).toBe('feature.graph');
    expect(
      featureOf(KnowledgeBlocksController, 'reasoningChainEndpoint'),
    ).toBe('feature.graph');
  });

  it('базовые просмотровые эндпоинты НЕ гейтятся (FREE-доступ сохранён)', () => {
    expect(featureOf(KnowledgeEntitiesController, 'list')).toBeUndefined();
    expect(featureOf(KnowledgeEntitiesController, 'byId')).toBeUndefined();
    expect(featureOf(KnowledgeBlocksController, 'byId')).toBeUndefined();
  });

  it('EntitlementGuard на метадате граф-эндпоинта без feature.graph → 403', async () => {
    // Симулируем реальный handler-метадату links: глобальный guard прочитает
    // feature.graph и на FREE-тарифе (feature.graph=false) бросит 403.
    const realFeature = featureOf(KnowledgeEntitiesController, 'getGraph');
    const ref = new Reflector();
    vi.spyOn(ref, 'getAllAndOverride').mockReturnValue(realFeature);
    const ent = {
      getEntitlement: vi.fn(async () =>
        fakeResolved({ 'feature.graph': false }),
      ),
    } as unknown as EntitlementService;
    const guard = new EntitlementGuard(ref, ent);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ tenantId: 't-1' }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
      getType: () => 'http',
    } as never;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('EntitlementGuard пропускает граф-эндпоинт при включённой feature.graph', async () => {
    const realFeature = featureOf(KnowledgeBlocksController, 'links');
    const ref = new Reflector();
    vi.spyOn(ref, 'getAllAndOverride').mockReturnValue(realFeature);
    const ent = {
      getEntitlement: vi.fn(async () =>
        fakeResolved({ 'feature.graph': true }),
      ),
    } as unknown as EntitlementService;
    const guard = new EntitlementGuard(ref, ent);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ tenantId: 't-1' }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
      getType: () => 'http',
    } as never;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('G1 — mark-wrong rate-limit', () => {
  it('markWrong помечен @Throttle с лимитом 30/мин', () => {
    const handler = KnowledgeEntitiesController.prototype.markWrong as object;
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler);
    expect(limit).toBe(30);
    expect(ttl).toBe(60_000);
  });

  it('базовые эндпоинты без точечного throttle (markWrong — единственный)', () => {
    const listHandler = KnowledgeEntitiesController.prototype.list as object;
    expect(
      Reflect.getMetadata('THROTTLER:LIMITdefault', listHandler),
    ).toBeUndefined();
  });
});
