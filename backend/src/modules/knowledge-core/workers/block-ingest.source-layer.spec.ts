import { describe, expect, it, vi } from 'vitest';

import { BlockIngestWorker } from './block-ingest.worker';

interface PrismaMocks {
  episodeUpsert: ReturnType<typeof vi.fn>;
  participantFindMany: ReturnType<typeof vi.fn>;
  sourceParticipantUpsert: ReturnType<typeof vi.fn>;
  ideaBlockEntityGroupBy: ReturnType<typeof vi.fn>;
  sourceEntityUpsert: ReturnType<typeof vi.fn>;
  executeRawUnsafe: ReturnType<typeof vi.fn>;
}

function buildWorker(opts?: {
  participants?: Array<{ personId: string | null; role: 'host' | 'guest' }>;
  groupedEntities?: Array<{ entityId: string; _count: { entityId: number } }>;
}): { worker: BlockIngestWorker; mocks: PrismaMocks } {
  const episodeUpsert = vi.fn(async () => ({ id: 'ep-1' }));
  const participantFindMany = vi.fn(async () => opts?.participants ?? []);
  const sourceParticipantUpsert = vi.fn(async () => ({}));
  const ideaBlockEntityGroupBy = vi.fn(async () => opts?.groupedEntities ?? []);
  const sourceEntityUpsert = vi.fn(async () => ({}));
  const executeRawUnsafe = vi.fn(async () => 1);

  const prisma = {
    sourceEpisode: { upsert: episodeUpsert },
    participant: { findMany: participantFindMany },
    sourceParticipant: { upsert: sourceParticipantUpsert },
    ideaBlockEntity: { groupBy: ideaBlockEntityGroupBy },
    sourceEntity: { upsert: sourceEntityUpsert },
    $executeRawUnsafe: executeRawUnsafe,
  } as unknown;

  const cfg = {
    bitemporal: { enabled: false, supersedeEnabled: false, factSignalTypes: [] },
    ai: { embeddings: { model: 'text-embedding-3-small' } },
    getDynamic: vi.fn(async (_k: string, _e: unknown, d?: unknown) => d ?? false),
  } as unknown;

  const worker = new BlockIngestWorker(
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
    cfg as never,
    {} as never,
  );

  return {
    worker,
    mocks: {
      episodeUpsert,
      participantFindMany,
      sourceParticipantUpsert,
      ideaBlockEntityGroupBy,
      sourceEntityUpsert,
      executeRawUnsafe,
    },
  };
}

function callPersistSourceLayer(
  worker: BlockIngestWorker,
  args: {
    event: unknown;
    payload: unknown;
    blockIds: string[];
    summaryText: string | null;
    summaryVector: number[] | null;
  },
): Promise<void> {
  return (
    worker as unknown as { persistSourceLayer: (a: unknown) => Promise<void> }
  ).persistSourceLayer(args);
}

