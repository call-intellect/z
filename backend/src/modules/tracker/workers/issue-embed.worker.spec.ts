import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import type { IssueEmbedJobData } from '../queues';

import { IssueEmbedWorker } from './issue-embed.worker';

describe('IssueEmbedWorker.process', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let metrics: BusinessMetricsService;
  let embeddings: EmbeddingFallbackService;
  let worker: IssueEmbedWorker;

  let findFirstMock: ReturnType<typeof vi.fn>;
  let executeRawMock: ReturnType<typeof vi.fn>;
  let embedMock: ReturnType<typeof vi.fn>;
  let incEmbedMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findFirstMock = vi.fn();
    executeRawMock = vi.fn(async () => 1);
    prisma = {
      issue: { findFirst: findFirstMock },
      $executeRawUnsafe: executeRawMock,
    } as unknown as PrismaService;
    redis = { client: {} } as unknown as RedisService;
    incEmbedMock = vi.fn();
    metrics = {
      incTrackerIssueEmbed: incEmbedMock,
    } as unknown as BusinessMetricsService;
    embedMock = vi.fn();
    embeddings = { embed: embedMock } as unknown as EmbeddingFallbackService;

    worker = new IssueEmbedWorker(redis, prisma, metrics, embeddings);
  });

  function makeJob(data: IssueEmbedJobData): { data: IssueEmbedJobData } {
    return { data };
  }

  it('успешный пересчёт: title+description → embedding обновлён, метрика ok', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'iss1',
      tenantId: 't1',
      title: 'Crash on login',
      description: null,
      descriptionStripped: 'Auth flow breaks for new users',
      embeddingHash: null,
    });
    const vec = new Array(1536).fill(0).map((_, i) => i / 1536);
    embedMock.mockResolvedValueOnce([vec]);

    await worker.process(
      makeJob({ tenantId: 't1', issueId: 'iss1' }) as Parameters<typeof worker.process>[0],
    );

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock.mock.calls[0]?.[0]).toEqual([
      'Crash on login\n\nAuth flow breaks for new users',
    ]);
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const call = executeRawMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('unreachable');
    expect(String(call[0])).toContain('UPDATE "Issue"');
    expect(String(call[0])).toContain('vector(1536)');
    expect(String(call[1])).toMatch(/^\[/);
    expect(call[3]).toBe('iss1');
    expect(call[4]).toBe('t1');
    expect(incEmbedMock).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'ok',
    });
  });

  it('skip по hash: если embeddingHash совпал с newHash → no embed, no UPDATE', async () => {
    const text = 'Same title\n\nSame body';
    const hash = createHash('sha256').update(text, 'utf8').digest('hex');
    findFirstMock.mockResolvedValueOnce({
      id: 'iss2',
      tenantId: 't1',
      title: 'Same title',
      description: null,
      descriptionStripped: 'Same body',
      embeddingHash: hash,
    });

    await worker.process(
      makeJob({ tenantId: 't1', issueId: 'iss2' }) as Parameters<typeof worker.process>[0],
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(incEmbedMock).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'skipped',
    });
  });

  it('issue не найден → skipped (без throw)', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    await worker.process(
      makeJob({ tenantId: 't1', issueId: 'lost' }) as Parameters<typeof worker.process>[0],
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(incEmbedMock).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'skipped',
    });
  });

  it('пустой text (title="", описания нет) → skipped', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'iss3',
      tenantId: 't1',
      title: '   ',
      description: null,
      descriptionStripped: null,
      embeddingHash: null,
    });

    await worker.process(
      makeJob({ tenantId: 't1', issueId: 'iss3' }) as Parameters<typeof worker.process>[0],
    );

    expect(embedMock).not.toHaveBeenCalled();
    expect(incEmbedMock).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'skipped',
    });
  });

  it('embedding service вернул пустой массив → throw (BullMQ retry)', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'iss4',
      tenantId: 't1',
      title: 'X',
      description: null,
      descriptionStripped: 'Y',
      embeddingHash: null,
    });
    embedMock.mockResolvedValueOnce([[]]);

    await expect(
      worker.process(
        makeJob({ tenantId: 't1', issueId: 'iss4' }) as Parameters<typeof worker.process>[0],
      ),
    ).rejects.toThrow(/пустой embedding/);
    expect(executeRawMock).not.toHaveBeenCalled();
    expect(incEmbedMock).not.toHaveBeenCalled();
  });

  it('embeddings service отсутствует (Optional) → skipped, не throw', async () => {
    const noEmbWorker = new IssueEmbedWorker(redis, prisma, metrics, undefined);
    findFirstMock.mockResolvedValueOnce({
      id: 'iss5',
      tenantId: 't1',
      title: 'X',
      description: null,
      descriptionStripped: 'Y',
      embeddingHash: null,
    });

    await noEmbWorker.process(
      makeJob({ tenantId: 't1', issueId: 'iss5' }) as Parameters<typeof noEmbWorker.process>[0],
    );

    expect(executeRawMock).not.toHaveBeenCalled();
    expect(incEmbedMock).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      status: 'skipped',
    });
  });
});
