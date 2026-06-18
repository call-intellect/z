import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { backfillChatboxSubjectCleanup, buildWhere } from './backfill-chatbox-subject-cleanup';

describe('buildWhere', () => {
  it('фильтрует role=subject + evidence.sourceType=chatbox', () => {
    const where = buildWhere();
    expect(where.role).toBe('subject');
    expect(where.block).toEqual({
      evidence: { some: { sourceType: 'chatbox' } },
    });
  });
});

function buildPrisma(matchCount: number) {
  const count = vi.fn(async () => matchCount);
  const deleteMany = vi.fn(async () => ({ count: matchCount }));
  return {
    ideaBlockEntity: { count, deleteMany },
  };
}

describe('backfillChatboxSubjectCleanup', () => {
  it('dry-run: считает, не удаляет', async () => {
    const prisma = buildPrisma(5);

    const stats = await backfillChatboxSubjectCleanup(prisma as unknown as PrismaClient, {
      apply: false,
    });

    expect(stats.found).toBe(5);
    expect(stats.deleted).toBe(0);
    expect(prisma.ideaBlockEntity.count).toHaveBeenCalledOnce();
    expect(prisma.ideaBlockEntity.deleteMany).not.toHaveBeenCalled();
  });

  it('apply: удаляет по where', async () => {
    const prisma = buildPrisma(3);

    const stats = await backfillChatboxSubjectCleanup(prisma as unknown as PrismaClient, {
      apply: true,
    });

    expect(stats.found).toBe(3);
    expect(stats.deleted).toBe(3);
    expect(prisma.ideaBlockEntity.deleteMany).toHaveBeenCalledWith({
      where: buildWhere(),
    });
    expect(prisma.ideaBlockEntity.count).not.toHaveBeenCalled();
  });

  it('идемпотентность: повторный apply при 0 совпадений → 0 deleted', async () => {
    const prisma = buildPrisma(0);

    const stats = await backfillChatboxSubjectCleanup(prisma as unknown as PrismaClient, {
      apply: true,
    });

    expect(stats.deleted).toBe(0);
  });
});
