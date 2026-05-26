/**
 * Controller-spec для EntitlementsController (Phase F.4).
 *
 * Покрытие:
 *   - GET /me/entitlements — happy: возвращает features+quotas без notes.
 *   - GET /settings/billing — owner: возвращает с notes; не-owner → Forbidden.
 *   - GET /admin/orgs/:tenantId/entitlement — happy для super_admin.
 *   - PATCH /admin/orgs/:tenantId/entitlement — применение tier/overrides/notes,
 *     передача reason в audit.
 *   - BadRequest на пустой tenantId.
 *   - Zod-400 на невалидное тело.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';


import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import type { RbacService } from '../rbac/rbac.service';

import { PatchEntitlementSchema } from './dto/entitlement.dto';
import type {
  EntitlementService,
  ResolvedEntitlement,
} from './entitlement.service';
import { EntitlementsController } from './entitlements.controller';

const userOwner: CurrentUserPayload = {
  id: 'u-owner',
  email: 'o@x',
  role: 'user',
};

function fakeResolved(overrides: Partial<ResolvedEntitlement> = {}): ResolvedEntitlement {
  return {
    tier: 'tier_pro',
    rawTier: 'tier_pro',
    failedSafe: false,
    features: { 'feature.meeting': true } as ResolvedEntitlement['features'],
    quotas: { meetings_per_month: 500 } as ResolvedEntitlement['quotas'],
    featureOverrides: {},
    quotaOverrides: {},
    notes: 'secret notes',
    ...overrides,
  };
}

function build(opts: { canManage?: boolean } = {}) {
  const svc = {
    getEntitlement: vi.fn(async () => fakeResolved()),
    setTier: vi.fn(async () => undefined),
    setOverride: vi.fn(async () => undefined),
    setNotes: vi.fn(async () => undefined),
  } as unknown as EntitlementService;
  const rbac = {
    canManageOrg: vi.fn(async () => opts.canManage ?? true),
  } as unknown as RbacService;
  const ctrl = new EntitlementsController(svc, rbac);
  return { ctrl, svc, rbac };
}

describe('EntitlementsController', () => {
  describe('GET /me/entitlements', () => {
    it('happy: возвращает features+quotas БЕЗ notes', async () => {
      const { ctrl } = build();
      const res = await ctrl.meEntitlements('t-1');
      expect(res.tier).toBe('tier_pro');
      expect(res.notes).toBeUndefined();
    });

    it('BadRequest если tenantId не определён', async () => {
      const { ctrl } = build();
      await expect(ctrl.meEntitlements(undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('GET /settings/billing', () => {
    it('happy для owner: возвращает с notes', async () => {
      const { ctrl } = build({ canManage: true });
      const res = await ctrl.settingsBilling(userOwner, 't-1');
      expect(res.notes).toBe('secret notes');
    });

    it('Forbidden для не-owner', async () => {
      const { ctrl } = build({ canManage: false });
      await expect(
        ctrl.settingsBilling(userOwner, 't-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('GET /admin/orgs/:tenantId/entitlement', () => {
    it('happy: возвращает entitlement любой Org', async () => {
      const { ctrl } = build();
      const res = await ctrl.adminGet('t-other');
      expect(res.tenantId).toBe('t-other');
      expect(res.notes).toBe('secret notes');
    });

    it('BadRequest на пустой tenantId', async () => {
      const { ctrl } = build();
      await expect(ctrl.adminGet('')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('PATCH /admin/orgs/:tenantId/entitlement', () => {
    it('применяет tier через setTier с reason', async () => {
      const { ctrl, svc } = build();
      const body = PatchEntitlementSchema.parse({
        tier: 'tier_enterprise',
        reason: 'переход на enterprise',
      });
      await ctrl.adminPatch('t-1', body, userOwner);
      expect(svc.setTier).toHaveBeenCalledWith(
        't-1',
        'tier_enterprise',
        userOwner.id,
        'переход на enterprise',
      );
    });

    it('применяет featureOverrides через setOverride', async () => {
      const { ctrl, svc } = build();
      const body = PatchEntitlementSchema.parse({
        featureOverrides: { 'feature.theme': true },
        reason: 'unlock themes',
      });
      await ctrl.adminPatch('t-1', body, userOwner);
      expect(svc.setOverride).toHaveBeenCalledWith(
        't-1',
        'feature',
        'feature.theme',
        true,
        userOwner.id,
        'unlock themes',
      );
    });

    it('применяет quotaOverrides через setOverride', async () => {
      const { ctrl, svc } = build();
      const body = PatchEntitlementSchema.parse({
        quotaOverrides: { meetings_per_month: 1000 },
        reason: 'bump quota',
      });
      await ctrl.adminPatch('t-1', body, userOwner);
      expect(svc.setOverride).toHaveBeenCalledWith(
        't-1',
        'quota',
        'meetings_per_month',
        1000,
        userOwner.id,
        'bump quota',
      );
    });

    it('применяет notes через setNotes', async () => {
      const { ctrl, svc } = build();
      const body = PatchEntitlementSchema.parse({
        notes: 'enterprise customer, custom contract',
        reason: 'manual note',
      });
      await ctrl.adminPatch('t-1', body, userOwner);
      expect(svc.setNotes).toHaveBeenCalledWith(
        't-1',
        'enterprise customer, custom contract',
      );
    });

    it('BadRequest на пустой tenantId', async () => {
      const { ctrl } = build();
      const body = PatchEntitlementSchema.parse({
        tier: 'tier_pro',
        reason: 'r',
      });
      await expect(
        ctrl.adminPatch('', body, userOwner),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('PatchEntitlementSchema Zod-валидация', () => {
    it('400 если ни одного поля не передано (требуется хотя бы одно)', () => {
      const r = PatchEntitlementSchema.safeParse({ reason: 'x' });
      expect(r.success).toBe(false);
    });

    it('400 если reason пустой', () => {
      const r = PatchEntitlementSchema.safeParse({ tier: 'tier_pro', reason: '' });
      expect(r.success).toBe(false);
    });

    it('400 на неизвестный tier', () => {
      const r = PatchEntitlementSchema.safeParse({
        tier: 'tier_galaxy',
        reason: 'x',
      });
      expect(r.success).toBe(false);
    });

    it('400 на неизвестный FeatureKey', () => {
      const r = PatchEntitlementSchema.safeParse({
        featureOverrides: { 'feature.unknown': true },
        reason: 'x',
      });
      expect(r.success).toBe(false);
    });

    it('200 валидный body только с tier (без overrides)', () => {
      const r = PatchEntitlementSchema.safeParse({
        tier: 'tier_pro',
        reason: 'r',
      });
      expect(r.success).toBe(true);
    });

    it('200 валидный body только с notes (без overrides)', () => {
      const r = PatchEntitlementSchema.safeParse({
        notes: 'note text',
        reason: 'r',
      });
      expect(r.success).toBe(true);
    });
  });
});
