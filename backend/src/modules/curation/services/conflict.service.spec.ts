import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ConflictService } from './conflict.service';

/**
 * K1 (Волна 3, Б7) — идемпотентность ConflictService.report под гонкой дублей.
 *
 * Prisma полностью замокан. Проверяем, что при P2002 на create (гонка двух
 * конкурентов на одну открытую пару) report НЕ падает и НЕ плодит дубль, а
 * делает re-find существующего открытого ConflictItem и возвращает его.
 */

function buildPrisma() {
  return {
    conflictItem: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (q: { data: Record<string, unknown> }) => ({
        id: 'cf-new',
        ...q.data,
      })),
    },
  };
}

function buildService(prisma: ReturnType<typeof buildPrisma>): ConflictService {
  const metrics = { incCurationConflict: vi.fn() };
  const conversational = { sendNotification: vi.fn() };
  const curation = {};
  const cfg = { pendingActions: { conflictTtlDays: 14 } };
  return new ConflictService(
    prisma as never,
    metrics as never,
    conversational as never,
    curation as never,
    cfg as never,
  );
}

const baseInput = {
  tenantId: 'tenant-1',
  resourceType: 'idea_block',
  existingId: 'a',
  newId: 'b',
  evidence: {},
  relationType: 'contradicts',
  detectedBy: 'block-linker' as const,
};

describe('ConflictService.report — идемпотентность (K1 Б7)', () => {
  it('P2002 на create (гонка) → re-find открытого и возврат его (без дубля, без падения)', async () => {
    const prisma = buildPrisma();
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    // 1-й findFirst (pre-create idempotency) — пусто; create кидает P2002;
    // 2-й findFirst (re-find после гонки) — возвращает победителя гонки.
    const winner = { id: 'cf-winner', tenantId: 'tenant-1', status: 'open' };
    prisma.conflictItem.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner as never);
    prisma.conflictItem.create.mockRejectedValueOnce(p2002);

    const service = buildService(prisma);
    const result = await service.report(baseInput);

    expect(result).toBe(winner);
    expect(prisma.conflictItem.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.conflictItem.create).toHaveBeenCalledTimes(1);
  });

  it('открытый конфликт уже есть → возврат без create', async () => {
    const prisma = buildPrisma();
    const existing = { id: 'cf-exist', tenantId: 'tenant-1', status: 'open' };
    prisma.conflictItem.findFirst.mockResolvedValueOnce(existing as never);

    const service = buildService(prisma);
    const result = await service.report(baseInput);

    expect(result).toBe(existing);
    expect(prisma.conflictItem.create).not.toHaveBeenCalled();
  });

  it('P2002 без найденного открытого (re-find пусто) → пробрасывает ошибку', async () => {
    const prisma = buildPrisma();
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    prisma.conflictItem.findFirst
      .mockResolvedValueOnce(null) // pre-create
      .mockResolvedValueOnce(null); // re-find не нашёл
    prisma.conflictItem.create.mockRejectedValueOnce(p2002);

    const service = buildService(prisma);
    await expect(service.report(baseInput)).rejects.toBe(p2002);
  });

  it('обычный путь: create успешен → новый ConflictItem', async () => {
    const prisma = buildPrisma();
    const service = buildService(prisma);
    const result = await service.report(baseInput);

    expect(prisma.conflictItem.create).toHaveBeenCalledTimes(1);
    expect((result as { id: string }).id).toBe('cf-new');
  });
});
