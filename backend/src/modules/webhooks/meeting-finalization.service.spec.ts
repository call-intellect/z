import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AiQueueService } from '../ai/ai-queue.service';
import type { MeetingsService } from '../meetings/meetings.service';

import { MeetingFinalizationService } from './meeting-finalization.service';

function makeService(
  opts: {
    meetingStatus?: string | null;
    faststartEnabled?: boolean;
    withAiQueue?: boolean;
    withCfg?: boolean;
  } = {},
): {
  service: MeetingFinalizationService;
  prisma: any;
  meetings: any;
  aiQueue: any;
} {
  const {
    meetingStatus = 'completed',
    faststartEnabled = true,
    withAiQueue = true,
    withCfg = true,
  } = opts;

  let calls = 0;
  const meetingFindUnique = vi.fn(async () => {
    if (meetingStatus === null) return null;
    calls += 1;
    if (calls === 1) return { status: meetingStatus };
    return { status: 'recording_processing' };
  });

  const prisma = {
    meeting: { findUnique: meetingFindUnique },
  } as unknown as PrismaService;

  const meetings = {
    transitionStatus: vi.fn(async () => undefined),
  } as unknown as MeetingsService;

  const aiQueue = withAiQueue
    ? ({
        enqueueTranscribe: vi.fn(async () => undefined),
        enqueueRecordingFaststart: vi.fn(async () => undefined),
      } as unknown as AiQueueService)
    : null;

  const cfg = withCfg
    ? ({
        recording: { faststartEnabled, faststartMinBytes: 52_428_800 },
      } as unknown as TypedConfigService)
    : null;

  const service = new MeetingFinalizationService(prisma, meetings, aiQueue, cfg);
  return { service, prisma, meetings, aiQueue };
}

describe('MeetingFinalizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('promoteMeetingToReady(id, false) → no-op (нет findUnique, нет transitionStatus)', async () => {
    const { service, prisma, meetings, aiQueue } = makeService();
    await service.promoteMeetingToReady('m-1', false);

    expect((prisma as any).meeting.findUnique).not.toHaveBeenCalled();
    expect((meetings as any).transitionStatus).not.toHaveBeenCalled();
    expect((aiQueue as any).enqueueTranscribe).not.toHaveBeenCalled();
  });

  it('promoteMeetingToReady(id, true) при status=completed → 2 перехода FSM + enqueueTranscribe', async () => {
    const { service, meetings, aiQueue } = makeService({ meetingStatus: 'completed' });
    await service.promoteMeetingToReady('m-1', true);

    expect((meetings as any).transitionStatus).toHaveBeenCalledWith(
      'm-1',
      'recording_processing',
      expect.objectContaining({ reason: 'livekit:egress_ended' }),
    );
    expect((meetings as any).transitionStatus).toHaveBeenCalledWith(
      'm-1',
      'recording_ready',
      expect.objectContaining({ reason: 'livekit:egress_ended' }),
    );
    expect((meetings as any).transitionStatus).toHaveBeenCalledTimes(2);
    expect((aiQueue as any).enqueueTranscribe).toHaveBeenCalledWith('m-1');
  });

  it('enqueueFaststartIfNeeded(id, 400МБ) при faststartEnabled=true → enqueueRecordingFaststart вызван', async () => {
    const { service, aiQueue } = makeService({ faststartEnabled: true });
    await service.enqueueFaststartIfNeeded('m-1', 400 * 1024 * 1024);

    expect((aiQueue as any).enqueueRecordingFaststart).toHaveBeenCalledWith('m-1');
  });

  it('enqueueFaststartIfNeeded(id, малый размер < порог) → НЕ вызван', async () => {
    const { service, aiQueue } = makeService({ faststartEnabled: true });
    await service.enqueueFaststartIfNeeded('m-1', 1_000_000);

    expect((aiQueue as any).enqueueRecordingFaststart).not.toHaveBeenCalled();
  });
});
