import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { linkDerivedExperimentsForIssue } from './experiment-task-link.util';

type PrismaMock = {
  experiment: {
    findMany: ReturnType<typeof vi.fn>;
  };
  experimentTaskLink: {
    createMany: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(): PrismaMock {
  return {
    experiment: {
      findMany: vi.fn(),
    },
    experimentTaskLink: {
      createMany: vi.fn(),
    },
  };
}

describe('linkDerivedExperimentsForIssue', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('два эксперимента с общим sourceBlockId → createMany с двумя derived-линками, count=2', async () => {
    prisma.experiment.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    prisma.experimentTaskLink.createMany.mockResolvedValue({ count: 2 });

    const n = await linkDerivedExperimentsForIssue(
      prisma as unknown as PrismaService,
      { tenantId: 't1', issueId: 'i1', sourceBlockIds: ['b1'] },
    );

    expect(n).toBe(2);
    expect(prisma.experiment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          sourceBlockIds: { hasSome: ['b1'] },
        }),
      }),
    );
    expect(prisma.experimentTaskLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { experimentId: 'e1', issueId: 'i1', linkType: 'derived' },
          { experimentId: 'e2', issueId: 'i1', linkType: 'derived' },
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('идемпотентность: повтор → createMany skipDuplicates даёт count=0', async () => {
    prisma.experiment.findMany.mockResolvedValue([{ id: 'e1' }]);
    prisma.experimentTaskLink.createMany.mockResolvedValue({ count: 0 });

    const n = await linkDerivedExperimentsForIssue(
      prisma as unknown as PrismaService,
      { tenantId: 't1', issueId: 'i1', sourceBlockIds: ['b1'] },
    );

    expect(n).toBe(0);
    expect(prisma.experimentTaskLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('пустой sourceBlockIds → ранний возврат 0, findMany не вызван', async () => {
    const n = await linkDerivedExperimentsForIssue(
      prisma as unknown as PrismaService,
      { tenantId: 't1', issueId: 'i1', sourceBlockIds: [] },
    );

    expect(n).toBe(0);
    expect(prisma.experiment.findMany).not.toHaveBeenCalled();
    expect(prisma.experimentTaskLink.createMany).not.toHaveBeenCalled();
  });

  it('нет совпавших экспериментов → 0, createMany не вызван', async () => {
    prisma.experiment.findMany.mockResolvedValue([]);

    const n = await linkDerivedExperimentsForIssue(
      prisma as unknown as PrismaService,
      { tenantId: 't1', issueId: 'i1', sourceBlockIds: ['b1'] },
    );

    expect(n).toBe(0);
    expect(prisma.experimentTaskLink.createMany).not.toHaveBeenCalled();
  });
});
