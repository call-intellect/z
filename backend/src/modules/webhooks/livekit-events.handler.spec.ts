import { type WebhookEvent } from 'livekit-server-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MeetingsService } from '../meetings/meetings.service';

import { LivekitEventsHandler } from './livekit-events.handler';

/**
 * Тестируем LivekitEventsHandler как чистую функцию.
 * `prisma`, `meetings`, `metrics` — мокаем, проверяем что:
 *   - room_started: scheduled → active.
 *   - room_started повторно: no-op.
 *   - room_finished: active → completed (+ metric).
 *   - participant_joined: обновляет joinedAt.
 *   - неизвестный тип события: не падает.
 */

interface MockMeetingState {
  status: string;
  type: string;
}

function makeHandler(
  meetingState: MockMeetingState | null,
  participantState: { id: string } | null = null,
): {
  handler: LivekitEventsHandler;
  prisma: any;
  meetings: any;
  metrics: any;
} {
  const meetingFindUnique = vi.fn(async () =>
    meetingState ? { id: 'm-1', ...meetingState } : null,
  );
  const participantFindUnique = vi.fn(async () =>
    participantState ? { id: participantState.id } : null,
  );
  const participantUpdate = vi.fn();
  const participantCreate = vi.fn();
  const participantUpdateMany = vi.fn();

  const prisma = {
    meeting: { findUnique: meetingFindUnique },
    participant: {
      findUnique: participantFindUnique,
      update: participantUpdate,
      create: participantCreate,
      updateMany: participantUpdateMany,
    },
  } as unknown as PrismaService;

  const meetings = {
    transitionStatus: vi.fn(async () => undefined),
  } as unknown as MeetingsService;

  const metrics = {
    incLivekitWebhookEvent: vi.fn(),
    incMeetingFinished: vi.fn(),
  } as unknown as BusinessMetricsService;

  const handler = new LivekitEventsHandler(prisma, meetings, metrics);
  return { handler, prisma, meetings, metrics };
}

function evt(type: string, room: string, participant?: { identity: string; name?: string }): WebhookEvent {
  return {
    event: type,
    room: { name: room },
    ...(participant ? { participant } : {}),
  } as unknown as WebhookEvent;
}

describe('LivekitEventsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('room_started переводит scheduled → active', async () => {
    const { handler, meetings, metrics } = makeHandler({ status: 'scheduled', type: 'sales' });
    await handler.handle(evt('room_started', 'm-1'));

    expect(metrics.incLivekitWebhookEvent).toHaveBeenCalledWith('room_started');
    expect(meetings.transitionStatus).toHaveBeenCalledWith(
      'm-1',
      'active',
      expect.objectContaining({
        startedAt: expect.any(Date),
        reason: 'livekit:room_started',
      }),
    );
  });

  it('room_started когда уже active → no-op', async () => {
    const { handler, meetings } = makeHandler({ status: 'active', type: 'sales' });
    await handler.handle(evt('room_started', 'm-1'));

    expect(meetings.transitionStatus).not.toHaveBeenCalled();
  });

  it('room_finished переводит active → completed и инкрементит metric', async () => {
    const { handler, meetings, metrics } = makeHandler({ status: 'active', type: 'standup' });
    await handler.handle(evt('room_finished', 'm-1'));

    expect(meetings.transitionStatus).toHaveBeenCalledWith(
      'm-1',
      'completed',
      expect.objectContaining({
        endedAt: expect.any(Date),
        reason: 'livekit:room_finished',
      }),
    );
    expect(metrics.incMeetingFinished).toHaveBeenCalledWith('standup');
  });

  it('room_finished когда статус не active → no-op', async () => {
    const { handler, meetings } = makeHandler({ status: 'scheduled', type: 'sales' });
    await handler.handle(evt('room_finished', 'm-1'));

    expect(meetings.transitionStatus).not.toHaveBeenCalled();
  });

  it('room_started без существующей встречи → не падает', async () => {
    const { handler, meetings } = makeHandler(null);
    await expect(handler.handle(evt('room_started', 'unknown'))).resolves.toBeUndefined();
    expect(meetings.transitionStatus).not.toHaveBeenCalled();
  });

  it('participant_joined: existing participant — обновляет joinedAt', async () => {
    const { handler, prisma } = makeHandler(
      { status: 'active', type: 'sales' },
      { id: 'p-1' },
    );

    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'guest:abc', name: 'Гость' }),
    );

    expect((prisma as any).participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-1' },
        data: { joinedAt: expect.any(Date) },
      }),
    );
    expect((prisma as any).participant.create).not.toHaveBeenCalled();
  });

  it('participant_joined: нет participant в БД → создаёт нового guest', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' }, null);
    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'guest:fallback', name: 'F' }),
    );

    expect((prisma as any).participant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meetingId: 'm-1',
          livekitIdentity: 'guest:fallback',
          role: 'guest',
        }),
      }),
    );
  });

  it('participant_joined: egress-рекордер (identity не host:/guest:) → no-op, не создаёт фантома', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' }, null);
    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'EG_cxZHYyvp3SGD' }),
    );

    expect((prisma as any).participant.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).participant.create).not.toHaveBeenCalled();
    expect((prisma as any).participant.update).not.toHaveBeenCalled();
  });

  it('participant_left обновляет leftAt', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' });
    await handler.handle(
      evt('participant_left', 'm-1', { identity: 'guest:abc' }),
    );

    expect((prisma as any).participant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'm-1', livekitIdentity: 'guest:abc' },
        data: { leftAt: expect.any(Date) },
      }),
    );
  });

  it('неизвестный event type — не бросает', async () => {
    const { handler, meetings } = makeHandler({ status: 'active', type: 'sales' });
    await expect(
      handler.handle(evt('unknown_event' as unknown as string, 'm-1')),
    ).resolves.toBeUndefined();
    expect(meetings.transitionStatus).not.toHaveBeenCalled();
  });

  it('track_published — no-op для FSM', async () => {
    const { handler, meetings } = makeHandler({ status: 'active', type: 'sales' });
    await handler.handle(evt('track_published', 'm-1'));
    expect(meetings.transitionStatus).not.toHaveBeenCalled();
  });
});
