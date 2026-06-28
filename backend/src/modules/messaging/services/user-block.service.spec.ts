import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { UserBlockService } from './user-block.service';

describe('UserBlockService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blockInConversation создаёт UserBlock (upsert)', async () => {
    const upsert = vi.fn(async () => ({ id: 'ub-1' }));
    const prisma = {
      conversationMember: {
        findUnique: vi.fn(async () => ({ id: 'm' })),
      },
      userBlock: { upsert },
    } as unknown as PrismaService;
    const svc = new UserBlockService(prisma);
    const res = await svc.blockInConversation({
      tenantId: 'org1',
      conversationId: 'conv1',
      blockerUserId: 'a',
      blockedUserId: 'b',
    });
    expect(res.id).toBe('ub-1');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { tenantId: 'org1', blockerUserId: 'a', blockedUserId: 'b' },
      }),
    );
  });

  it('нельзя заблокировать себя → 403', async () => {
    const prisma = {} as unknown as PrismaService;
    const svc = new UserBlockService(prisma);
    await expect(
      svc.blockInConversation({
        tenantId: 'org1',
        conversationId: 'conv1',
        blockerUserId: 'a',
        blockedUserId: 'a',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('isSendBlockedInConversation: в dm заблокированный автор → true', async () => {
    const prisma = {
      conversation: { findUnique: vi.fn(async () => ({ kind: 'dm' })) },
      conversationMember: { findMany: vi.fn(async () => [{ userId: 'recipient' }]) },
      userBlock: { findFirst: vi.fn(async () => ({ id: 'ub-1' })) },
    } as unknown as PrismaService;
    const svc = new UserBlockService(prisma);
    const blocked = await svc.isSendBlockedInConversation({
      tenantId: 'org1',
      conversationId: 'conv1',
      authorUserId: 'author',
    });
    expect(blocked).toBe(true);
  });

  it('isSendBlockedInConversation: не dm → false (без проверки блоков)', async () => {
    const findFirst = vi.fn();
    const prisma = {
      conversation: { findUnique: vi.fn(async () => ({ kind: 'group' })) },
      conversationMember: { findMany: vi.fn() },
      userBlock: { findFirst },
    } as unknown as PrismaService;
    const svc = new UserBlockService(prisma);
    const blocked = await svc.isSendBlockedInConversation({
      tenantId: 'org1',
      conversationId: 'conv1',
      authorUserId: 'author',
    });
    expect(blocked).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('isSendBlockedInConversation: dm, не заблокирован → false', async () => {
    const prisma = {
      conversation: { findUnique: vi.fn(async () => ({ kind: 'dm' })) },
      conversationMember: { findMany: vi.fn(async () => [{ userId: 'recipient' }]) },
      userBlock: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;
    const svc = new UserBlockService(prisma);
    const blocked = await svc.isSendBlockedInConversation({
      tenantId: 'org1',
      conversationId: 'conv1',
      authorUserId: 'author',
    });
    expect(blocked).toBe(false);
  });
});
