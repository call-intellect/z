import { type WebhookEvent } from 'livekit-server-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MeetingsService } from '../meetings/meetings.service';

import { LivekitEventsHandler } from './livekit-events.handler';
import { MeetingFinalizationService } from './meeting-finalization.service';

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

  const finalization = new MeetingFinalizationService(prisma, meetings);
  const handler = new LivekitEventsHandler(
    prisma,
    meetings,
    metrics,
    null,
    null,
    null,
    finalization,
  );
  return { handler, prisma, meetings, metrics };
}

function evt(
  type: string,
  room: string,
  participant?: { identity: string; name?: string; kind?: string | number },
): WebhookEvent {
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

  it('participant_joined: egress-рекордер (identity не host:/guest:, нет kind) → no-op, не создаёт фантома', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' }, null);
    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'EG_cxZHYyvp3SGD' }),
    );

    expect((prisma as any).participant.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).participant.create).not.toHaveBeenCalled();
    expect((prisma as any).participant.update).not.toHaveBeenCalled();
  });

  it('participant_joined: invitee: (личная ссылка, нет kind), existing → обновляет joinedAt, не no-op', async () => {
    const { handler, prisma } = makeHandler(
      { status: 'active', type: 'sales' },
      { id: 'p-inv' },
    );

    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'invitee:tok', name: 'Сотрудник' }),
    );

    // Приглашённый по личной ссылке — реальный участник, не отсекается.
    expect((prisma as any).participant.findUnique).toHaveBeenCalled();
    expect((prisma as any).participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-inv' },
        data: { joinedAt: expect.any(Date) },
      }),
    );
    expect((prisma as any).participant.create).not.toHaveBeenCalled();
  });

  it('participant_joined: kind=EGRESS (строка) → no-op даже если identity случайно с префиксом', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' }, null);
    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'guest:fake', kind: 'EGRESS' }),
    );

    // Семантический фильтр приоритетнее строкового префикса.
    expect((prisma as any).participant.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).participant.create).not.toHaveBeenCalled();
  });

  it('participant_joined: kind=2 (число EGRESS) → no-op', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' }, null);
    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'EG_x', kind: 2 }),
    );

    expect((prisma as any).participant.create).not.toHaveBeenCalled();
  });

  it('participant_joined: kind=AGENT → no-op (AI-ассистент не Participant)', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' }, null);
    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'agent:assistant', kind: 'AGENT' }),
    );

    expect((prisma as any).participant.create).not.toHaveBeenCalled();
  });

  it('participant_joined: kind=STANDARD (явно) → создаёт участника', async () => {
    const { handler, prisma } = makeHandler({ status: 'active', type: 'sales' }, null);
    await handler.handle(
      evt('participant_joined', 'm-1', { identity: 'host:u-1', name: 'Хост', kind: 'STANDARD' }),
    );

    expect((prisma as any).participant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meetingId: 'm-1',
          livekitIdentity: 'host:u-1',
          role: 'host',
        }),
      }),
    );
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

  // ───────────────────── faststart enqueue (Фаза 3) ──────────────────────

  function egressEndedEvt(meetingId: string, size: number): WebhookEvent {
    return {
      event: 'egress_ended',
      egressInfo: {
        egressId: 'EG_C1',
        roomName: meetingId,
        requestType: 'room_composite',
        fileResults: [
          { location: `https://s3.local/z-records/meetings/${meetingId}/composite.mp4`, size, duration: 1_000_000_000 },
        ],
      },
    } as unknown as WebhookEvent;
  }

  function makeEgressHandler(
    faststartEnabled: boolean,
    endedAt: Date | null = null,
  ): {
    handler: LivekitEventsHandler;
    aiQueue: any;
    metrics: any;
  } {
    const prisma = {
      meeting: {
        findUnique: vi.fn(async () => ({ id: 'm-1', status: 'completed', endedAt })),
      },
    } as unknown as PrismaService;
    const meetings = { transitionStatus: vi.fn(async () => undefined) } as unknown as MeetingsService;
    const metrics = {
      incLivekitWebhookEvent: vi.fn(),
      observeEgressEndedGap: vi.fn(),
    } as unknown as BusinessMetricsService;
    const recordings = {
      onCompositeEnded: vi.fn(async () => ({ status: 'finalizing', allReady: false })),
    } as any;
    const aiQueue = {
      enqueueRecordingFaststart: vi.fn(async () => undefined),
      enqueueTranscribe: vi.fn(async () => undefined),
    } as any;
    const cfg = { recording: { faststartEnabled, faststartMinBytes: 52_428_800 } } as any;
    const finalization = new MeetingFinalizationService(prisma, meetings, aiQueue, cfg);
    const handler = new LivekitEventsHandler(
      prisma,
      meetings,
      metrics,
      recordings,
      aiQueue,
      cfg,
      finalization,
    );
    return { handler, aiQueue, metrics };
  }

  it('egress_ended(composite): флаг on + размер выше порога → ставит faststart в очередь', async () => {
    const { handler, aiQueue } = makeEgressHandler(true);
    await handler.handle(egressEndedEvt('m-1', 400 * 1024 * 1024));
    expect(aiQueue.enqueueRecordingFaststart).toHaveBeenCalledWith('m-1');
  });

  it('egress_ended(composite): размер ниже порога → faststart НЕ ставится', async () => {
    const { handler, aiQueue } = makeEgressHandler(true);
    await handler.handle(egressEndedEvt('m-1', 1_000_000)); // 1 МБ < 50 МиБ
    expect(aiQueue.enqueueRecordingFaststart).not.toHaveBeenCalled();
  });

  it('egress_ended(composite): флаг off → faststart НЕ ставится', async () => {
    const { handler, aiQueue } = makeEgressHandler(false);
    await handler.handle(egressEndedEvt('m-1', 400 * 1024 * 1024));
    expect(aiQueue.enqueueRecordingFaststart).not.toHaveBeenCalled();
  });

  it('egress_ended: при наличии meeting.endedAt — пишет gap-метрику', async () => {
    const endedAt = new Date(Date.now() - 30_000); // 30 секунд назад
    const { handler, metrics } = makeEgressHandler(true, endedAt);
    await handler.handle(egressEndedEvt('m-1', 400 * 1024 * 1024));
    expect(metrics.observeEgressEndedGap).toHaveBeenCalledTimes(1);
    const [requestType, gap] = (metrics.observeEgressEndedGap as any).mock.calls[0];
    expect(requestType).toBe('room_composite');
    expect(gap).toBeGreaterThanOrEqual(29);
  });

  it('egress_ended: без meeting.endedAt — gap-метрика НЕ пишется', async () => {
    const { handler, metrics } = makeEgressHandler(true, null);
    await handler.handle(egressEndedEvt('m-1', 400 * 1024 * 1024));
    expect(metrics.observeEgressEndedGap).not.toHaveBeenCalled();
  });
});
