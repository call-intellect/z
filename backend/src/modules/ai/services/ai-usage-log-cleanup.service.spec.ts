import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AiUsageLogCleanupService } from './ai-usage-log-cleanup.service';

const NOW = Date.parse('2026-06-05T00:00:00.000Z');

interface TxMockOptions {
  lockBusy?: boolean;
  findManySeq?: Array<Array<{ id: string }>>;
}

function makeTx(opts: TxMockOptions = {}): {
  tx: Record<string, unknown>;
  findMany: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const seq = opts.findManySeq ?? [];
  let callIdx = 0;
  const findMany = vi.fn(async () => {
    const out = seq[callIdx] ?? [];
    callIdx += 1;
    return out;
  });
  const updateMany = vi.fn(async (args: { where: { id: { in: string[] } } }) => ({
    count: args.where.id.in.length,
  }));
  const deleteMany = vi.fn(async (args: { where: { id: { in: string[] } } }) => ({
    count: args.where.id.in.length,
  }));
  const queryRaw = vi.fn(async () => [{ locked: !opts.lockBusy }]);

  const tx = {
    aiUsageLog: { findMany, updateMany, deleteMany },
    $queryRaw: queryRaw,
  };
  return { tx, findMany, updateMany, deleteMany, queryRaw };
}

function makeService(
  tx: Record<string, unknown>,
  cfgOverrides?: Partial<{ scrubDays: number; deleteDays: number }>,
): { service: AiUsageLogCleanupService; transaction: ReturnType<typeof vi.fn> } {
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaService;

  const getDynamic = vi.fn(async (key: string, _env?: string, def?: number) => {
    if (key === 'llm.usage_log.scrub_previews_after_days') {
      return cfgOverrides?.scrubDays ?? def;
    }
    if (key === 'llm.usage_log.delete_after_days') {
      return cfgOverrides?.deleteDays ?? def;
    }
    return def;
  });
  const cfg = { getDynamic } as unknown as TypedConfigService;

  return { service: new AiUsageLogCleanupService(prisma, cfg), transaction };
}

describe('AiUsageLogCleanupService.runCleanup', () => {
  it('Tier-1: строка старше scrub (с превью) → updateMany превью→null, НЕ удаляется', async () => {
    const { tx, findMany, updateMany, deleteMany } = makeTx({
      findManySeq: [[{ id: 'a' }]],
    });
    const { service } = makeService(tx);

    const res = await service.runCleanup(NOW);

    expect(res).toEqual(expect.objectContaining({ scrubbed: 1, deleted: 0 }));
    const firstCall = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(firstCall.where['OR']).toBeDefined();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { requestPreview: null, responsePreview: null },
        where: { id: { in: ['a'] } },
      }),
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('Tier-2: строка старше delete → попадает в deleteMany', async () => {
    const { tx, updateMany, deleteMany } = makeTx({
      findManySeq: [[], [{ id: 'old' }]],
    });
    const { service } = makeService(tx);

    const res = await service.runCleanup(NOW);

    expect(res).toEqual(expect.objectContaining({ scrubbed: 0, deleted: 1 }));
    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['old'] } } }),
    );
  });

  it('свежая строка (младше scrub) → не тронута', async () => {
    const { tx, updateMany, deleteMany } = makeTx({ findManySeq: [[], []] });
    const { service } = makeService(tx);

    const res = await service.runCleanup(NOW);

    expect(res).toEqual(expect.objectContaining({ scrubbed: 0, deleted: 0 }));
    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('идемпотентность: второй прогон при пустых findMany → {scrubbed:0, deleted:0}', async () => {
    const { tx } = makeTx({ findManySeq: [[], []] });
    const { service } = makeService(tx);

    await service.runCleanup(NOW);
    const second = await service.runCleanup(NOW);

    expect(second).toEqual(expect.objectContaining({ scrubbed: 0, deleted: 0 }));
    expect(second.skipped).toBeUndefined();
  });

  it('advisory-lock занят → {skipped:true}, без findMany/delete', async () => {
    const { tx, findMany, updateMany, deleteMany } = makeTx({ lockBusy: true });
    const { service } = makeService(tx);

    const res = await service.runCleanup(NOW);

    expect(res).toEqual(expect.objectContaining({ skipped: true }));
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
