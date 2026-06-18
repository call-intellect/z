import { describe, expect, it, vi } from 'vitest';

import type { Entity, RawEvent } from '@prisma/client';

import { BlockIngestWorker } from './block-ingest.worker';

/**
 * Probe Ф6 (2026-06-17) — атрибуционный probe «к чему относится новая
 * сущность» при ingest. Тест дёргает приватный `emitAttributionProbe` через
 * any-cast: проверяем, что probeService.suggest зовётся ровно для НОВОЙ
 * значимой сущности (customer/vendor) без привязки и с непустыми получателями,
 * и НЕ зовётся для служебных/привязанных типов.
 */

interface ProbeMock {
  suggest: ReturnType<typeof vi.fn>;
}

function buildWorker(opts: {
  meetingOwnerId?: string | null;
  admins?: string[];
}): { worker: BlockIngestWorker; probe: ProbeMock } {
  const prisma = {
    meeting: {
      findFirst: vi.fn(async () =>
        opts.meetingOwnerId ? { ownerId: opts.meetingOwnerId } : null,
      ),
    },
    membership: {
      findMany: vi.fn(async () =>
        (opts.admins ?? []).map((userId) => ({ userId })),
      ),
    },
  } as unknown;

  const suggest = vi.fn(async () => ({ ok: true, probeEventId: 'pe-1' }));
  const probe = { suggest } as unknown;

  const worker = new BlockIngestWorker(
    {} as never, // redis
    prisma as never, // prisma
    {} as never, // s3
    {} as never, // segments
    {} as never, // extractor
    {} as never, // embeddings
    {} as never, // entities
    {} as never, // coreQueue
    {} as never, // gate
    {} as never, // graph
    {} as never, // metrics
    {} as never, // axisClassifier
    {} as never, // cfg
    {} as never, // blockAccessDeriver
    probe as never, // probeService (Ф6)
  );
  return { worker, probe: { suggest } };
}

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'ent-1',
    tenantId: 'tenant-1',
    type: 'customer',
    canonicalName: 'ООО Ромашка',
    metadata: null,
    mergedIntoId: null,
    mentionsCount: 1,
    ...overrides,
  } as unknown as Entity;
}

const meetingEvent = {
  id: 'raw-1',
  tenantId: 'tenant-1',
  sourceType: 'meeting',
  sourceExternalId: 'meet-1',
} as unknown as RawEvent;

const textEvent = {
  id: 'raw-2',
  tenantId: 'tenant-1',
  sourceType: 'chat',
  sourceExternalId: null,
} as unknown as RawEvent;

describe('BlockIngestWorker.emitAttributionProbe (Ф6)', () => {
  it('новый customer без привязки (meeting) → suggest вызван с reason и владельцем встречи', async () => {
    const { worker, probe } = buildWorker({ meetingOwnerId: 'owner-1' });
    await (worker as unknown as {
      emitAttributionProbe: (e: Entity, ev: RawEvent) => Promise<void>;
    }).emitAttributionProbe(entity(), meetingEvent);

    expect(probe.suggest).toHaveBeenCalledTimes(1);
    expect(probe.suggest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        emittedByService: 'ingest-attribution',
        reason: 'attribution.unresolved_at_ingest',
        recipientCandidates: ['owner-1'],
        payload: expect.objectContaining({
          contextCardId: 'ent-1',
          contextCardKind: 'entity',
        }),
      }),
    );
  });

  it('нет встречи → получатели из owner/admin Org', async () => {
    const { worker, probe } = buildWorker({ admins: ['adm-1', 'adm-2'] });
    await (worker as unknown as {
      emitAttributionProbe: (e: Entity, ev: RawEvent) => Promise<void>;
    }).emitAttributionProbe(entity({ type: 'vendor' }), textEvent);

    expect(probe.suggest).toHaveBeenCalledTimes(1);
    const arg = probe.suggest.mock.calls[0]![0] as {
      recipientCandidates: string[];
    };
    expect(arg.recipientCandidates).toEqual(['adm-1', 'adm-2']);
  });

  it('служебный тип (person) → suggest НЕ вызван', async () => {
    const { worker, probe } = buildWorker({ admins: ['adm-1'] });
    await (worker as unknown as {
      emitAttributionProbe: (e: Entity, ev: RawEvent) => Promise<void>;
    }).emitAttributionProbe(entity({ type: 'person' }), meetingEvent);
    expect(probe.suggest).not.toHaveBeenCalled();
  });

  it('уже привязана (metadata.departmentId) → suggest НЕ вызван', async () => {
    const { worker, probe } = buildWorker({ meetingOwnerId: 'owner-1' });
    await (worker as unknown as {
      emitAttributionProbe: (e: Entity, ev: RawEvent) => Promise<void>;
    }).emitAttributionProbe(
      entity({ metadata: { departmentId: 'd1' } as never }),
      meetingEvent,
    );
    expect(probe.suggest).not.toHaveBeenCalled();
  });

  it('нет получателей вовсе → suggest НЕ вызван', async () => {
    const { worker, probe } = buildWorker({ admins: [] });
    await (worker as unknown as {
      emitAttributionProbe: (e: Entity, ev: RawEvent) => Promise<void>;
    }).emitAttributionProbe(entity(), textEvent);
    expect(probe.suggest).not.toHaveBeenCalled();
  });
});
