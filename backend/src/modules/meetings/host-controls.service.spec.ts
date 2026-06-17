import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InvalidFsmTransitionError,
  MeetingNotFoundError,
  NotAuthorizedError,
} from '../../common/errors/domain-errors';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LivekitService } from '../livekit/livekit.service';

import { HostControlsService } from './host-controls.service';

interface MeetingMock {
  id: string;
  ownerId: string;
  status: string;
  failureReason?: string | null;
}

interface ParticipantMock {
  id: string;
  meetingId: string;
  livekitIdentity: string;
}

function makeService(
  meeting: MeetingMock | null,
  participant: ParticipantMock | null = null,
): {
  svc: HostControlsService;
  prisma: any;
  livekit: any;
} {
  const meetingFindUnique = vi.fn(async () => meeting);
  const participantFindUnique = vi.fn(async () => participant);
  const meetingEventCreate = vi.fn(async () => ({}));

  const prisma = {
    meeting: { findUnique: meetingFindUnique, update: vi.fn(async () => ({})) },
    participant: { findUnique: participantFindUnique },
    meetingEvent: { create: meetingEventCreate },
  } as unknown as PrismaService;

  const livekit = {
    muteParticipant: vi.fn(async () => undefined),
    removeParticipant: vi.fn(async () => undefined),
    deleteRoom: vi.fn(async () => undefined),
    updateParticipantAttributes: vi.fn(async () => undefined),
  } as unknown as LivekitService;

  return { svc: new HostControlsService(prisma, livekit), prisma, livekit };
}

describe('HostControlsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mute своего участника как host — ok', async () => {
    const { svc, livekit, prisma } = makeService(
      { id: 'm-1', ownerId: 'u-host', status: 'active' },
      { id: 'p-1', meetingId: 'm-1', livekitIdentity: 'guest:x' },
    );

    await svc.muteParticipant('m-1', 'p-1', 'u-host');

    expect((livekit as any).muteParticipant).toHaveBeenCalledWith({ id: 'm-1' }, 'guest:x', true);
    expect((prisma as any).meetingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meetingId: 'm-1',
          eventType: 'host_action:mute',
        }),
      }),
    );
  });

  it('mute не-host пользователем — NotAuthorizedError', async () => {
    const { svc, livekit } = makeService(
      { id: 'm-1', ownerId: 'u-host', status: 'active' },
      { id: 'p-1', meetingId: 'm-1', livekitIdentity: 'guest:x' },
    );

    await expect(svc.muteParticipant('m-1', 'p-1', 'u-other')).rejects.toThrow(NotAuthorizedError);
    expect((livekit as any).muteParticipant).not.toHaveBeenCalled();
  });

  it('mute на не-active встрече — InvalidFsmTransitionError', async () => {
    const { svc, livekit } = makeService(
      { id: 'm-1', ownerId: 'u-host', status: 'scheduled' },
      { id: 'p-1', meetingId: 'm-1', livekitIdentity: 'guest:x' },
    );

    await expect(svc.muteParticipant('m-1', 'p-1', 'u-host')).rejects.toThrow(
      InvalidFsmTransitionError,
    );
    expect((livekit as any).muteParticipant).not.toHaveBeenCalled();
  });

  it('mute несуществующей встречи — MeetingNotFoundError', async () => {
    const { svc } = makeService(null);
    await expect(svc.muteParticipant('m-1', 'p-1', 'u-host')).rejects.toThrow(MeetingNotFoundError);
  });

  it('unmute дёргает livekit.muteParticipant с false', async () => {
    const { svc, livekit } = makeService(
      { id: 'm-1', ownerId: 'u-host', status: 'active' },
      { id: 'p-1', meetingId: 'm-1', livekitIdentity: 'guest:x' },
    );

    await svc.unmuteParticipant('m-1', 'p-1', 'u-host');

    expect((livekit as any).muteParticipant).toHaveBeenCalledWith({ id: 'm-1' }, 'guest:x', false);
  });

  it('kick участника — ok', async () => {
    const { svc, livekit } = makeService(
      { id: 'm-1', ownerId: 'u-host', status: 'active' },
      { id: 'p-1', meetingId: 'm-1', livekitIdentity: 'guest:x' },
    );

    await svc.kickParticipant('m-1', 'p-1', 'u-host');

    expect((livekit as any).removeParticipant).toHaveBeenCalledWith({ id: 'm-1' }, 'guest:x');
  });

  it('lowerHand: ставит атрибуты hand_raised=false', async () => {
    const { svc, livekit } = makeService(
      { id: 'm-1', ownerId: 'u-host', status: 'active' },
      { id: 'p-1', meetingId: 'm-1', livekitIdentity: 'guest:x' },
    );

    await svc.lowerHand('m-1', 'p-1', 'u-host');

    expect((livekit as any).updateParticipantAttributes).toHaveBeenCalledWith(
      { id: 'm-1' },
      'guest:x',
      { hand_raised: 'false', hand_raised_at: '' },
    );
  });

  it('finish: удаляет room', async () => {
    const { svc, livekit } = makeService({ id: 'm-1', ownerId: 'u-host', status: 'active' });
    await svc.finish('m-1', 'u-host');
    expect((livekit as any).deleteRoom).toHaveBeenCalledWith({ id: 'm-1' });
  });

  it('finish не-host — NotAuthorizedError', async () => {
    const { svc, livekit } = makeService({ id: 'm-1', ownerId: 'u-host', status: 'active' });
    await expect(svc.finish('m-1', 'u-other')).rejects.toThrow(NotAuthorizedError);
    expect((livekit as any).deleteRoom).not.toHaveBeenCalled();
  });

  it('finish уже завершённой (completed) — no-op 200, без deleteRoom/update', async () => {
    const { svc, livekit, prisma } = makeService({
      id: 'm-1',
      ownerId: 'u-host',
      status: 'completed',
    });
    const r = await svc.finish('m-1', 'u-host');
    expect(r.status).toBe('completed');
    expect((livekit as any).deleteRoom).not.toHaveBeenCalled();
    expect((prisma as any).meeting.update).not.toHaveBeenCalled();
  });

  it('finish из scheduled → failed(ended_before_start), 200, deleteRoom best-effort + update', async () => {
    const { svc, livekit, prisma } = makeService({
      id: 'm-1',
      ownerId: 'u-host',
      status: 'scheduled',
      failureReason: null,
    });
    const r = await svc.finish('m-1', 'u-host');
    expect(r).toEqual({ status: 'failed', failureReason: 'ended_before_start' });
    expect((livekit as any).deleteRoom).toHaveBeenCalledWith({ id: 'm-1' });
    expect((prisma as any).meeting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1' },
        data: { status: 'failed', failureReason: 'ended_before_start' },
      }),
    );
  });

  it('finish из scheduled когда deleteRoom бросает — всё равно failed (best-effort)', async () => {
    const { svc, livekit, prisma } = makeService({
      id: 'm-1',
      ownerId: 'u-host',
      status: 'scheduled',
      failureReason: null,
    });
    (livekit as any).deleteRoom.mockRejectedValueOnce(new Error('room not found'));
    const r = await svc.finish('m-1', 'u-host');
    expect(r.status).toBe('failed');
    expect((prisma as any).meeting.update).toHaveBeenCalled();
  });
});