const reportEvent = {
  id: 'raw-report-1',
  tenantId: 'tenant-1',
  sourceType: 'meeting_report',
  sourceExternalId: 'report_meeting-9',
  sourceTitle: 'Встреча: Планёрка, 14.06',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

const reportPayload = { kind: 'meeting_report', meetingId: 'meeting-9' };

describe('BlockIngestWorker — слой источника (Ф2)', () => {
  it('SourceEpisode создаётся kind=meeting с title из sourceTitle для meeting_report (upsert, идемпотентно)', async () => {
    const { worker, mocks } = buildWorker();
    await callPersistSourceLayer(worker, {
      event: reportEvent,
      payload: reportPayload,
      blockIds: [],
      summaryText: 'Итоги встречи',
      summaryVector: null,
    });

    expect(mocks.episodeUpsert).toHaveBeenCalledTimes(1);
    const call = mocks.episodeUpsert.mock.calls[0]![0] as {
      where: { rawEventId_tenantId: { rawEventId: string; tenantId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.where.rawEventId_tenantId).toEqual({
      rawEventId: 'raw-report-1',
      tenantId: 'tenant-1',
    });
    expect(call.create.kind).toBe('meeting');
    expect(call.create.title).toBe('Встреча: Планёрка, 14.06');
    expect(call.create.summary).toBe('Итоги встречи');
    expect(call.create.embeddingModelVersion).toBeNull();
  });

  it('embedding пишется через $executeRawUnsafe ::vector когда summaryVector есть; модель = cfg.ai.embeddings.model', async () => {
    const { worker, mocks } = buildWorker();
    await callPersistSourceLayer(worker, {
      event: reportEvent,
      payload: reportPayload,
      blockIds: [],
      summaryText: 'Итоги',
      summaryVector: [0.1, 0.2, 0.3],
    });

    const create = (mocks.episodeUpsert.mock.calls[0]![0] as { create: Record<string, unknown> })
      .create;
    expect(create.embeddingModelVersion).toBe('text-embedding-3-small');

    expect(mocks.executeRawUnsafe).toHaveBeenCalledTimes(1);
    const rawArgs = mocks.executeRawUnsafe.mock.calls[0]!;
    expect(String(rawArgs[0])).toContain('SourceEpisode');
    expect(String(rawArgs[0])).toContain('::vector');
    expect(rawArgs[1]).toBe('[0.1,0.2,0.3]');
    expect(rawArgs[2]).toBe('raw-report-1');
    expect(rawArgs[3]).toBe('tenant-1');
  });

  it('встреча с 3 участниками с personId → ровно 3 upsert SourceParticipant с tenantId+role', async () => {
    const { worker, mocks } = buildWorker({
      participants: [
        { personId: 'p1', role: 'host' },
        { personId: 'p2', role: 'guest' },
        { personId: 'p3', role: 'guest' },
      ],
    });

    await callPersistSourceLayer(worker, {
      event: reportEvent,
      payload: reportPayload,
      blockIds: [],
      summaryText: null,
      summaryVector: null,
    });

    expect(mocks.participantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meetingId: 'meeting-9', personId: { not: null } } }),
    );
    expect(mocks.sourceParticipantUpsert).toHaveBeenCalledTimes(3);
    const first = mocks.sourceParticipantUpsert.mock.calls[0]![0] as {
      where: { rawEventId_personId: { rawEventId: string; personId: string } };
      create: Record<string, unknown>;
    };
    expect(first.where.rawEventId_personId).toEqual({ rawEventId: 'raw-report-1', personId: 'p1' });
    expect(first.create.tenantId).toBe('tenant-1');
    expect(first.create.role).toBe('host');
    const second = mocks.sourceParticipantUpsert.mock.calls[1]![0] as {
      create: Record<string, unknown>;
    };
    expect(second.create.role).toBe('guest');
  });

  it('дубль personId среди участников → upsert вызывается один раз на personId (без дублей)', async () => {
    const { worker, mocks } = buildWorker({
      participants: [
        { personId: 'p1', role: 'host' },
        { personId: 'p1', role: 'guest' },
        { personId: null, role: 'guest' },
      ],
    });

    await callPersistSourceLayer(worker, {
      event: reportEvent,
      payload: reportPayload,
      blockIds: [],
      summaryText: null,
      summaryVector: null,
    });

    expect(mocks.sourceParticipantUpsert).toHaveBeenCalledTimes(1);
  });

  it('SourceEntity.mentionsCount ≥ 1 для упомянутой сущности (из ideaBlockEntity.groupBy)', async () => {
    const { worker, mocks } = buildWorker({
      groupedEntities: [
        { entityId: 'ent-1', _count: { entityId: 3 } },
        { entityId: 'ent-2', _count: { entityId: 1 } },
      ],
    });

    await callPersistSourceLayer(worker, {
      event: reportEvent,
      payload: reportPayload,
      blockIds: ['block-1', 'block-2'],
      summaryText: null,
      summaryVector: null,
    });

    expect(mocks.ideaBlockEntityGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['entityId'],
        where: { blockId: { in: ['block-1', 'block-2'] }, tenantId: 'tenant-1' },
      }),
    );
    expect(mocks.sourceEntityUpsert).toHaveBeenCalledTimes(2);
    const first = mocks.sourceEntityUpsert.mock.calls[0]![0] as {
      where: { rawEventId_entityId: { rawEventId: string; entityId: string } };
      create: Record<string, unknown>;
    };
    expect(first.where.rawEventId_entityId).toEqual({ rawEventId: 'raw-report-1', entityId: 'ent-1' });
    expect(first.create.mentionsCount).toBe(3);
    expect(Number(first.create.mentionsCount)).toBeGreaterThanOrEqual(1);
  });

  it('blockIds пуст → SourceEntity groupBy/upsert не вызывается', async () => {
    const { worker, mocks } = buildWorker({
      groupedEntities: [{ entityId: 'ent-1', _count: { entityId: 2 } }],
    });

    await callPersistSourceLayer(worker, {
      event: reportEvent,
      payload: reportPayload,
      blockIds: [],
      summaryText: null,
      summaryVector: null,
    });

    expect(mocks.ideaBlockEntityGroupBy).not.toHaveBeenCalled();
    expect(mocks.sourceEntityUpsert).not.toHaveBeenCalled();
  });

  it('служебный sourceType (tracker_event) → эпизод НЕ создаётся (return)', async () => {
    const { worker, mocks } = buildWorker();
    const trackerEvent = {
      ...(reportEvent as object),
      sourceType: 'tracker_event',
    } as never;

    await callPersistSourceLayer(worker, {
      event: trackerEvent,
      payload: {},
      blockIds: ['block-1'],
      summaryText: null,
      summaryVector: null,
    });

    expect(mocks.episodeUpsert).not.toHaveBeenCalled();
    expect(mocks.sourceParticipantUpsert).not.toHaveBeenCalled();
    expect(mocks.sourceEntityUpsert).not.toHaveBeenCalled();
  });

  it('документ (external) → kind=document, без участников встречи', async () => {
    const { worker, mocks } = buildWorker({
      participants: [{ personId: 'p1', role: 'host' }],
    });
    const docEvent = {
      id: 'raw-doc-1',
      tenantId: 'tenant-1',
      sourceType: 'external',
      sourceExternalId: 'doc-7',
      sourceTitle: 'Логистика 2026.pdf',
      occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      dataClass: 'internal',
    } as never;

    await callPersistSourceLayer(worker, {
      event: docEvent,
      payload: {},
      blockIds: [],
      summaryText: null,
      summaryVector: null,
    });

    const create = (mocks.episodeUpsert.mock.calls[0]![0] as { create: Record<string, unknown> })
      .create;
    expect(create.kind).toBe('document');
    expect(mocks.participantFindMany).not.toHaveBeenCalled();
    expect(mocks.sourceParticipantUpsert).not.toHaveBeenCalled();
  });

  it('чат с автором (responsible.personId) → SourceParticipant role=author', async () => {
    const { worker, mocks } = buildWorker();
    const chatEvent = {
      id: 'raw-chat-1',
      tenantId: 'tenant-1',
      sourceType: 'chat',
      sourceExternalId: 'thread-3',
      sourceTitle: 'Чат с клиентом',
      occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      dataClass: 'internal',
    } as never;

    await callPersistSourceLayer(worker, {
      event: chatEvent,
      payload: { responsible: { personId: 'pers-author' } },
      blockIds: [],
      summaryText: null,
      summaryVector: null,
    });

    const create = (mocks.episodeUpsert.mock.calls[0]![0] as { create: Record<string, unknown> })
      .create;
    expect(create.kind).toBe('chat');
    expect(mocks.sourceParticipantUpsert).toHaveBeenCalledTimes(1);
    const call = mocks.sourceParticipantUpsert.mock.calls[0]![0] as {
      where: { rawEventId_personId: { personId: string } };
      create: Record<string, unknown>;
    };
    expect(call.where.rawEventId_personId.personId).toBe('pers-author');
    expect(call.create.role).toBe('author');
  });
});

describe('apply-prod-deploy STEPS — регистрация backfill-source-layer', () => {
  it('backfill-source-layer.ts зарегистрирован в STEPS', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const path = join(__dirname, '..', '..', '..', '..', 'scripts', 'apply-prod-deploy.ts');
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('scripts/backfill-source-layer.ts');
  });
});
