import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';

import { ReferralsController } from './referrals.controller';

const GUARDS_METADATA_KEY = '__guards__';

function getMethodGuards(target: object, methodName: string): unknown[] {
  const method = (target as Record<string, unknown>)[methodName];
  if (typeof method !== 'function') return [];
  return (Reflect.getMetadata(GUARDS_METADATA_KEY, method) as unknown[]) ?? [];
}

function getControllerGuards(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA_KEY, target) as unknown[]) ?? [];
}

describe('ReferralsController guards (Б14)', () => {
  it('controller-level: CookieAuthGuard применён ко всем эндпоинтам', () => {
    const guards = getControllerGuards(ReferralsController);
    expect(guards).toContain(CookieAuthGuard);
  });

  it('attributeCurrentOrg: дополнительно защищён TenantGuard', () => {
    const guards = getMethodGuards(ReferralsController.prototype, 'attributeCurrentOrg');
    expect(guards).toContain(TenantGuard);
  });
});
