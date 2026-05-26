/**
 * KC-Temporal W3.1 (2026-05-25) — unit-тесты EntityLinkService.upsertRichEdge.
 *
 * Покрытие:
 *   1. create rich edge — нет существующего, создаём с attributes /
 *      sourceBlockIds.
 *   2. update merges sources — повторный upsert union'ит sourceBlockIds.
 *   3. attributes accumulate — повторный upsert мерджит attributes
 *      (новые ключи + перезапись существующих); confidence берётся как max.
 *
 * Зависимость PrismaService мокается. Транзакция эмулируется callback'ом,
 * который получает «tx» с тем же контрактом, что и `prisma` — поэтому
 * мокаем prisma.entityLink.* и через transaction(tx) шарим вызовы.
 */
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { EntityLinkService } from './entity-link.service';


function makeMocks() {
  const findUnique = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  // Эмулируем prisma.$transaction(cb) → cb(tx). tx — тот же контракт,
  // что и prisma.entityLink. Поэтому шарим методы напрямую.
  const transaction = vi.fn(
    async (cb: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      cb({
        entityLink: { findUnique, create, update },
      }),
  );
  const prisma = {
    $transaction: transaction,
    entityLink: { findUnique, create, update },
  } as unknown as PrismaService;
  return { prisma, findUnique, create, update, transaction };
}

const baseArgs = {
  tenantId: 'org-1',
  fromEntityId: 'ent-A',
  toEntityId: 'ent-B',
  relationType: 'works_at' as const,
  confidence: 0.8,
  explanation: 'A работает в B',
  createdBy: 'linker' as const,
};

describe('EntityLinkService.upsertRichEdge', () => {
  let svc: EntityLinkService;
  let m: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    m = makeMocks();
    svc = new EntityLinkService(m.prisma);
  });

  it('создаёт новое rich-edge ребро с attributes и sourceBlockIds', async () => {
    m.findUnique.mockResolvedValueOnce(null);
    m.create.mockResolvedValueOnce({
      id: 'link-1',
      ...baseArgs,
      attributes: { role: 'CEO', since: '2022-01' },
      sourceBlockIds: ['blk-1', 'blk-2'],
    });

    const result = await svc.upsertRichEdge({
      ...baseArgs,
      attributes: { role: 'CEO', since: '2022-01' },
      sourceBlockIds: ['blk-1', 'blk-2'],
    });

    expect(m.findUnique).toHaveBeenCalledTimes(1);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.update).not.toHaveBeenCalled();
    const createArg = m.create.mock.calls[0]?.[0];
    expect(createArg).toBeDefined();
    expect(createArg.data.fromType).toBe('entity');
    expect(createArg.data.toType).toBe('entity');
    expect(createArg.data.attributes).toEqual({
      role: 'CEO',
      since: '2022-01',
    });
    expect(createArg.data.sourceBlockIds).toEqual(['blk-1', 'blk-2']);
    // confidence — Prisma.Decimal с 3 знаками.
    expect(String(createArg.data.confidence)).toBe('0.8');
    expect(result.id).toBe('link-1');
  });

  it('объединяет sourceBlockIds при повторном upsert (без дубликатов)', async () => {
    m.findUnique.mockResolvedValueOnce({
      id: 'link-1',
      tenantId: 'org-1',
      fromEntityId: 'ent-A',
      fromType: 'entity',
      toEntityId: 'ent-B',
      toType: 'entity',
      relationType: 'works_at',
      confidence: new Prisma.Decimal('0.7'),
      explanation: 'предыдущее',
      attributes: null,
      sourceBlockIds: ['blk-1', 'blk-2'],
      status: 'active',
    });
    m.update.mockResolvedValueOnce({ id: 'link-1', sourceBlockIds: ['blk-1', 'blk-2', 'blk-3'] });

    await svc.upsertRichEdge({
      ...baseArgs,
      confidence: 0.75,
      sourceBlockIds: ['blk-2', 'blk-3'], // blk-2 уже в существующих
    });

    expect(m.update).toHaveBeenCalledTimes(1);
    const updateArg = m.update.mock.calls[0]?.[0];
    expect(updateArg).toBeDefined();
    // union без дубликатов:
    expect(updateArg.data.sourceBlockIds).toEqual(['blk-1', 'blk-2', 'blk-3']);
    // confidence — max(0.7, 0.75) = 0.75
    expect(String(updateArg.data.confidence)).toBe('0.75');
  });

  it('мерджит attributes плоско: новые ключи добавляются, перезапись существующих, max(confidence)', async () => {
    m.findUnique.mockResolvedValueOnce({
      id: 'link-1',
      tenantId: 'org-1',
      fromEntityId: 'ent-A',
      fromType: 'entity',
      toEntityId: 'ent-B',
      toType: 'entity',
      relationType: 'works_at',
      confidence: new Prisma.Decimal('0.9'),
      explanation: 'старое',
      attributes: { role: 'CTO', since: '2021-06' },
      sourceBlockIds: ['blk-1'],
      status: 'active',
    });
    m.update.mockResolvedValueOnce({ id: 'link-1' });

    await svc.upsertRichEdge({
      ...baseArgs,
      confidence: 0.6, // ниже существующего — должно остаться 0.9
      attributes: { role: 'CEO', share: 0.5 }, // role перезаписан, share добавлен
      sourceBlockIds: [],
    });

    const updateArg = m.update.mock.calls[0]?.[0];
    expect(updateArg).toBeDefined();
    expect(updateArg.data.attributes).toEqual({
      role: 'CEO', // новый, перезаписал
      since: '2021-06', // старый сохранён
      share: 0.5, // новый ключ
    });
    // confidence — max(0.9, 0.6) = 0.9
    expect(String(updateArg.data.confidence)).toBe('0.9');
  });
});
