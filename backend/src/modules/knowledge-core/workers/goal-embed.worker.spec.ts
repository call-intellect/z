import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { GoalEmbedJobData } from '../../core-queue/queues';
import type { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

import { GoalEmbedWorker } from './goal-embed.worker';

/**
 * Ф5 (TZ 2026-06-16) — юнит-тест GoalEmbedWorker. Вызываем `process()` напрямую
 * (минуя BullMQ). Зеркало issue-embed.worker.spec.
 */
describe('GoalEmbedWorker.process', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let embeddings: EmbeddingFallbackService;
  let worker: GoalEmbedWorker;

  let findFirstMock: ReturnType<typeof vi.fn>;
  let executeRawMock: ReturnType<typeof vi.fn>;
  let embedMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findFirstMock = vi.fn();
    executeRawMock = vi.fn(async () => 1);
    prisma = {
      goal: { findFirst: findFirstMock },
      $executeRawUnsafe: executeRawMock,
    } as unknown as PrismaService;
    redis = { client: {} } as unknown as RedisService;
    embedMock = vi.fn();
    embeddings = { embed: embedMock } as unknown as EmbeddingFallbackService;

    worker = new GoalEmbedWorker(redis, prisma, embeddings);
  });

  function makeJob(data: GoalEmbedJobData): { data: GoalEmbedJobData } {
    return { data };
  }

  it('успешный пересчёт: name+description → embedding обновлён', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'g1',
      tenantId: 't1',
      name: 'Провести 100 встреч',
      description: 'рост воронки',
      embeddingHash: null,
    });
    const vec = new Array(1536).fill(0).map((_, i) => i / 1536);
    embedMock.mockResolvedValueOnce([vec]);

    await worker.process(
      makeJob({ tenantId: 't1', goalId: 'g1' }) as Parameters<
        typeof worker.process
      >[0],
    );

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock.mock.calls[0]?.[0]).toEqual([
      'Провести 100 встреч\n\nрост воронки',
    ]);
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const call = executeRawMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('unreachable');
    expect(String(call[0])).toContain('UPDATE "Goal"');
    expect(String(call[0])).toContain('vector(1536)');
    expect(String(call[1])).toMatch(/^\[/);
    expect(call[3]).toBe('g1');
    expect(call[4]).toBe('t1');
  });

  it('skip по hash: embeddingHash совпал → no embed, no UPDATE (идемпотентность)', async () => {
    const text = 'Цель\n\nописание';
    const hash = createHash('sha256').update(text, 'utf8').digest('hex');
    findFirstMock.mockResolvedValueOnce({
      id: 'g2',
      tenantId: 't1',
      name: 'Цель',
      description: 'описание',
      embeddingHash: hash,
    });

    await worker.process(
      makeJob({ tenantId: 't1', goalId: 'g2' }) as Parameters<
        typeof worker.process
      >[0],
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('goal не найден → no-op (без throw)', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    await worker.process(
      makeJob({ tenantId: 't1', goalId: 'lost' }) as Parameters<
        typeof worker.process
      >[0],
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('пустой embedding от провайдера → throw (BullMQ retry)', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'g4',
      tenantId: 't1',
      name: 'X',
      description: 'Y',
      embeddingHash: null,
    });
    embedMock.mockResolvedValueOnce([[]]);

    await expect(
      worker.process(
        makeJob({ tenantId: 't1', goalId: 'g4' }) as Parameters<
          typeof worker.process
        >[0],
      ),
    ).rejects.toThrow(/пустой embedding/);
    expect(executeRawMock).not.toHaveBeenCalled();
  });

  it('EmbeddingFallbackService отсутствует (Optional) → no-op, не throw', async () => {
    const noEmbWorker = new GoalEmbedWorker(redis, prisma, undefined);
    findFirstMock.mockResolvedValueOnce({
      id: 'g5',
      tenantId: 't1',
      name: 'X',
      description: 'Y',
      embeddingHash: null,
    });

    await noEmbWorker.process(
      makeJob({ tenantId: 't1', goalId: 'g5' }) as Parameters<
        typeof noEmbWorker.process
      >[0],
    );

    expect(executeRawMock).not.toHaveBeenCalled();
  });
});
