import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SpecialistRoutingJobData } from '../../core-queue/queues';

import { Specialist315TasksWorker } from './specialist-3-15-tasks.worker';

const TENANT = 't1';
const BLOCK_ID = 'b1';

interface Mocks {
  prisma: { ideaBlock: { findUnique: ReturnType<typeof vi.fn> } };
  svc: { processBlock: ReturnType<typeof vi.fn> };
  metrics: {
    incCoreSpecialistSkipped: ReturnType<typeof vi.fn>;
    observeCoreSpecialistPipelineDuration: ReturnType<typeof vi.fn>;
  };
  cfg: { getDynamic: ReturnType<typeof vi.fn> };
}

function build(): { worker: Specialist315TasksWorker; m: Mocks } {
  const m: Mocks = {
    prisma: { ideaBlock: { findUnique: vi.fn() } },
    svc: { processBlock: vi.fn().mockResolvedValue(undefined) },
    metrics: {
      incCoreSpecialistSkipped: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
    },
    cfg: {
      getDynamic: vi
        .fn()
        .mockImplementation(
          (_key: string, _env: string | undefined, def: unknown) => def,
        ),
    },
  };
  const worker = new Specialist315TasksWorker(

    m.prisma as any,

    m.svc as any,

    m.metrics as any,

    m.cfg as any,
  );
  return { worker, m };
}

function job(): Job<SpecialistRoutingJobData> {
  return {
    name: '3-15-tasks',
    data: { blockId: BLOCK_ID, tenantId: TENANT },
  } as unknown as Job<SpecialistRoutingJobData>;
}

function blockOf(signalType: string, status = 'canonical') {
  return { id: BLOCK_ID, tenantId: TENANT, status, signalType };
}

describe('Specialist315TasksWorker.handle', () => {
  let worker: Specialist315TasksWorker;
  let m: Mocks;

  beforeEach(() => {
    ({ worker, m } = build());
  });

  it('(h) signal_out_of_scope (не action_item) → processBlock НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(blockOf('decision'));

    await worker.handle(job());

    expect(m.svc.processBlock).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'signal_out_of_scope' }),
    );
  });

  it('(i) not_canonical → processBlock НЕ вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(blockOf('action_item', 'draft'));

    await worker.handle(job());

    expect(m.svc.processBlock).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'not_canonical' }),
    );
  });

  it('(j) kill-switch legacy → processBlock НЕ вызван; spine → вызван', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(blockOf('action_item'));
    m.cfg.getDynamic.mockImplementation((key: string) =>
      key === 'tracker.taskExtractionMode' ? 'legacy' : undefined,
    );

    await worker.handle(job());

    expect(m.svc.processBlock).not.toHaveBeenCalled();
    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'mode_legacy' }),
    );

    m.svc.processBlock.mockClear();
    m.cfg.getDynamic.mockImplementation(
      (_key: string, _env: string | undefined, def: unknown) => def,
    );

    await worker.handle(job());

    expect(m.svc.processBlock).toHaveBeenCalledWith({
      tenantId: TENANT,
      blockId: BLOCK_ID,
    });
  });
});
