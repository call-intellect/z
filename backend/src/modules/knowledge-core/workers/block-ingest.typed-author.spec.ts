import { describe, expect, it, vi } from 'vitest';

import { BlockIngestWorker } from './block-ingest.worker';

interface PrismaMocks {
  evidenceFindFirst: ReturnType<typeof vi.fn>;
  personFindFirst: ReturnType<typeof vi.fn>;
  processFindFirst: ReturnType<typeof vi.fn>;
  processUpdate: ReturnType<typeof vi.fn>;
  policyFindFirst: ReturnType<typeof vi.fn>;
  policyUpdate: ReturnType<typeof vi.fn>;
}

function buildWorker(mocks: PrismaMocks): BlockIngestWorker {
  const prisma = {
    ideaBlockEvidence: { findFirst: mocks.evidenceFindFirst },
    person: { findFirst: mocks.personFindFirst },
    process: { findFirst: mocks.processFindFirst, update: mocks.processUpdate },
    policy: { findFirst: mocks.policyFindFirst, update: mocks.policyUpdate },
  } as unknown;

  return new BlockIngestWorker(
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function makeMocks(overrides: Partial<PrismaMocks> = {}): PrismaMocks {
  return {
    evidenceFindFirst: vi.fn(),
    personFindFirst: vi.fn(),
    processFindFirst: vi.fn(),
    processUpdate: vi.fn(async () => ({})),
    policyFindFirst: vi.fn(),
    policyUpdate: vi.fn(async () => ({})),
    ...overrides,
  };
}

function attach(
  worker: BlockIngestWorker,
  args: { tenantId: string; table: 'process' | 'policy'; entityId: string; blockId: string | null },
): Promise<void> {
  return (
    worker as unknown as {
      attachBlockAuthorToTypedEntity: (
        tenantId: string,
        table: 'process' | 'policy',
        entityId: string,
        blockId: string | null,
      ) => Promise<void>;
    }
  ).attachBlockAuthorToTypedEntity(args.tenantId, args.table, args.entityId, args.blockId);
}

describe('BlockIngestWorker — Ф7.3 привязка автора блока к Process/Policy', () => {
  it('(a) первый автор P (entityId E), owner=null, subjects=[] → update ownerPersonId=P + personSubjectIds=[E]', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => ({ authorPersonId: 'P' })),
      personFindFirst: vi.fn(async () => ({ id: 'P', entityId: 'E' })),
      processFindFirst: vi.fn(async () => ({ ownerPersonId: null, personSubjectIds: [] })),
    });
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'process', entityId: 'proc-1', blockId: 'blk-1' });

    expect(mocks.processUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proc-1' },
        data: expect.objectContaining({ ownerPersonId: 'P', personSubjectIds: ['E'] }),
      }),
    );
  });

  it('(b) второй автор A2 (entityId E2), owner=P уже есть, subjects=[E] → update без ownerPersonId, personSubjectIds=[E,E2]', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => ({ authorPersonId: 'A2' })),
      personFindFirst: vi.fn(async () => ({ id: 'A2', entityId: 'E2' })),
      processFindFirst: vi.fn(async () => ({ ownerPersonId: 'P', personSubjectIds: ['E'] })),
    });
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'process', entityId: 'proc-1', blockId: 'blk-2' });

    const call = mocks.processUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data).not.toHaveProperty('ownerPersonId');
    expect(mocks.processUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proc-1' },
        data: expect.objectContaining({ personSubjectIds: ['E', 'E2'] }),
      }),
    );
  });

  it('(c) нет автора (evidence без authorPersonId) → update НЕ вызван, не бросает', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => null),
    });
    const worker = buildWorker(mocks);

    await expect(
      attach(worker, { tenantId: 't1', table: 'process', entityId: 'proc-1', blockId: 'blk-3' }),
    ).resolves.toBeUndefined();

    expect(mocks.personFindFirst).not.toHaveBeenCalled();
    expect(mocks.processUpdate).not.toHaveBeenCalled();
  });

  it('(d) blockId=null → ранний выход, никаких запросов', async () => {
    const mocks = makeMocks();
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'policy', entityId: 'pol-1', blockId: null });

    expect(mocks.evidenceFindFirst).not.toHaveBeenCalled();
    expect(mocks.policyUpdate).not.toHaveBeenCalled();
  });

  it('(e) tenant-изоляция: Person другого тенанта не матчится (person.findFirst → null) → update НЕ вызван', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => ({ authorPersonId: 'P' })),
      personFindFirst: vi.fn(async () => null),
      processFindFirst: vi.fn(async () => ({ ownerPersonId: null, personSubjectIds: [] })),
    });
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'process', entityId: 'proc-1', blockId: 'blk-4' });

    expect(mocks.personFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'P', tenantId: 't1' }) }),
    );
    expect(mocks.processFindFirst).not.toHaveBeenCalled();
    expect(mocks.processUpdate).not.toHaveBeenCalled();
  });

  it('(f) tenant-изоляция evidence: findFirst зовётся с tenantId', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => null),
    });
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'policy', entityId: 'pol-1', blockId: 'blk-5' });

    expect(mocks.evidenceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ blockId: 'blk-5', tenantId: 't1' }),
      }),
    );
  });

  it('(g) менять нечего (owner есть И subject уже в списке) → update НЕ вызван', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => ({ authorPersonId: 'P' })),
      personFindFirst: vi.fn(async () => ({ id: 'P', entityId: 'E' })),
      policyFindFirst: vi.fn(async () => ({ ownerPersonId: 'P', personSubjectIds: ['E'] })),
    });
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'policy', entityId: 'pol-1', blockId: 'blk-6' });

    expect(mocks.policyUpdate).not.toHaveBeenCalled();
  });

  it('(h) policy create-путь: owner=null, subjects=[] → update ownerPersonId + personSubjectIds', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => ({ authorPersonId: 'P' })),
      personFindFirst: vi.fn(async () => ({ id: 'P', entityId: 'E' })),
      policyFindFirst: vi.fn(async () => ({ ownerPersonId: null, personSubjectIds: [] })),
    });
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'policy', entityId: 'pol-1', blockId: 'blk-7' });

    expect(mocks.policyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pol-1' },
        data: expect.objectContaining({ ownerPersonId: 'P', personSubjectIds: ['E'] }),
      }),
    );
  });

  it('(i) автор без entityId, owner=null → ставим owner, subjects не меняем → update НЕ вызван (owner только)', async () => {
    const mocks = makeMocks({
      evidenceFindFirst: vi.fn(async () => ({ authorPersonId: 'P' })),
      personFindFirst: vi.fn(async () => ({ id: 'P', entityId: null })),
      processFindFirst: vi.fn(async () => ({ ownerPersonId: null, personSubjectIds: [] })),
    });
    const worker = buildWorker(mocks);

    await attach(worker, { tenantId: 't1', table: 'process', entityId: 'proc-1', blockId: 'blk-8' });

    const call = mocks.processUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data).toEqual({ ownerPersonId: 'P' });
    expect(call.data).not.toHaveProperty('personSubjectIds');
  });
});
