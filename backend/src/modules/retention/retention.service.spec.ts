import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';
import type { S3Service } from '../recordings/s3.service';

import type { RetentionPolicyService } from './retention-policy.service';
import { RetentionService } from './retention.service';

interface ExpiredRecording {
  id: string;
  meetingId: string;
  status: string;
  expiresAt: Date;
  mainVideoUrl: string | null;
  audioTracks: Array<{ audioUrl: string }>;
}

function makeService(candidates: ExpiredRecording[]): {
  svc: RetentionService;
  prisma: any;
  s3: any;
  metrics: any;
} {
  const findMany = vi.fn(async () => candidates);
  const recordingUpdate = vi.fn();
  const recordingActionCreate = vi.fn();

  const prisma = {
    recording: { findMany, update: recordingUpdate },
    recordingAction: { create: recordingActionCreate },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn(prisma),
  } as unknown as PrismaService;

  const s3 = {
    delete: vi.fn(async () => undefined),
  } as unknown as S3Service;

  const metrics = {
    incRecordingsDeleted: vi.fn(),
    incCoreRetentionDeleted: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    s3: { bucket: 'z-records' },
    retention: {
      sweepBatchSize: 500,
      rawEventsEnabled: false,
      auditEnabled: false,
      chatEnabled: false,
      blocksEnabled: false,
    },
  } as unknown as TypedConfigService;

  const policySvc = {
    getOrInit: vi.fn(),
    update: vi.fn(),
    markSwept: vi.fn(),
  } as unknown as RetentionPolicyService;

  const audit = {
    log: vi.fn(async () => undefined),
  } as unknown as AuditLogService;

  return {
    svc: new RetentionService(prisma, s3, metrics, cfg, policySvc, audit),
    prisma,
    s3,
    metrics,
  };
}

describe('RetentionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processExpired: пустой список → ничего не делает', async () => {
    const { svc, s3 } = makeService([]);
    const out = await svc.processExpired();
    expect(out).toEqual({ processed: 0, failed: 0 });
    expect((s3 as any).delete).not.toHaveBeenCalled();
  });

  it('processExpired: удаляет S3-ключи и помечает recording deleted', async () => {
    const { svc, s3, prisma, metrics } = makeService([
      {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'ready',
        expiresAt: new Date(Date.now() - 1000),
        mainVideoUrl: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
        audioTracks: [{ audioUrl: 'https://s3.local/z-records/meetings/m-1/audio/host:u-1.ogg' }],
      },
    ]);

    const out = await svc.processExpired();

    expect(out).toEqual({ processed: 1, failed: 0 });
    expect((s3 as any).delete).toHaveBeenCalledWith([
      'meetings/m-1/composite.mp4',
      'meetings/m-1/audio/host:u-1.ogg',
    ]);
    expect((prisma as any).recording.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-1' },
        data: expect.objectContaining({ status: 'deleted' }),
      }),
    );
    expect((prisma as any).recordingAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'deleted',
          actor: 'cron',
          reason: 'tariff_expired',
        }),
      }),
    );
    expect((metrics as any).incRecordingsDeleted).toHaveBeenCalledWith({
      reason: 'tariff_expired',
    });
  });

  it('processExpired: ошибка в одном элементе не валит остальные', async () => {
    const { svc, s3, prisma } = makeService([
      {
        id: 'r-1',
        meetingId: 'm-1',
        status: 'ready',
        expiresAt: new Date(Date.now() - 1000),
        mainVideoUrl: 'https://s3.local/z-records/meetings/m-1/composite.mp4',
        audioTracks: [],
      },
      {
        id: 'r-2',
        meetingId: 'm-2',
        status: 'ready',
        expiresAt: new Date(Date.now() - 1000),
        mainVideoUrl: 'https://s3.local/z-records/meetings/m-2/composite.mp4',
        audioTracks: [],
      },
    ]);

    (s3 as any).delete = vi
      .fn()
      .mockRejectedValueOnce(new Error('s3 down'))
      .mockResolvedValueOnce(undefined);

    const out = await svc.processExpired();
    expect(out.processed).toBe(1);
    expect(out.failed).toBe(1);
    expect((prisma as any).recording.update).toHaveBeenCalledTimes(1);
  });
});
