import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { AccountsService } from './accounts.service';

function build(opts: { deletedAt?: Date | null; exists?: boolean }) {
  const calls = {
    userUpdate: vi.fn(async () => ({})),
    pushTokenDeleteMany: vi.fn(async () => ({ count: 1 })),
    channelBindingDeleteMany: vi.fn(async () => ({ count: 1 })),
    conversationMemberDeleteMany: vi.fn(async () => ({ count: 1 })),
    userSessionUpdateMany: vi.fn(async () => ({ count: 2 })),
  };
  const tx = {
    user: { update: calls.userUpdate },
    pushToken: { deleteMany: calls.pushTokenDeleteMany },
    channelBinding: { deleteMany: calls.channelBindingDeleteMany },
    conversationMember: { deleteMany: calls.conversationMemberDeleteMany },
    userSession: { updateMany: calls.userSessionUpdateMany },
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async () =>
        opts.exists === false ? null : { id: 'u1', deletedAt: opts.deletedAt ?? null },
      ),
    },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  const service = new AccountsService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, calls };
}

describe('AccountsService.deleteAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-delete + чистка: deletedAt, pushToken/channelBinding/member удалены, сессии отозваны', async () => {
    const { service, calls } = build({ deletedAt: null });
    const res = await service.deleteAccount('u1');
    expect(res).toEqual({ ok: true });
    expect(calls.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    expect(calls.pushTokenDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(calls.channelBindingDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(calls.conversationMemberDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(calls.userSessionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
  });

  it('идемпотентно: повтор на уже удалённом не трогает deletedAt снова, чистка повторяется', async () => {
    const { service, calls } = build({ deletedAt: new Date('2026-06-01') });
    const res = await service.deleteAccount('u1');
    expect(res).toEqual({ ok: true });
    expect(calls.userUpdate).not.toHaveBeenCalled();
    expect(calls.pushTokenDeleteMany).toHaveBeenCalled();
    expect(calls.userSessionUpdateMany).toHaveBeenCalled();
  });

  it('несуществующий юзер → ok:true без транзакции', async () => {
    const { service, prisma, calls } = build({ exists: false });
    const res = await service.deleteAccount('nope');
    expect(res).toEqual({ ok: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(calls.userUpdate).not.toHaveBeenCalled();
  });
});
