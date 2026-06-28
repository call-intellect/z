import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ReadCursorService } from './read-cursor.service';

function makeMarkReadPrisma(currentLastRead: bigint | null) {
  const update = vi.fn().mockResolvedValue({});
  const tx = {
    conversationMember: {
      findUnique:
        currentLastRead == null
          ? vi.fn().mockResolvedValue(null)
          : vi.fn().mockResolvedValue({ id: 'cm-1', lastReadSeq: currentLastRead }),
      update,
    },
  };
  const prisma = {
    $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  return { prisma, update };
}

describe('ReadCursorService.markRead', () => {
  it('двигает lastReadSeq вперёд до нового курсора', async () => {
    const { prisma, update } = makeMarkReadPrisma(5n);
    const service = new ReadCursorService(prisma);

    await service.markRead({ conversationId: 'conv-1', userId: 'u1', cursorSeq: '9' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'cm-1' },
      data: { lastReadSeq: 9n },
    });
  });

  it('не откатывает назад (новый < текущего)', async () => {
    const { prisma, update } = makeMarkReadPrisma(10n);
    const service = new ReadCursorService(prisma);

    await service.markRead({ conversationId: 'conv-1', userId: 'u1', cursorSeq: 4n });

    expect(update).not.toHaveBeenCalled();
  });

  it('нет членства → no-op', async () => {
    const { prisma, update } = makeMarkReadPrisma(null);
    const service = new ReadCursorService(prisma);

    await service.markRead({ conversationId: 'conv-1', userId: 'u1', cursorSeq: 3n });

    expect(update).not.toHaveBeenCalled();
  });
});

describe('ReadCursorService.getUnreadCount', () => {
  function makePrisma(maxSeq: bigint | null, lastReadSeq: bigint | null) {
    return {
      message: { aggregate: vi.fn().mockResolvedValue({ _max: { seq: maxSeq } }) },
      conversationMember: {
        findUnique: vi
          .fn()
          .mockResolvedValue(lastReadSeq == null ? null : { lastReadSeq }),
      },
    } as unknown as PrismaService;
  }

  it('maxSeq − lastReadSeq', async () => {
    const service = new ReadCursorService(makePrisma(10n, 3n));
    expect(await service.getUnreadCount({ conversationId: 'c', userId: 'u' })).toBe(7);
  });

  it('lastReadSeq >= maxSeq → 0', async () => {
    const service = new ReadCursorService(makePrisma(5n, 8n));
    expect(await service.getUnreadCount({ conversationId: 'c', userId: 'u' })).toBe(0);
  });

  it('нет членства → maxSeq − 0', async () => {
    const service = new ReadCursorService(makePrisma(4n, null));
    expect(await service.getUnreadCount({ conversationId: 'c', userId: 'u' })).toBe(4);
  });
});
