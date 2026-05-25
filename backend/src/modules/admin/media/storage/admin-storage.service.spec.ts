/**
 * Admin-redesign Фаза 7 — unit-тесты `AdminStorageService`.
 *
 * Покрываем:
 *   1) listBuckets() — мок ListObjectsV2 → objectsCount + bytesTotal + truncated.
 *   2) getStats() — суммирует поля по всем бакетам.
 *   3) switchProvider() — вызывает AdminSettings.set('storage.provider', ...) с reason.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { AdminSettingsService } from '../../settings/admin-settings.service';

import { AdminStorageService } from './admin-storage.service';

// Глобальный store ответов для мока S3Client (ключ — Bucket).
type ListResponse = {
  Contents?: Array<{ Key?: string; Size?: number }>;
  IsTruncated?: boolean;
};
const listResponses = new Map<string, ListResponse | Error>();

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    constructor(_config: unknown) {}
    async send(command: { input: { Bucket: string } }) {
      const bucket = command.input.Bucket;
      const resp = listResponses.get(bucket);
      if (resp instanceof Error) throw resp;
      return resp ?? { Contents: [], IsTruncated: false };
    }
  }
  class MockListObjectsV2Command {
    public readonly input: { Bucket: string; MaxKeys: number };
    constructor(input: { Bucket: string; MaxKeys: number }) {
      this.input = input;
    }
  }
  return {
    S3Client: MockS3Client,
    ListObjectsV2Command: MockListObjectsV2Command,
  };
});

function buildService(opts: {
  bucketName?: string;
  setMock?: ReturnType<typeof vi.fn>;
} = {}) {
  const cfg = {
    s3: {
      endpointUrl: 'https://s3.test',
      region: 'ru-central1',
      bucket: opts.bucketName ?? 'z-recordings',
      accessKey: 'k',
      secretKey: 's',
    },
  } as unknown as TypedConfigService;

  const setMock =
    opts.setMock ?? vi.fn(async () => undefined);
  const settings = {
    set: setMock,
  } as unknown as AdminSettingsService;

  const svc = new AdminStorageService(cfg, settings);
  return { svc, setMock };
}

describe('AdminStorageService', () => {
  beforeEach(() => {
    listResponses.clear();
  });

  it('listBuckets(): возвращает statBucket с objectsCount + bytesTotal + truncated', async () => {
    listResponses.set('z-recordings', {
      Contents: [
        { Key: 'a.mp4', Size: 1000 },
        { Key: 'b.mp4', Size: 2000 },
        { Key: 'c.mp4', Size: 500 },
      ],
      IsTruncated: false,
    });
    const { svc } = buildService();
    const buckets = await svc.listBuckets();
    expect(buckets.length).toBe(1);
    expect(buckets[0]?.name).toBe('z-recordings');
    expect(buckets[0]?.objectsCount).toBe(3);
    expect(buckets[0]?.bytesTotal).toBe(3500);
    expect(buckets[0]?.truncated).toBe(false);
    expect(buckets[0]?.ok).toBe(true);
    expect(buckets[0]?.endpoint).toBe('https://s3.test');
    expect(buckets[0]?.region).toBe('ru-central1');
  });

  it('getStats(): суммирует objectsCount + bytesTotal по всем бакетам', async () => {
    listResponses.set('z-recordings', {
      Contents: [
        { Key: 'a', Size: 1000 },
        { Key: 'b', Size: 2000 },
      ],
      IsTruncated: true,
    });
    const { svc } = buildService();
    const stats = await svc.getStats();
    expect(stats.totalObjects).toBe(2);
    expect(stats.totalBytes).toBe(3000);
    expect(stats.buckets[0]?.truncated).toBe(true);
    expect(typeof stats.collectedAt).toBe('string');
  });

  it('switchProvider(): вызывает AdminSettings.set с reason+userId, возвращает ISO', async () => {
    const { svc, setMock } = buildService();
    const result = await svc.switchProvider({
      provider: 'selectel',
      reason: 'Переход на отечественный провайдер',
      userId: 'admin-1',
    });
    expect(setMock).toHaveBeenCalledWith(
      'storage.provider',
      'selectel',
      expect.objectContaining({
        userId: 'admin-1',
        reason: 'Переход на отечественный провайдер',
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.provider).toBe('selectel');
    expect(typeof result.appliedAt).toBe('string');
  });
});
