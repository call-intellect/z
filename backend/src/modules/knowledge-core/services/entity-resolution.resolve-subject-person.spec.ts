import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { EntityResolutionService } from './entity-resolution.service';

interface PrismaMock {
  person: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  participant: {
    findUnique: ReturnType<typeof vi.fn>;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    person: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    participant: {
      findUnique: vi.fn(),
    },
  };
}

function makeService(prisma: PrismaMock): EntityResolutionService {
  return new EntityResolutionService(
    prisma as unknown as PrismaService,
    {} as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

describe('EntityResolutionService.resolveSubjectPersonId', () => {
  it('a) authorUserId → Person.id (tenant-scoped findFirst)', async () => {
    const prisma = makePrismaMock();
    prisma.person.findFirst.mockResolvedValue({ id: 'pers-1' });

    const svc = makeService(prisma);
    const result = await svc.resolveSubjectPersonId('t1', {
      authorUserId: 'u1',
    });

    expect(result).toBe('pers-1');
    expect(prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          userId: 'u1',
          deletedAt: null,
        }),
      }),
    );
  });

  it('b) speakerParticipantId (personId-ветка) → Person.id', async () => {
    const prisma = makePrismaMock();
    prisma.participant.findUnique.mockResolvedValue({
      personId: 'pp',
      userId: null,
    });
    prisma.person.findUnique.mockResolvedValue({
      id: 'pers-2',
      deletedAt: null,
    });

    const svc = makeService(prisma);
    const result = await svc.resolveSubjectPersonId('t1', {
      speakerParticipantId: 'sp1',
    });

    expect(result).toBe('pers-2');
    expect(prisma.person.findFirst).not.toHaveBeenCalled();
    expect(prisma.participant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sp1' } }),
    );
  });

  it('c) ничего не задано → null', async () => {
    const prisma = makePrismaMock();

    const svc = makeService(prisma);
    const result = await svc.resolveSubjectPersonId('t1', {});

    expect(result).toBeNull();
    expect(prisma.person.findFirst).not.toHaveBeenCalled();
    expect(prisma.person.findUnique).not.toHaveBeenCalled();
    expect(prisma.participant.findUnique).not.toHaveBeenCalled();
  });
});
