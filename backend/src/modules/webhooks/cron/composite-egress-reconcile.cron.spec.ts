import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RecordingsService } from '../../recordings/recordings.service';
import type { MeetingFinalizationService } from '../meeting-finalization.service';

import { CompositeEgressReconcileCron } from './composite-egress-reconcile.cron';

function make(setup: {
  enabled: boolean;
  candidates?: Array<{ meetingId: string }>;
  reconcileResult?: { becameComplete: boolean; allReady: boolean; compositeBytes: number | null };
}): {
  cron: CompositeEgressReconcileCron;
  prisma: any;
  recordings: any;
  finalization: any;
} {
  const findMany = vi.fn(async () => setup.candidates ?? []);
  const prisma = { recording: { findMany } } as unknown as PrismaService;

  const recordings = {
    reconcileCompositeEgress: vi.fn(
      async () =>
        setup.reconcileResult ?? {
          becameComplete: false,
          allReady: false,
          compositeBytes: null,
        },
    ),
  } as unknown as RecordingsService;

  const finalization = {
    enqueueFaststartIfNeeded: vi.fn(async () => undefined),
    promoteMeetingToReady: vi.fn(async () => undefined),
  } as unknown as MeetingFinalizationService;

  const cfg = {
    recording: { compositeReconcileEnabled: setup.enabled },
  } as unknown as TypedConfigService;

  const cron = new CompositeEgressReconcileCron(prisma, recordings, finalization, cfg);
  return { cron, prisma, recordings, finalization };
}

describe('CompositeEgressReconcileCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('флаг off → не дёргает БД', async () => {
    const { cron, prisma } = make({ enabled: false });
    await cron.sweep();
    expect((prisma as any).recording.findMany).not.toHaveBeenCalled();
  });

  it('флаг on + becameComplete → промоутит встречу + faststart', async () => {
    const { cron, recordings, finalization } = make({
      enabled: true,
      candidates: [{ meetingId: 'm-1' }],
      reconcileResult: { becameComplete: true, allReady: true, compositeBytes: 42 },
    });

    await cron.sweep();

    expect((recordings as any).reconcileCompositeEgress).toHaveBeenCalledWith('m-1');
    expect((finalization as any).enqueueFaststartIfNeeded).toHaveBeenCalledWith('m-1', 42);
    expect((finalization as any).promoteMeetingToReady).toHaveBeenCalledWith('m-1', true);
  });

  it('флаг on + becameComplete:false → не промоутит', async () => {
    const { cron, finalization } = make({
      enabled: true,
      candidates: [{ meetingId: 'm-1' }],
      reconcileResult: { becameComplete: false, allReady: false, compositeBytes: null },
    });

    await cron.sweep();

    expect((finalization as any).promoteMeetingToReady).not.toHaveBeenCalled();
  });
});
