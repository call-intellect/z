import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { MeetingVisibilityService, type MeetingVisibilityCtx } from './meeting-visibility.service';
import type { KnowledgeAccessResolver } from '../rbac/knowledge-access-resolver.service';

const prismaStub = {} as unknown as PrismaService;
const resolverStub = {} as unknown as KnowledgeAccessResolver;

function buildService(enabled: boolean): MeetingVisibilityService {
  const cfg = { meetingVisibilityEnabled: enabled } as unknown as TypedConfigService;
  return new MeetingVisibilityService(prismaStub, resolverStub, cfg);
}

const NON_BYPASS: MeetingVisibilityCtx = { personId: 'p-1', isBypass: false, groupIds: [] };
const BYPASS: MeetingVisibilityCtx = { personId: null, isBypass: true, groupIds: [] };

function meeting(scope: string, grants: { granteeType: string; granteeId: string }[] = []) {
  return { ownerId: 'owner-u', visibilityScope: scope, accessGrants: grants };
}

describe('MeetingVisibilityService.canView', () => {
  const svc = buildService(true);

  it('owner (ownerId===userId) → true', () => {
    expect(
      svc.canView({
        meeting: meeting('owner_only'),
        userId: 'owner-u',
        ctx: NON_BYPASS,
        isParticipant: false,
      }),
    ).toBe(true);
  });

  it('bypass (ctx.isBypass) → true', () => {
    expect(
      svc.canView({
        meeting: meeting('owner_only'),
        userId: 'someone',
        ctx: BYPASS,
        isParticipant: false,
      }),
    ).toBe(true);
  });

  it("scope='org', любой → true", () => {
    expect(
      svc.canView({
        meeting: meeting('org'),
        userId: 'random-u',
        ctx: NON_BYPASS,
        isParticipant: false,
      }),
    ).toBe(true);
  });

  it("scope='participants' + isParticipant=true → true", () => {
    expect(
      svc.canView({
        meeting: meeting('participants'),
        userId: 'random-u',
        ctx: NON_BYPASS,
        isParticipant: true,
      }),
    ).toBe(true);
  });

  it("scope='participants' + isParticipant=false → false", () => {
    expect(
      svc.canView({
        meeting: meeting('participants'),
        userId: 'random-u',
        ctx: NON_BYPASS,
        isParticipant: false,
      }),
    ).toBe(false);
  });

  it("scope='custom' + person-грант → true", () => {
    expect(
      svc.canView({
        meeting: meeting('custom', [{ granteeType: 'person', granteeId: 'p-1' }]),
        userId: 'random-u',
        ctx: NON_BYPASS,
        isParticipant: false,
      }),
    ).toBe(true);
  });

  it("scope='custom' + group-грант (member группы) → true", () => {
    expect(
      svc.canView({
        meeting: meeting('custom', [{ granteeType: 'group', granteeId: 'g1' }]),
        userId: 'random-u',
        ctx: { personId: 'p-2', isBypass: false, groupIds: ['g1'] },
        isParticipant: false,
      }),
    ).toBe(true);
  });

  it("scope='custom' + НЕ член/НЕ грант → false", () => {
    expect(
      svc.canView({
        meeting: meeting('custom', []),
        userId: 'random-u',
        ctx: NON_BYPASS,
        isParticipant: false,
      }),
    ).toBe(false);
  });

  it("scope='owner_only' + участник (не owner) → false", () => {
    expect(
      svc.canView({
        meeting: meeting('owner_only'),
        userId: 'random-u',
        ctx: NON_BYPASS,
        isParticipant: true,
      }),
    ).toBe(false);
  });

  it('kill-switch off + участник → false (только owner)', () => {
    const off = buildService(false);
    expect(
      off.canView({
        meeting: meeting('participants'),
        userId: 'random-u',
        ctx: NON_BYPASS,
        isParticipant: true,
      }),
    ).toBe(false);
    expect(
      off.canView({
        meeting: meeting('participants'),
        userId: 'owner-u',
        ctx: NON_BYPASS,
        isParticipant: false,
      }),
    ).toBe(true);
  });
});

describe('MeetingVisibilityService.buildListWhere', () => {
  it('enabled + не-bypass → OR содержит ownerId и participants-ветку, tenantId присутствует', () => {
    const svc = buildService(true);
    const where = svc.buildListWhere(NON_BYPASS, 't-1', 'u-1');
    expect(where.tenantId).toBe('t-1');
    expect(Array.isArray(where.OR)).toBe(true);
    const or = where.OR as Array<Record<string, unknown>>;
    expect(or).toContainEqual({ ownerId: 'u-1' });
    const participantsBranch = or.find((b) => 'participants' in b) as
      | { participants?: { some?: { userId?: string } } }
      | undefined;
    expect(participantsBranch?.participants?.some?.userId).toBe('u-1');
  });

  it('kill-switch off → { ownerId: userId }', () => {
    const svc = buildService(false);
    expect(svc.buildListWhere(NON_BYPASS, 't-1', 'u-1')).toEqual({ ownerId: 'u-1' });
  });

  it('bypass → { tenantId }', () => {
    const svc = buildService(true);
    expect(svc.buildListWhere(BYPASS, 't-1', 'u-1')).toEqual({ tenantId: 't-1' });
  });
});

