import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { SubscriptionService } from '../billing/services/subscription.service';
import type { RbacService } from '../rbac/rbac.service';
import type { TablesAutoProvisionService } from '../tables/services/tables-auto-provision.service';

import { OrgsService } from './orgs.service';

/**
 * ТЗ «Команда + доступы» Фаза 2 — спецификация OrgsService.listTeamRoster.
 *
 * Покрытие:
 *   - merge: Person с userId (привязан к Membership manager) ⊕ Membership(owner)
 *     без Person → 2 строки, владелец не дублируется;
 *   - telegramLinked: помечается по ChannelBinding(telegram_bot);
 *   - negative: rbac.loadContext → null → ForbiddenException.
 */

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
      // appointment имеет приоритет над personRole.
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

    // u-manager не задвоился отдельной membership-строкой.
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
    // Только у владельца есть привязка Telegram.
    prisma.channelBinding.findMany.mockResolvedValue([{ userId: 'u-owner' }]);

    const svc = make();
    const roster = await svc.listTeamRoster('org-1', 'u-owner');

    expect(roster.find((r) => r.userId === 'u-owner')?.telegramLinked).toBe(true);
    expect(roster.find((r) => r.userId === 'u-other')?.telegramLinked).toBe(false);
  });

  it('negative: rbac.loadContext → null → ForbiddenException', async () => {
    rbac.loadContext.mockResolvedValueOnce(null);
    const svc = make();
    await expect(svc.listTeamRoster('org-1', 'u-stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
