/**
 * ТЗ 2026-06-10 meeting-visibility (Ф2) — юнит-тесты MeetingVisibilityService.
 *
 * Покрываем чистый предикат canView (таблица сценариев) и buildListWhere.
 * prisma/resolver для этих чистых методов не нужны — передаём заглушки.
 */
import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';

import {
  MeetingVisibilityService,
  type MeetingVisibilityCtx,
} from './meeting-visibility.service';
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
        ctx: NON_BYPASS, // personId='p-1'
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
    // тот же off-сервис: owner всё ещё видит
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
    const participantsBranch = or.find(
      (b) => 'participants' in b,
    ) as { participants?: { some?: { userId?: string } } } | undefined;
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
