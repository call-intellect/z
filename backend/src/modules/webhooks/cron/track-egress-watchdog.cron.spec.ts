import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RecordingsService } from '../../recordings/recordings.service';
import type { MeetingFinalizationService } from '../meeting-finalization.service';

import { TrackEgressWatchdogCron } from './track-egress-watchdog.cron';

interface TrackRow {
  id: string;
  audioUrl: string;
  bytes: bigint | null;
}

function make(setup: {
  enabled: boolean;
  timeoutMinutes?: number;
  candidates?: Array<{ meetingId: string; audioTracks: TrackRow[] }>;
  finalizeResult?: { allReady: boolean };
}): {
  cron: TrackEgressWatchdogCron;
  prisma: any;
  recordings: any;
  finalization: any;
  metrics: any;
} {
  const findMany = vi.fn(async () => setup.candidates ?? []);
  const prisma = { recording: { findMany } } as unknown as PrismaService;

  const recordings = {
    degradeStuckTracksAndFinalize: vi.fn(
      async () => setup.finalizeResult ?? { status: 'ready', allReady: true },
    ),
  } as unknown as RecordingsService;

  const finalization = {
    promoteMeetingToReady: vi.fn(async () => undefined),
  } as unknown as MeetingFinalizationService;

  const metrics = {
    incRecordingTrackWatchdog: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {
    getDynamic: vi.fn(async (key: string, _env: unknown, def: unknown) => {
      if (key === 'recording.trackWatchdogEnabled') return setup.enabled;
      if (key === 'recording.trackWatchdogTimeoutMinutes')
        return setup.timeoutMinutes ?? 20;
      return def;
    }),
  } as unknown as TypedConfigService;

  const cron = new TrackEgressWatchdogCron(prisma, recordings, finalization, metrics, cfg);
  return { cron, prisma, recordings, finalization, metrics };
}

const NOW = new Date('2026-06-22T12:00:00.000Z');

describe('TrackEgressWatchdogCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kill-switch off → не дёргает БД и ничего не делает', async () => {
    const { cron, prisma, recordings, finalization } = make({ enabled: false });
    await cron.sweep(NOW);
    expect((prisma as any).recording.findMany).not.toHaveBeenCalled();
    expect((recordings as any).degradeStuckTracksAndFinalize).not.toHaveBeenCalled();
    expect((finalization as any).promoteMeetingToReady).not.toHaveBeenCalled();
  });

  it('застрявший аудио-трек (s3://) старше порога + есть готовый трек → деградирует и промоутит, метрика forced', async () => {
    const { cron, recordings, finalization, metrics } = make({
      enabled: true,
      candidates: [
        {
          meetingId: 'm-1',
          audioTracks: [
            { id: 't-stuck', audioUrl: 's3://bucket/k1', bytes: null },
            { id: 't-ready', audioUrl: 'https://s3/k2', bytes: BigInt(1234) },
          ],
        },
      ],
      finalizeResult: { allReady: true },
    });

    await cron.sweep(NOW);

    expect((recordings as any).degradeStuckTracksAndFinalize).toHaveBeenCalledWith('m-1', [
      't-stuck',
    ]);
    expect((finalization as any).promoteMeetingToReady).toHaveBeenCalledWith('m-1', true);
    expect((metrics as any).incRecordingTrackWatchdog).toHaveBeenCalledWith({
      outcome: 'forced',
    });
  });

  it('все треки застряли (нет ни одного готового) → не деградирует, метрика skipped', async () => {
    const { cron, recordings, finalization, metrics } = make({
      enabled: true,
      candidates: [
        {
          meetingId: 'm-2',
          audioTracks: [
            { id: 't-1', audioUrl: 's3://bucket/k1', bytes: null },
            { id: 't-2', audioUrl: 's3://bucket/k2', bytes: null },
          ],
        },
      ],
    });

    await cron.sweep(NOW);

    expect((recordings as any).degradeStuckTracksAndFinalize).not.toHaveBeenCalled();
    expect((finalization as any).promoteMeetingToReady).not.toHaveBeenCalled();
    expect((metrics as any).incRecordingTrackWatchdog).toHaveBeenCalledWith({
      outcome: 'skipped',
    });
  });

  it('порог времени: findMany фильтрует endedAt < (now - timeoutMinutes) — молодой трек не попадёт в выборку', async () => {
    const { cron, prisma } = make({
      enabled: true,
      timeoutMinutes: 20,
      candidates: [],
    });

    await cron.sweep(NOW);

    const arg = (prisma as any).recording.findMany.mock.calls[0][0];
    const cutoff: Date = arg.where.meeting.endedAt.lt;
    expect(cutoff.getTime()).toBe(NOW.getTime() - 20 * 60_000);
    expect(arg.where.mainVideoUrl).toEqual({ not: null });
    expect(arg.where.status.in).toEqual(['recording', 'finalizing']);
  });

  it('finalize дал allReady=false → промоут вызван с false (транскрипция не ставится), метрика forced', async () => {
    const { cron, finalization, metrics } = make({
      enabled: true,
      candidates: [
        {
          meetingId: 'm-3',
          audioTracks: [
            { id: 't-stuck', audioUrl: 's3://bucket/k1', bytes: null },
            { id: 't-ready', audioUrl: 'https://s3/k2', bytes: BigInt(99) },
          ],
        },
      ],
      finalizeResult: { allReady: false },
    });

    await cron.sweep(NOW);

    expect((finalization as any).promoteMeetingToReady).toHaveBeenCalledWith('m-3', false);
    expect((metrics as any).incRecordingTrackWatchdog).toHaveBeenCalledWith({
      outcome: 'forced',
    });
  });
});
