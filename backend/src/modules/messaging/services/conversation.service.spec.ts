import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ConversationService } from './conversation.service';

describe('ConversationService.ensureCompanyChannel', () => {
  function makeTx(existing: { id: string } | null) {
    const upsert = vi.fn().mockResolvedValue({});
    const create = vi.fn(async () => ({ id: 'company_new' }));
    return {
      tx: {
        conversation: {
          findFirst: vi.fn().mockResolvedValue(existing),
          create,
        },
        conversationMember: { upsert },
      },
      create,
      upsert,
    };
  }

  let memberships: Array<{ userId: string; role: string }>;

  beforeEach(() => {
    memberships = [
      { userId: 'owner_1', role: 'owner' },
      { userId: 'm_2', role: 'member' },
      { userId: 'm_3', role: 'member' },
    ];
  });

  it('канала нет → создаёт один + донабор всех активных членов owner-ом создателя', async () => {
    const { tx, create, upsert } = makeTx(null);
    const prisma = {
      membership: { findMany: vi.fn().mockResolvedValue(memberships) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    const res = await service.ensureCompanyChannel('org_1', 'owner_1');

    expect(res.id).toBe('company_new');
    expect(create).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it('идемпотентно: канал есть → НЕ создаёт, возвращает существующий id', async () => {
    const { tx, create } = makeTx({ id: 'company_existing' });
    const prisma = {
      membership: { findMany: vi.fn().mockResolvedValue(memberships) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    const res = await service.ensureCompanyChannel('org_1', 'owner_1');

    expect(res.id).toBe('company_existing');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('ConversationService dm dedup', () => {
  function membershipFindMany() {
    return vi.fn((args: { where: { userId: { in: string[] } } }) =>
      Promise.resolve(args.where.userId.in.map((userId) => ({ userId }))),
    );
  }

  it('второй dm с тем же собеседником → тот же id, create не вызывается повторно', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'dm_1' });
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'dm_1' });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: 'dm_1' });
    const prisma = {
      membership: { findMany: membershipFindMany() },
      conversation: { create, findFirst, findUniqueOrThrow },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    const first = await service.createConversation({
      tenantId: 'org_1',
      kind: 'dm',
      createdByUserId: 'a',
      memberUserIds: ['b'],
    });
    const second = await service.createConversation({
      tenantId: 'org_1',
      kind: 'dm',
      createdByUserId: 'a',
      memberUserIds: ['b'],
    });

    expect(first.id).toBe('dm_1');
    expect(second.id).toBe('dm_1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('dm с другим собеседником → другой id (findFirst=null → create)', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'dm_ab' })
      .mockResolvedValueOnce({ id: 'dm_ac' });
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      membership: { findMany: membershipFindMany() },
      conversation: { create, findFirst, findUniqueOrThrow: vi.fn() },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    const r1 = await service.createConversation({
      tenantId: 'org_1',
      kind: 'dm',
      createdByUserId: 'a',
      memberUserIds: ['b'],
    });
    const r2 = await service.createConversation({
      tenantId: 'org_1',
      kind: 'dm',
      createdByUserId: 'a',
      memberUserIds: ['c'],
    });

    expect(r1.id).toBe('dm_ab');
    expect(r2.id).toBe('dm_ac');
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('group из тех же людей → всегда новый id, дедуп не срабатывает', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: 'g_1' })
      .mockResolvedValueOnce({ id: 'g_2' });
    const findFirst = vi.fn();
    const prisma = {
      membership: { findMany: membershipFindMany() },
      conversation: { create, findFirst, findUniqueOrThrow: vi.fn() },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    const r1 = await service.createConversation({
      tenantId: 'org_1',
      kind: 'group',
      createdByUserId: 'a',
      memberUserIds: ['b'],
    });
    const r2 = await service.createConversation({
      tenantId: 'org_1',
      kind: 'group',
      createdByUserId: 'a',
      memberUserIds: ['b'],
    });

    expect(r1.id).toBe('g_1');
    expect(r2.id).toBe('g_2');
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('ConversationService.isMandatory / getMemberRole', () => {
  it('isMandatory читает флаг', async () => {
    const prisma = {
      conversation: { findUnique: vi.fn().mockResolvedValue({ isMandatory: true }) },
    } as unknown as PrismaService;
    expect(await new ConversationService(prisma).isMandatory('c1')).toBe(true);
  });

  it('getMemberRole отдаёт роль или null', async () => {
    const prisma = {
      conversationMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ role: 'admin' })
          .mockResolvedValueOnce(null),
      },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);
    expect(await service.getMemberRole('c1', 'u1')).toBe('admin');
    expect(await service.getMemberRole('c1', 'u2')).toBeNull();
  });
});

describe('ConversationService tenant-scoping', () => {
  it('createConversation отклоняет участника не из org (USER_NOT_IN_TENANT)', async () => {
    const create = vi.fn();
    const prisma = {
      membership: { findMany: vi.fn().mockResolvedValue([{ userId: 'creator' }]) },
      conversation: { create },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);
    await expect(
      service.createConversation({
        tenantId: 'org_1',
        kind: 'group',
        createdByUserId: 'creator',
        memberUserIds: ['foreign'],
      }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('createConversation создаёт, когда все участники в org', async () => {
    const prisma = {
      membership: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'creator' }, { userId: 'm2' }]),
      },
      conversation: { create: vi.fn().mockResolvedValue({ id: 'c_new' }) },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);
    const res = await service.createConversation({
      tenantId: 'org_1',
      kind: 'group',
      createdByUserId: 'creator',
      memberUserIds: ['m2'],
    });
    expect(res.id).toBe('c_new');
  });

  it('addMember отклоняет userId не из org разговора', async () => {
    const upsert = vi.fn();
    const prisma = {
      conversation: { findUnique: vi.fn().mockResolvedValue({ tenantId: 'org_1' }) },
      membership: { findMany: vi.fn().mockResolvedValue([]) },
      conversationMember: { upsert },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);
    await expect(service.addMember({ conversationId: 'c1', userId: 'foreign' })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
