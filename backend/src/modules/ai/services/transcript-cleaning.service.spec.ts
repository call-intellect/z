import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MeetingVisibilityService } from '../../meetings/meeting-visibility.service';
import type { S3Service } from '../../recordings/s3.service';
import type { AiQueueService } from '../ai-queue.service';

import { TranscriptCleaningService } from './transcript-cleaning.service';

interface BuildOpts {
  meeting?: { ownerId?: string } | null;
  transcript?: {
    turns?: unknown;
    cleaningStatus?: string | null;
    cleanedS3Url?: string | null;
    totalDurationSeconds?: number | null;
  } | null;
  assertThrows?: Error;
}

function build(opts: BuildOpts = {}) {
  const transcript =
    opts.transcript === null
      ? null
      : {
          id: 't-1',
          turns: opts.transcript?.turns ?? [{ speaker: 'A', text: 'hi', startSec: 0, endSec: 1 }],
          cleaningStatus: opts.transcript?.cleaningStatus ?? 'not_started',
          cleanedS3Url: opts.transcript?.cleanedS3Url ?? null,
          totalDurationSeconds: opts.transcript?.totalDurationSeconds ?? 120,
          mergedS3Url: 's3://merged',
        };

  const meeting =
    opts.meeting === null
      ? null
      : {
          id: 'm-1',
          ownerId: opts.meeting?.ownerId ?? 'owner-1',
          transcript,
        };

  const findUnique = vi.fn(async () => meeting);

  const prisma = {
    meeting: { findUnique },
  } as unknown as PrismaService;

  const s3 = {
    getJson: vi.fn(async () => ({ turns: [] })),
  } as unknown as S3Service;

  const queue = {
    enqueueTranscriptClean: vi.fn(async () => undefined),
  } as unknown as AiQueueService;

  const cfg = {} as unknown as TypedConfigService;

  const assertCanView = vi.fn(async () => {
    if (opts.assertThrows) throw opts.assertThrows;
    return meeting;
  });
  const visibility = {
    assertCanView,
  } as unknown as MeetingVisibilityService;

  const svc = new TranscriptCleaningService(prisma, s3, queue, cfg, visibility);
  return { svc, prisma, s3, queue, cfg, visibility, findUnique, assertCanView };
}

describe('TranscriptCleaningService.getTranscript', () => {
  it('вызывает visibility.assertCanView(meetingId, userId), а не сравнивает ownerId', async () => {
    const ctx = build({ meeting: { ownerId: 'owner-1' } });
    await ctx.svc.getTranscript({ meetingId: 'm-1', userId: 'viewer-2', cleaned: false });
    expect(ctx.assertCanView).toHaveBeenCalledWith('m-1', 'viewer-2');
  });

  it('не-владелец с доступом видит транскрипт (turns непустой)', async () => {
    const ctx = build({ meeting: { ownerId: 'owner-1' } });
    const out = await ctx.svc.getTranscript({
      meetingId: 'm-1',
      userId: 'viewer-2',
      cleaned: false,
    });
    expect(out.turns).toHaveLength(1);
    expect(out.cleaned).toBe(false);
    expect(out.durationSeconds).toBe(120);
  });

  it('assertCanView бросает (нет доступа) → getTranscript пробрасывает ошибку', async () => {
    const ctx = build({ assertThrows: new NotAuthorizedError('meeting_not_visible') });
    await expect(
      ctx.svc.getTranscript({ meetingId: 'm-1', userId: 'viewer-2', cleaned: false }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('транскрипт не готов (transcript: null), но доступ есть → NotFoundException transcript_not_ready', async () => {
    const ctx = build({ transcript: null });
    await expect(
      ctx.svc.getTranscript({ meetingId: 'm-1', userId: 'owner-1', cleaned: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      ctx.svc.getTranscript({ meetingId: 'm-1', userId: 'owner-1', cleaned: false }),
    ).rejects.toMatchObject({ response: { reason: 'transcript_not_ready' } });
  });
});
