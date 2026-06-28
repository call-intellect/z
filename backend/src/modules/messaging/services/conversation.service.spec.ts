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
