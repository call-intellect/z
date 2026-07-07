import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';
import type { ProvenanceService } from '../services/provenance.service';

import { ProvenanceController } from './provenance.controller';

const user: CurrentUserPayload = { id: 'u-1', email: 'e', role: 'user' } as unknown as CurrentUserPayload;

function makeController(role: string | null) {
  const rbac = { getMembershipRole: vi.fn(async () => role) };
  const provenance = {
    resolve: vi.fn(async (_type: string, _id: string, _ctx: { viewerRole?: string }) => []),
  };
  const cfg = { getDynamic: vi.fn(async (_k: string, _e: unknown, d: unknown) => d) };
  const ctrl = new ProvenanceController(
    provenance as unknown as ProvenanceService,
    rbac as unknown as RbacService,
    cfg as unknown as TypedConfigService,
  );
  return { ctrl, rbac, provenance, cfg };
}

describe('ProvenanceController.resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('передаёт роль зрителя из guard-контекста в resolve (friction, manager)', async () => {
    const { ctrl, rbac, provenance } = makeController('manager');

    await ctrl.resolve('friction', 'l-1', user, 't-1');

    expect(rbac.getMembershipRole).toHaveBeenCalledWith('t-1', 'u-1');
    expect(provenance.resolve).toHaveBeenCalledWith(
      'friction',
      'l-1',
      expect.objectContaining({ tenantId: 't-1', userId: 'u-1', viewerRole: 'manager' }),
    );
  });

  it('прокидывает owner-роль из guard в resolve', async () => {
    const { ctrl, provenance } = makeController('owner');

    await ctrl.resolve('friction', 'l-1', user, 't-1');

    expect(provenance.resolve).toHaveBeenCalledWith(
      'friction',
      'l-1',
      expect.objectContaining({ tenantId: 't-1', userId: 'u-1', viewerRole: 'owner' }),
    );
  });

  it('роль null → viewerRole не подставляется как реальная роль', async () => {
    const { ctrl, provenance } = makeController(null);

    await ctrl.resolve('friction', 'l-1', user, 't-1');

    expect(provenance.resolve).toHaveBeenCalledWith(
      'friction',
      'l-1',
      expect.objectContaining({ tenantId: 't-1', userId: 'u-1' }),
    );
    const call = provenance.resolve.mock.calls.at(0);
    expect(call?.[2].viewerRole).toBeUndefined();
  });

  it('невалидный entityType → BadRequestException invalid_entity_type, resolve не вызван', async () => {
    const { ctrl, provenance } = makeController('manager');

    const err = await ctrl.resolve('process', 'x', user, 't-1').catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'invalid_entity_type' });
    expect(provenance.resolve).not.toHaveBeenCalled();
  });

  it('tenantId undefined → ForbiddenException tenant_required, resolve не вызван', async () => {
    const { ctrl, provenance } = makeController('manager');

    const err = await ctrl.resolve('friction', 'l-1', user, undefined).catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      error: { code: 'tenant_required' },
    });
    expect(provenance.resolve).not.toHaveBeenCalled();
  });

  it('goal принимается как валидный entityType и уходит в resolve', async () => {
    const { ctrl, provenance } = makeController('manager');

    await ctrl.resolve('goal', 'g-1', user, 't-1');

    expect(provenance.resolve).toHaveBeenCalledWith(
      'goal',
      'g-1',
      expect.objectContaining({ tenantId: 't-1', userId: 'u-1' }),
    );
  });
});
