import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist37SkillWorker } from './specialist-3-7-skill.worker';

const TENANT = 'org-1';
const BLOCK_ID = 'block-1';

interface Mocks {
  prisma: {
    ideaBlock: { findUnique: ReturnType<typeof vi.fn> };
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    person: { findMany: ReturnType<typeof vi.fn> };
  };
  coreQueue: { enqueueRebuildSkillProfile: ReturnType<typeof vi.fn> };
  specialist: { getOrCreateForPerson: ReturnType<typeof vi.fn> };
  metrics: {
    incCoreSpecialistSkipped: ReturnType<typeof vi.fn>;
    incCoreSpecialistExtractionFailure: ReturnType<typeof vi.fn>;
    observeCoreSpecialistPipelineDuration: ReturnType<typeof vi.fn>;
  };
}

function makeMocks(signalType: string, status = 'canonical'): Mocks {
  return {
    prisma: {
      ideaBlock: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: BLOCK_ID, tenantId: TENANT, status, signalType }),
      },
      ideaBlockEntity: {
        findMany: vi.fn().mockResolvedValue([{ entityId: 'e1' }]),
      },
      person: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]),
      },
    },
    coreQueue: {
      enqueueRebuildSkillProfile: vi.fn().mockResolvedValue({ jobId: 'j1' }),
    },
    specialist: {
      getOrCreateForPerson: vi.fn().mockResolvedValue({ id: 'profile-1' }),
    },
    metrics: {
      incCoreSpecialistSkipped: vi.fn(),
      incCoreSpecialistExtractionFailure: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
    },
  };
}

function buildWorker(m: Mocks): Specialist37SkillWorker {
  return new Specialist37SkillWorker(
    m.prisma as never,
    m.coreQueue as never,
    m.specialist as never,
    m.metrics as never,
  );
}

function jobFor(): never {
  return { data: { blockId: BLOCK_ID, tenantId: TENANT } } as never;
}

describe('Specialist37SkillWorker.handle — гейт signalType', () => {
  let m: Mocks;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('methodology_step доходит до enqueueRebuildSkillProfile', async () => {
    m = makeMocks('methodology_step');
    const worker = buildWorker(m);

    await worker.handle(jobFor());

    expect(m.coreQueue.enqueueRebuildSkillProfile).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: 'profile-1', tenantId: TENANT }),
    );
    expect(m.metrics.incCoreSpecialistSkipped).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'signal_out_of_scope' }),
    );
  });

  it('fact отсекается гейтом (signal_out_of_scope), без enqueue', async () => {
    m = makeMocks('fact');
    const worker = buildWorker(m);

    await worker.handle(jobFor());

    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'signal_out_of_scope' }),
    );
    expect(m.coreQueue.enqueueRebuildSkillProfile).not.toHaveBeenCalled();
  });

  it('не-canonical блок отсекается раньше гейта (not_canonical), без enqueue', async () => {
    m = makeMocks('methodology_step', 'draft');
    const worker = buildWorker(m);

    await worker.handle(jobFor());

    expect(m.metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'not_canonical' }),
    );
    expect(m.coreQueue.enqueueRebuildSkillProfile).not.toHaveBeenCalled();
  });
});
