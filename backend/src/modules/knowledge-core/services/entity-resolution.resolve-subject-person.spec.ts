import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { EntityResolutionService } from './entity-resolution.service';

/**
 * ТЗ-D Ф2a (2026-06-05) — чистый unit-тест `resolveSubjectPersonId`.
 *
 * БД-независимый: мокаем только нужные prisma-делегаты (`person.findFirst`,
 * `person.findUnique`, `participant.findUnique`). Остальные зависимости
 * конструктора @Optional — передаём `undefined`. Метод детерминированный,
 * сети/Postgres не требует. Integration-сценарии (реальный resolve по графу) —
 * в `entity-resolution.service.spec.ts` (там есть beforeAll → Postgres).
 *
 * Ветка speakerName здесь НЕ тестируется: она делегирует во внутренний
 * `resolvePersonByHint` (findMany по Person), что выходит за рамки этих
 * детерминированных unit-кейсов.
 */

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

/**
 * Конструирует сервис только с prisma-моком. Остальные конструкторные
 * зависимости (embeddings + 5 @Optional) для `resolveSubjectPersonId` не
 * используются, поэтому передаём `undefined`/пустые заглушки.
 */
function makeService(prisma: PrismaMock): EntityResolutionService {
  return new EntityResolutionService(
    prisma as unknown as PrismaService,
    // embeddings — не вызывается этим методом
    {} as never,
    // redis, coreQueue, metrics, cfg, events — все @Optional
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
    // authorUserId не задан → findFirst не должен дёргаться
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