describe('MeetingVisibilityService.getVisibility', () => {
  function buildWithPrisma(prisma: unknown): MeetingVisibilityService {
    const cfg = { meetingVisibilityEnabled: true } as unknown as TypedConfigService;
    return new MeetingVisibilityService(prisma as PrismaService, resolverStub, cfg);
  }

  it('возвращает scope из meeting + гранты с человекочитаемыми именами', async () => {
    const prisma = {
      meetingAccessGrant: {
        findMany: vi.fn().mockResolvedValue([
          { granteeType: 'person', granteeId: 'p1' },
          { granteeType: 'group', granteeId: 'g1' },
        ]),
      },
      person: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Иван' }]),
      },
      knowledgeGroup: {
        findMany: vi.fn().mockResolvedValue([{ id: 'g1', name: 'Руководство' }]),
      },
    };
    const svc = buildWithPrisma(prisma);
    const res = await svc.getVisibility({ id: 'm1', tenantId: 't1', visibilityScope: 'custom' });
    expect(res.scope).toBe('custom');
    expect(res.grants).toEqual([
      { granteeType: 'person', granteeId: 'p1', name: 'Иван' },
      { granteeType: 'group', granteeId: 'g1', name: 'Руководство' },
    ]);
  });
});

describe('MeetingVisibilityService.setVisibility', () => {
  function buildWithPrisma(prisma: unknown): MeetingVisibilityService {
    const cfg = { meetingVisibilityEnabled: true } as unknown as TypedConfigService;
    return new MeetingVisibilityService(prisma as PrismaService, resolverStub, cfg);
  }

  function makeTxMock() {
    return {
      meeting: { update: vi.fn().mockResolvedValue({}) },
      meetingAccessGrant: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  it('custom без grants → BadRequestException(grants_required_for_custom), $transaction не вызван', async () => {
    const $transaction = vi.fn();
    const svc = buildWithPrisma({ $transaction });
    await expect(
      svc.setVisibility({ id: 'm1', tenantId: 't1' }, 'u1', { scope: 'custom' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'grants_required_for_custom' } },
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('custom с невалидным grantee → BadRequestException(invalid_grantee)', async () => {
    const $transaction = vi.fn();
    const prisma = {
      person: { findMany: vi.fn().mockResolvedValue([]) },
      knowledgeGroup: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction,
    };
    const svc = buildWithPrisma(prisma);
    await expect(
      svc.setVisibility({ id: 'm1', tenantId: 't1' }, 'u1', {
        scope: 'custom',
        grants: [{ granteeType: 'person', granteeId: 'p-x' }],
      }),
    ).rejects.toMatchObject({ response: { error: { code: 'invalid_grantee' } } });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("scope='org' → $transaction: update + deleteMany вызваны, createMany НЕ вызван", async () => {
    const tx = makeTxMock();
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));
    const svc = buildWithPrisma({ $transaction });
    await svc.setVisibility({ id: 'm1', tenantId: 't1' }, 'u1', { scope: 'org' });
    expect(tx.meeting.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { visibilityScope: 'org' },
    });
    expect(tx.meetingAccessGrant.deleteMany).toHaveBeenCalledWith({
      where: { meetingId: 'm1' },
    });
    expect(tx.meetingAccessGrant.createMany).not.toHaveBeenCalled();
  });

  it("scope='custom' валидный → createMany вызван с 1 грантом (grantedById=userId)", async () => {
    const tx = makeTxMock();
    const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<void>) => cb(tx));
    const prisma = {
      person: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
      knowledgeGroup: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction,
    };
    const svc = buildWithPrisma(prisma);
    await svc.setVisibility({ id: 'm1', tenantId: 't1' }, 'u-host', {
      scope: 'custom',
      grants: [{ granteeType: 'person', granteeId: 'p1' }],
    });
    expect(tx.meetingAccessGrant.deleteMany).toHaveBeenCalled();
    expect(tx.meetingAccessGrant.createMany).toHaveBeenCalledTimes(1);
    const arg = tx.meetingAccessGrant.createMany.mock.calls[0]?.[0] as {
      data: unknown;
    };
    expect(arg.data).toEqual([
      {
        tenantId: 't1',
        meetingId: 'm1',
        granteeType: 'person',
        granteeId: 'p1',
        grantedById: 'u-host',
      },
    ]);
  });

  it('BadRequestException действительно от @nestjs/common', async () => {
    const svc = buildWithPrisma({ $transaction: vi.fn() });
    await svc.setVisibility({ id: 'm1', tenantId: 't1' }, 'u1', { scope: 'custom' }).catch((e) => {
      expect(e).toBeInstanceOf(BadRequestException);
    });
  });
});
