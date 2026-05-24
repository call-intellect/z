/**
 * E2E-уровневый spec для entitlement-проверок ключевых эндпоинтов (Phase F.4).
 *
 * Поднимает мини-Nest-приложение с двумя контроллер-методами, каждый
 * помечен `@RequireEntitlement(<key>)`, и пробегается по трём тарифам:
 * tier_basic / tier_pro / tier_enterprise. Под каждым тарифом проверяем,
 * что для соответствующего эндпоинта guard либо пропускает (200), либо
 * блокирует (403).
 *
 * Реальный Nest + ENV не нужны — берём только Guard + Reflector + мок
 * EntitlementService.
 *
 * Покрытие требования ТЗ Phase F (F.4):
 *   - record-meeting       → feature.meeting (доступно basic+).
 *   - export-recording     → feature.export_advanced (pro+).
 *   - ai-report            → feature.ai_report (доступно basic+).
 *
 * Хотя basic пропускает 2 из 3, тест гарантирует, что отсутствие фичи
 * под нужным тарифом → 403, а наличие → 200. Это и есть смысл «3 e2e
 * под разными тарифами».
 */
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { EntitlementGuard } from './entitlement.guard';
import { EntitlementService, ResolvedEntitlement } from './entitlement.service';
import { RequireEntitlement } from './require-entitlement.decorator';
import { ALL_FEATURES, ALL_QUOTAS, FeatureKey, QuotaKey, TIER_CONFIG, TierKey } from './tier-config';

@Controller('test')
class TestEntitledController {
  @Get('record-meeting')
  @RequireEntitlement('feature.meeting')
  recordMeeting() {
    return { ok: true, action: 'record-meeting' };
  }

  @Get('export-recording')
  @RequireEntitlement('feature.export_advanced')
  exportRecording() {
    return { ok: true, action: 'export-recording' };
  }

  @Get('ai-report')
  @RequireEntitlement('feature.ai_report')
  aiReport() {
    return { ok: true, action: 'ai-report' };
  }
}

function buildEntitlementMock(tier: TierKey): EntitlementService {
  const tierCfg = TIER_CONFIG[tier];
  const features = { ...tierCfg.features } as Record<FeatureKey, boolean>;
  const quotas = { ...tierCfg.quotas } as Record<QuotaKey, number>;
  const resolved: ResolvedEntitlement = {
    tier,
    rawTier: tier,
    failedSafe: false,
    features,
    quotas,
    featureOverrides: {},
    quotaOverrides: {},
    notes: null,
  };
  return {
    getEntitlement: async () => resolved,
    hasFeature: async (_t: string, k: FeatureKey) => features[k] === true,
    getQuota: async (_t: string, k: QuotaKey) => quotas[k] ?? 0,
  } as unknown as EntitlementService;
}

async function buildApp(tier: TierKey): Promise<INestApplication> {
  @Module({
    controllers: [TestEntitledController],
    providers: [
      Reflector,
      { provide: EntitlementService, useValue: buildEntitlementMock(tier) },
      { provide: APP_GUARD, useClass: EntitlementGuard },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  // Имитируем TenantGuard (выставляет req.tenantId).
  app.use((req: { tenantId?: string }, _res: unknown, next: () => void) => {
    req.tenantId = 'test-tenant';
    next();
  });
  await app.init();
  return app;
}

let currentApp: INestApplication | null = null;
afterEach(async () => {
  if (currentApp) await currentApp.close();
  currentApp = null;
});

describe('Entitlements E2E под разными тарифами', () => {
  describe('tier_basic', () => {
    it('record-meeting (feature.meeting) → 200', async () => {
      currentApp = await buildApp('tier_basic');
      const res = await request(currentApp.getHttpServer()).get('/test/record-meeting');
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('record-meeting');
    });

    it('export-recording (feature.export_advanced) → 403 entitlement_required', async () => {
      currentApp = await buildApp('tier_basic');
      const res = await request(currentApp.getHttpServer()).get('/test/export-recording');
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('entitlement_required');
      expect(res.body.error?.currentTier).toBe('tier_basic');
    });

    it('ai-report (feature.ai_report) → 200', async () => {
      currentApp = await buildApp('tier_basic');
      const res = await request(currentApp.getHttpServer()).get('/test/ai-report');
      expect(res.status).toBe(200);
    });
  });

  describe('tier_pro', () => {
    it('record-meeting → 200', async () => {
      currentApp = await buildApp('tier_pro');
      const res = await request(currentApp.getHttpServer()).get('/test/record-meeting');
      expect(res.status).toBe(200);
    });

    it('export-recording → 200 (pro имеет export_advanced)', async () => {
      currentApp = await buildApp('tier_pro');
      const res = await request(currentApp.getHttpServer()).get('/test/export-recording');
      expect(res.status).toBe(200);
    });

    it('ai-report → 200', async () => {
      currentApp = await buildApp('tier_pro');
      const res = await request(currentApp.getHttpServer()).get('/test/ai-report');
      expect(res.status).toBe(200);
    });
  });

  describe('tier_enterprise', () => {
    it('все три эндпоинта → 200', async () => {
      currentApp = await buildApp('tier_enterprise');
      const a = await request(currentApp.getHttpServer()).get('/test/record-meeting');
      const b = await request(currentApp.getHttpServer()).get('/test/export-recording');
      const c = await request(currentApp.getHttpServer()).get('/test/ai-report');
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(c.status).toBe(200);
    });
  });

  describe('tier_config sanity', () => {
    it('каждый tier декларирует все FeatureKey и все QuotaKey', () => {
      for (const tier of Object.keys(TIER_CONFIG) as TierKey[]) {
        const fk = Object.keys(TIER_CONFIG[tier].features);
        const qk = Object.keys(TIER_CONFIG[tier].quotas);
        expect(fk.sort()).toEqual([...ALL_FEATURES].sort());
        expect(qk.sort()).toEqual([...ALL_QUOTAS].sort());
      }
    });
  });
});
