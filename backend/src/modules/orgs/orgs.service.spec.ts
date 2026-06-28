import { ForbiddenException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { SubscriptionService } from '../billing/services/subscription.service';
import type { PersonsService } from '../persons/services/persons.service';
import type { RbacService } from '../rbac/rbac.service';
import type { TablesAutoProvisionService } from '../tables/services/tables-auto-provision.service';

import { OrgsService } from './orgs.service';

describe('OrgsService.listTeamRoster', () => {
  let prisma: {
    person: { findMany: ReturnType<typeof vi.fn> };
    membership: { findMany: ReturnType<typeof vi.fn> };
    channelBinding: { findMany: ReturnType<typeof vi.fn> };
  };
  let rbac: { loadContext: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      person: { findMany: vi.fn(async () => []) },
      membership: { findMany: vi.fn(async () => []) },
      channelBinding: { findMany: vi.fn(async () => []) },
    };
    rbac = {
      loadContext: vi.fn(async () => ({ role: 'owner', isSuperAdmin: false })),
    };
  });

  function make(): OrgsService {
    return new OrgsService(
      prisma as unknown as PrismaService,
      rbac as unknown as RbacService,
      {} as unknown as SubscriptionService,
      {} as unknown as TablesAutoProvisionService,
      {} as unknown as PersonsService,
      { emit: vi.fn() } as unknown as EventEmitter2,
    );
  }

  it('merge: Person с userId(manager) ⊕ Membership(owner) без Person → 2 строки, владелец не дублируется', async () => {
    prisma.person.findMany.mockResolvedValue([
      {
        id: 'p-1',
        userId: 'u-manager',
        name: 'Иван Менеджеров',
        email: 'ivan@x.test',
        primaryDepartmentId: 'dep-1',
        primaryDepartment: { id: 'dep-1', name: 'Продажи' },
        personRoles: [{ role: { id: 'r-pr', name: 'PersonRole-должность' } }],
        appointments: [{ role: { id: 'r-app', name: 'Менеджер' } }],
        invitations: [{ id: 'inv-1', status: 'accepted' }],
      },
    ]);
    prisma.membership.findMany.mockResolvedValue([
      {
        userId: 'u-manager',
        role: 'manager',
        user: { id: 'u-manager', email: 'ivan@x.test', name: 'Иван Менеджеров' },
      },
      {
        userId: 'u-owner',
        role: 'owner',
        user: { id: 'u-owner', email: 'owner@x.test', name: 'Влад Владельцев' },
      },
    ]);
    prisma.channelBinding.findMany.mockResolvedValue([{ userId: 'u-manager' }]);

    const svc = make();
    const roster = await svc.listTeamRoster('org-1', 'u-owner');

    expect(roster).toHaveLength(2);

    const personRow = roster.find((r) => r.personId === 'p-1');
    expect(personRow).toMatchObject({
      personId: 'p-1',
      userId: 'u-manager',
      fullName: 'Иван Менеджеров',
      roleId: 'r-app',
      roleName: 'Менеджер',
      departmentId: 'dep-1',
      departmentName: 'Продажи',
      systemRole: 'manager',
      hasPersonCard: true,
      telegramLinked: true,
      invitationId: 'inv-1',
    });

    const ownerRow = roster.find((r) => r.userId === 'u-owner');
    expect(ownerRow).toMatchObject({
      personId: null,
      userId: 'u-owner',
      fullName: 'Влад Владельцев',
      systemRole: 'owner',
      invitationStatus: 'accepted',
      invitationId: null,
      hasPersonCard: false,
      telegramLinked: false,
    });

    expect(roster.filter((r) => r.userId === 'u-manager')).toHaveLength(1);
  });

  it('telegramLinked: помечается по ChannelBinding(telegram_bot)', async () => {
    prisma.person.findMany.mockResolvedValue([]);
    prisma.membership.findMany.mockResolvedValue([
      {
        userId: 'u-owner',
        role: 'owner',
        user: { id: 'u-owner', email: 'owner@x.test', name: 'Владелец' },
      },
      {
        userId: 'u-other',
        role: 'manager',
        user: { id: 'u-other', email: 'other@x.test', name: 'Другой' },
      },
    ]);
    prisma.channelBinding.findMany.mockResolvedValue([{ userId: 'u-owner' }]);

    const svc = make();
    const roster = await svc.listTeamRoster('org-1', 'u-owner');

    expect(roster.find((r) => r.userId === 'u-owner')?.telegramLinked).toBe(true);
    expect(roster.find((r) => r.userId === 'u-other')?.telegramLinked).toBe(false);
  });

  it('дедуп: аккаунт-карточка ⊕ ручная карточка, тот же email (разный регистр) → 1 строка, accepted, человеческое имя/должность', async () => {
    prisma.person.findMany.mockResolvedValue([
      {
        id: 'p-acc',
        userId: 'u-ain',
        name: 'ainaz860707',
        email: 'Ainaz@x.test',
        primaryDepartmentId: null,
        primaryDepartment: null,
        personRoles: [],
        appointments: [],
        invitations: [],
      },
      {
        id: 'p-man',
        userId: null,
        name: 'Айназ',
        email: 'ainaz@x.test',
        primaryDepartmentId: 'dep-9',
        primaryDepartment: { id: 'dep-9', name: 'Внедрение' },
        personRoles: [],
        appointments: [{ role: { id: 'r-impl', name: 'руководитель отдела внедрения' } }],
        invitations: [],
      },
    ]);
    prisma.membership.findMany.mockResolvedValue([
      {
        userId: 'u-ain',
        role: 'admin',
        user: { id: 'u-ain', email: 'Ainaz@x.test', name: 'ainaz860707' },
      },
    ]);
    prisma.channelBinding.findMany.mockResolvedValue([]);

    const svc = make();
    const roster = await svc.listTeamRoster('org-1', 'u-ain');

    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      userId: 'u-ain',
      fullName: 'Айназ',
      roleName: 'руководитель отдела внедрения',
      departmentName: 'Внедрение',
      systemRole: 'admin',
      invitationStatus: 'accepted',
      hasPersonCard: true,
    });
  });

  it('membership без invitation → accepted', async () => {
    prisma.person.findMany.mockResolvedValue([
      {
        id: 'p-o',
        userId: 'u-o',
        name: 'Влад',
        email: 'o@x.test',
        primaryDepartmentId: null,
        primaryDepartment: null,
        personRoles: [],
        appointments: [],
        invitations: [],
      },
    ]);
    prisma.membership.findMany.mockResolvedValue([
      {
        userId: 'u-o',
        role: 'owner',
        user: { id: 'u-o', email: 'o@x.test', name: 'Влад' },
      },
    ]);
    prisma.channelBinding.findMany.mockResolvedValue([]);

    const svc = make();
    const roster = await svc.listTeamRoster('org-1', 'u-o');

    expect(roster).toHaveLength(1);
    expect(roster[0]!.invitationStatus).toBe('accepted');
  });

  it('negative: rbac.loadContext → null → ForbiddenException', async () => {
    rbac.loadContext.mockResolvedValueOnce(null);
    const svc = make();
    await expect(svc.listTeamRoster('org-1', 'u-stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('OrgsService.createForOwner — Person владельца (Ф9)', () => {
  it('создаёт Person через ensurePersonForUser и проставляет membership.personId', async () => {
    const client = {
      org: {
        create: vi.fn(async () => ({ id: 'org-new', name: 'Кора' })),
        findUnique: vi.fn(async () => null),
      },
      membership: {
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      source: { create: vi.fn(async () => ({})) },
    };
    const persons = {
      ensurePersonForUser: vi.fn(async () => ({ id: 'person-owner' })),
    };
    const subscriptions = { ensureDemo: vi.fn(async () => undefined) };
    const tablesAutoProvision = { provisionDefaults: vi.fn(async () => undefined) };
    const rbac = { invalidate: vi.fn(() => undefined) };

    const svc = new OrgsService(
      client as unknown as PrismaService,
      rbac as unknown as RbacService,
      subscriptions as unknown as SubscriptionService,
      tablesAutoProvision as unknown as TablesAutoProvisionService,
      persons as unknown as PersonsService,
      { emit: vi.fn() } as unknown as EventEmitter2,
    );

    const org = await svc.createForOwner({ name: 'Кора', ownerId: 'u-owner' }, client as never);

    expect(org.id).toBe('org-new');
    expect(persons.ensurePersonForUser).toHaveBeenCalledWith(
      { tenantId: 'org-new', userId: 'u-owner' },
      client,
    );
    expect(client.membership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_userId: { orgId: 'org-new', userId: 'u-owner' } },
        data: { personId: 'person-owner' },
      }),
    );
  });
});
