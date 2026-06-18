import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LivekitService } from '../../livekit/livekit.service';
import type { RecordingsService } from '../../recordings/recordings.service';
import type { MeetingsService } from '../meetings.service';

import { IdleMeetingCron } from './idle-meeting.cron';

interface Mocks {
  prisma: any;
  livekit: any;
  cfg: any;
  meetings: any;
  recordings: any;
}

function makeMocks(): Mocks {
  const prisma = {
    meeting: { findMany: vi.fn(async () => []) },
  };
  const livekit = {
    listParticipants: vi.fn(async () => []),
    deleteRoom: vi.fn(async () => undefined),
  };
  const cfg = { idle: { timeoutMinutes: 15 } };
  const meetings = { transitionStatus: vi.fn(async () => ({})) };
  const recordings = { start: vi.fn(async () => undefined) };
  return { prisma, livekit, cfg, meetings, recordings };
}

function makeCron(m: Mocks): IdleMeetingCron {
  return new IdleMeetingCron(
    m.prisma as unknown as PrismaService,
    m.livekit as unknown as LivekitService,
    m.cfg as unknown as TypedConfigService,
    m.meetings as unknown as MeetingsService,
    m.recordings as unknown as RecordingsService,
  );
}

describe('IdleMeetingCron — reconcileAbandonedScheduled (ТЗ Ф6/Р2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scheduled без участников → failed(never_activated) + deleteRoom', async () => {
    const m = makeMocks();
    m.prisma.meeting.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'scheduled' ? [{ id: 'm-s', ownerId: 'u-o', recordByDefault: true }] : [],
    );
    m.livekit.listParticipants.mockImplementation(async () => []);

    await makeCron(m).sweep();

    expect(m.meetings.transitionStatus).toHaveBeenCalledWith(
      'm-s',
      'failed',
      expect.objectContaining({ failureReason: 'never_activated' }),
    );
    expect(m.livekit.deleteRoom).toHaveBeenCalledWith({ id: 'm-s' });
    expect(m.recordings.start).not.toHaveBeenCalled();
  });

  it('scheduled с участниками → recover active + start recording', async () => {
    const m = makeMocks();
    m.prisma.meeting.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'scheduled' ? [{ id: 'm-s', ownerId: 'u-o', recordByDefault: true }] : [],
    );
    m.livekit.listParticipants.mockImplementation(async () => [{ identity: 'u-1' }]);

    await makeCron(m).sweep();

    expect(m.meetings.transitionStatus).toHaveBeenCalledWith(
      'm-s',
      'active',
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(m.recordings.start).toHaveBeenCalledWith('m-s', 'u-o');
    expect(m.livekit.deleteRoom).not.toHaveBeenCalled();
  });

  it('scheduled с участниками, recordByDefault=false → recover active, без записи', async () => {
    const m = makeMocks();
    m.prisma.meeting.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'scheduled' ? [{ id: 'm-s', ownerId: 'u-o', recordByDefault: false }] : [],
    );
    m.livekit.listParticipants.mockImplementation(async () => [{ identity: 'u-1' }]);

    await makeCron(m).sweep();

    expect(m.meetings.transitionStatus).toHaveBeenCalledWith(
      'm-s',
      'active',
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(m.recordings.start).not.toHaveBeenCalled();
  });

  it('listParticipants бросает → трактуем как пусто → failed(never_activated)', async () => {
    const m = makeMocks();
    m.prisma.meeting.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'scheduled' ? [{ id: 'm-s', ownerId: 'u-o', recordByDefault: true }] : [],
    );
    m.livekit.listParticipants.mockRejectedValueOnce(new Error('room not found'));

    await expect(makeCron(m).sweep()).resolves.toBeUndefined();

    expect(m.meetings.transitionStatus).toHaveBeenCalledWith(
      'm-s',
      'failed',
      expect.objectContaining({ failureReason: 'never_activated' }),
    );
  });

  it('active-ветка не сломана: пустая active-room → deleteRoom', async () => {
    const m = makeMocks();
    m.prisma.meeting.findMany.mockImplementation(async ({ where }: any) =>
      where.status === 'active' ? [{ id: 'm-a' }] : [],
    );
    m.livekit.listParticipants.mockImplementation(async () => []);

    await makeCron(m).sweep();

    expect(m.livekit.deleteRoom).toHaveBeenCalledWith({ id: 'm-a' });
    expect(m.meetings.transitionStatus).not.toHaveBeenCalled();
  });
});
