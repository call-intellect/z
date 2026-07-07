import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../../common/redis/redis.service';

import { IssueEmbedQueueService } from './issue-embed-queue.service';

describe('IssueEmbedQueueService', () => {
  let service: IssueEmbedQueueService;
  const add = vi.fn();

  beforeEach(() => {
    add.mockReset();
    const redis = { client: {} } as unknown as RedisService;
    service = new IssueEmbedQueueService(redis);
    (service as unknown as { queue: { add: typeof add } }).queue = { add };
  });

  it('enqueue: jobId = issue-embed:<issueId>:<hash>, queue.add вызван с {tenantId, issueId}', async () => {
    await service.enqueue({ tenantId: 't1', issueId: 'i1', embeddingHash: 'abc' });

    expect(add).toHaveBeenCalledWith(
      'issue-embed',
      { tenantId: 't1', issueId: 'i1' },
      { jobId: 'issue-embed:i1:abc' },
    );
  });

  it('enqueue: без embeddingHash → jobId суффикс init', async () => {
    await service.enqueue({ tenantId: 't1', issueId: 'i2', embeddingHash: null });

    expect(add).toHaveBeenCalledWith(
      'issue-embed',
      { tenantId: 't1', issueId: 'i2' },
      { jobId: 'issue-embed:i2:init' },
    );
  });

  it('enqueue: queue не инициализирована → no-op без падения', async () => {
    (service as unknown as { queue: null }).queue = null;

    await expect(
      service.enqueue({ tenantId: 't1', issueId: 'i3', embeddingHash: 'x' }),
    ).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });
});
