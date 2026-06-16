import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { OwnerResolverService } from './owner-resolver.service';

interface HolderPerson {
  userId: string | null;
  deletedAt?: Date | null;
}

function makeResolver(args?: {
  appointmentHolders?: HolderPerson[];
  personRoleHolders?: HolderPerson[];
}): {
  resolver: OwnerResolverService;
  appointmentFindMany: ReturnType<typeof vi.fn>;
  personRoleFindMany: ReturnType<typeof vi.fn>;
} {
  const appointmentFindMany = vi
    .fn()
    .mockResolvedValue((args?.appointmentHolders ?? []).map((person) => ({ person })));
  const personRoleFindMany = vi
    .fn()
    .mockResolvedValue((args?.personRoleHolders ?? []).map((person) => ({ person })));
  const prisma = {
    appointment: { findMany: appointmentFindMany },
    personRole: { findMany: personRoleFindMany },
  } as unknown as PrismaService;
  return {
    resolver: new OwnerResolverService(prisma),
    appointmentFindMany,
    personRoleFindMany,
  };
}

describe('OwnerResolverService.resolve — лестница владельца', () => {
  it('1) parentOwnerUserId → resolved (без обращения к БД)', async () => {
    const env = makeResolver();
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      parentOwnerUserId: 'user-parent',
      roleId: 'role-1',
    });
    expect(res).toEqual({ kind: 'resolved', userId: 'user-parent' });
    expect(env.appointmentFindMany).not.toHaveBeenCalled();
  });

  it('2a) roleId с ровно одним активным держателем → resolved', async () => {
    const env = makeResolver({
      appointmentHolders: [{ userId: 'user-holder' }],
    });
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      roleId: 'role-1',
    });
    expect(res).toEqual({ kind: 'resolved', userId: 'user-holder' });
    expect(env.personRoleFindMany).not.toHaveBeenCalled();
  });

  it('2b) roleId с несколькими держателями → ambiguous с их userId', async () => {
    const env = makeResolver({
      appointmentHolders: [{ userId: 'user-a' }, { userId: 'user-b' }],
    });
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      roleId: 'role-1',
    });
    expect(res.kind).toBe('ambiguous');
    if (res.kind === 'ambiguous') {
      expect(res.candidates.sort()).toEqual(['user-a', 'user-b']);
    }
  });

  it('2c) Appointment пуст → fallback на PersonRole (legacy)', async () => {
    const env = makeResolver({
      appointmentHolders: [],
      personRoleHolders: [{ userId: 'user-legacy' }],
    });
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      roleId: 'role-1',
    });
    expect(res).toEqual({ kind: 'resolved', userId: 'user-legacy' });
    expect(env.personRoleFindMany).toHaveBeenCalledTimes(1);
  });

  it('3) роль без держателей + authorUserId → resolved автором', async () => {
    const env = makeResolver();
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      roleId: 'role-empty',
      authorUserId: 'user-author',
    });
    expect(res).toEqual({ kind: 'resolved', userId: 'user-author' });
  });

  it('4a) candidatePool из одного → resolved', async () => {
    const env = makeResolver();
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      candidatePool: ['user-only'],
    });
    expect(res).toEqual({ kind: 'resolved', userId: 'user-only' });
  });

  it('4b) candidatePool из нескольких → ambiguous (дедуп повторов)', async () => {
    const env = makeResolver();
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      candidatePool: ['user-a', 'user-b', 'user-a'],
    });
    expect(res.kind).toBe('ambiguous');
    if (res.kind === 'ambiguous') {
      expect(res.candidates.sort()).toEqual(['user-a', 'user-b']);
    }
  });

  it('5) ничего не передано → none', async () => {
    const env = makeResolver();
    const res = await env.resolver.resolve({ tenantId: 'org-1' });
    expect(res).toEqual({ kind: 'none' });
  });

  it('держатели без привязанного User (userId null) и уволенные (deletedAt) не считаются', async () => {
    const env = makeResolver({
      appointmentHolders: [
        { userId: null },
        { userId: 'user-fired', deletedAt: new Date() },
        { userId: 'user-active' },
      ],
    });
    const res = await env.resolver.resolve({
      tenantId: 'org-1',
      roleId: 'role-1',
    });
    expect(res).toEqual({ kind: 'resolved', userId: 'user-active' });
  });
});
