import { describe, expect, it, vi } from 'vitest';

import type { ExtractedBlock } from '../services/block-extraction.service';
import type { Segment } from '../services/segment-builder.service';

import { BlockIngestWorker } from './block-ingest.worker';

interface Mocks {
  resolveSubjectEntityId: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
  incSubjectAttribution: ReturnType<typeof vi.fn>;
}

function buildFakeTx() {
  let blockSeq = 0;
  let evSeq = 0;
  return {
    ideaBlock: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        blockSeq += 1;
        return { id: `block-${blockSeq}`, ...a.data };
      }),
      update: vi.fn(async (a: { where: { id: string }; data: unknown }) => ({
        id: a.where.id,
      })),
    },
    ideaBlockEvidence: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        evSeq += 1;
        return { id: `ev-${evSeq}`, ...a.data };
      }),
    },
    $executeRawUnsafe: vi.fn(async () => 1),
  };
}

function buildWorker(opts: { subjectEntityId: string | null; killSwitch: boolean }): {
  worker: BlockIngestWorker;
  mocks: Mocks;
} {
  const fakeTx = buildFakeTx();
  const upsert = vi.fn(async () => ({}));
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(fakeTx)),
    ideaBlockEntity: { upsert },
  } as unknown;

  const resolveSubjectEntityId = vi.fn(async () => opts.subjectEntityId);
  const entities = { resolveSubjectEntityId } as unknown;

  const getDynamic = vi.fn(async () => opts.killSwitch);
  const cfg = {
    bitemporal: { enabled: false, supersedeEnabled: false, factSignalTypes: [] },
    getDynamic,
  } as unknown;

  const incSubjectAttribution = vi.fn();
  const metrics = { incSubjectAttribution } as unknown;

  const worker = new BlockIngestWorker(
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    entities as never,
    {} as never,
    {} as never,
    {} as never,
    metrics as never,
    {} as never,
    cfg as never,
    {} as never,
  );
  return {
    worker,
    mocks: { resolveSubjectEntityId, upsert, getDynamic, incSubjectAttribution },
  };
}

function buildBlock(overrides: Partial<ExtractedBlock> = {}): ExtractedBlock {
  return {
    name: 'Рассуждение',
    criticalQuestion: 'Почему так?',
    trustedAnswer: 'Потому что...',
    signalType: 'reasoning',
    tags: [],
    confidence: 0.9,
    evidenceQuote: 'цитата',
    evidenceStartMs: 1500,
    evidenceEndMs: 2000,
    mentionedEntities: [],
    role_relevant: false,
    ...overrides,
  };
}

const meetingEvent = {
  id: 'raw-1',
  tenantId: 'tenant-1',
  sourceType: 'meeting',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

const textEvent = {
  id: 'raw-2',
  tenantId: 'tenant-1',
  sourceType: 'free_note',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

describe('BlockIngestWorker — Фаза 1.2 атрибуция role=subject', () => {
  it('(a) meeting reasoning: сегмент со speakerParticipantId покрывает evidence → upsert role=subject (e1)', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: 'e1',
      killSwitch: true,
    });
    const segments: Segment[] = [
      {
        startMs: 1000,
        endMs: 3000,
        speakers: ['Иван'],
        text: 'Иван: ...',
        speakerParticipantId: 'p1',
      },
    ];

    await (
      worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
    ).persistBlock({
      event: meetingEvent,
      block: buildBlock({ evidenceStartMs: 1500 }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments,
      authorUserId: null,
    });

    expect(mocks.resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ speakerParticipantId: 'p1', speakerName: 'Иван' }),
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          blockId_entityId_tenantId: expect.objectContaining({ entityId: 'e1' }),
        }),
        create: expect.objectContaining({ role: 'subject', mentionContext: 'author' }),
        update: expect.objectContaining({ role: 'subject' }),
      }),
    );
  });

  it('(b) text free_note: authorUserId=u1 → resolveSubjectEntityId → e2 → upsert', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: 'e2',
      killSwitch: true,
    });

    await (
      worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
    ).persistBlock({
      event: textEvent,
      block: buildBlock({ evidenceStartMs: 0, evidenceEndMs: 0 }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments: [{ startMs: 0, endMs: 0, speakers: [], text: 'заметка' }],
      authorUserId: 'u1',
    });

    expect(mocks.resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        authorUserId: 'u1',
        speakerParticipantId: null,
        speakerName: null,
      }),
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          blockId_entityId_tenantId: expect.objectContaining({ entityId: 'e2' }),
        }),
      }),
    );
  });

  it('(c) kill-switch false → upsert НЕ вызван', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: 'e1',
      killSwitch: false,
    });

    await (
      worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
    ).persistBlock({
      event: meetingEvent,
      block: buildBlock(),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments: [
        { startMs: 1000, endMs: 3000, speakers: ['Иван'], text: 'x', speakerParticipantId: 'p1' },
      ],
      authorUserId: null,
    });

    expect(mocks.getDynamic).toHaveBeenCalled();
    expect(mocks.resolveSubjectEntityId).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('(d) signalType=fact (не reasoning-семейство) → attributeSubject не зовётся, upsert НЕ вызван', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: 'e1',
      killSwitch: true,
    });

    await (
      worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
    ).persistBlock({
      event: meetingEvent,
      block: buildBlock({ signalType: 'fact' }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments: [
        { startMs: 1000, endMs: 3000, speakers: ['Иван'], text: 'x', speakerParticipantId: 'p1' },
      ],
      authorUserId: null,
    });

    expect(mocks.getDynamic).not.toHaveBeenCalled();
    expect(mocks.resolveSubjectEntityId).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('(e) resolveSubjectEntityId → null → upsert НЕ вызван', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: null,
      killSwitch: true,
    });

    await (
      worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
    ).persistBlock({
      event: meetingEvent,
      block: buildBlock(),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments: [
        { startMs: 1000, endMs: 3000, speakers: ['Иван'], text: 'x', speakerParticipantId: 'p1' },
      ],
      authorUserId: null,
    });

    expect(mocks.resolveSubjectEntityId).toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('(f) signalType=fact + subjectAllTypes=true + meeting-сегмент → resolve + upsert role=subject (Ф1)', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: 'e3',
      killSwitch: true,
    });
    const segments: Segment[] = [
      {
        startMs: 1000,
        endMs: 3000,
        speakers: ['Иван'],
        text: 'Иван: ...',
        speakerParticipantId: 'p1',
      },
    ];

    await (
      worker as unknown as {
        persistBlock: (a: unknown) => Promise<string | null>;
      }
    ).persistBlock({
      event: meetingEvent,
      block: buildBlock({ signalType: 'fact', evidenceStartMs: 1500 }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments,
      authorUserId: null,
      subjectAllTypes: true,
    });

    expect(mocks.resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ speakerParticipantId: 'p1', speakerName: 'Иван' }),
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          blockId_entityId_tenantId: expect.objectContaining({ entityId: 'e3' }),
        }),
        create: expect.objectContaining({ role: 'subject' }),
        update: expect.objectContaining({ role: 'subject' }),
      }),
    );
    expect(mocks.incSubjectAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'participant' }),
    );
  });

  it('(g) signalType=fact + authorPersonId + subjectAllTypes=true (dump) → resolve вызван с authorPersonId (Ф1)', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: 'e4',
      killSwitch: true,
    });

    await (
      worker as unknown as {
        persistBlock: (a: unknown) => Promise<string | null>;
      }
    ).persistBlock({
      event: textEvent,
      block: buildBlock({ signalType: 'fact', evidenceStartMs: 0, evidenceEndMs: 0 }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments: [{ startMs: 0, endMs: 0, speakers: [], text: 'дамп' }],
      authorUserId: null,
      authorPersonId: 'pers-1',
      subjectAllTypes: true,
    });

    expect(mocks.resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ authorPersonId: 'pers-1' }),
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          blockId_entityId_tenantId: expect.objectContaining({ entityId: 'e4' }),
        }),
      }),
    );
    expect(mocks.incSubjectAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'personId' }),
    );
  });

  it('(h) text без таймкодов, event-автор пуст, один автор сегментов → resolve через него, via=author_fallback', async () => {
    const { worker, mocks } = buildWorker({ subjectEntityId: 'e7', killSwitch: true });

    await (
      worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
    ).persistBlock({
      event: textEvent,
      block: buildBlock({ evidenceStartMs: 0, evidenceEndMs: 0 }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments: [
        { startMs: 0, endMs: 0, speakers: [], text: 'm1', authorPersonId: 'pers-7' },
        { startMs: 0, endMs: 0, speakers: [], text: 'm2', authorPersonId: 'pers-7' },
      ],
      authorUserId: null,
    });

    expect(mocks.resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ authorPersonId: 'pers-7' }),
    );
    expect(mocks.incSubjectAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'author_fallback' }),
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          blockId_entityId_tenantId: expect.objectContaining({ entityId: 'e7' }),
        }),
      }),
    );
  });

  it('(i) два разных автора сегментов → fallback НЕ применяется, resolve с authorPersonId=null, via=none', async () => {
    const { worker, mocks } = buildWorker({ subjectEntityId: null, killSwitch: true });

    await (
      worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
    ).persistBlock({
      event: textEvent,
      block: buildBlock({ evidenceStartMs: 0, evidenceEndMs: 0 }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      segments: [
        { startMs: 0, endMs: 0, speakers: [], text: 'm1', authorPersonId: 'pers-7' },
        { startMs: 0, endMs: 0, speakers: [], text: 'm2', authorPersonId: 'pers-9' },
      ],
      authorUserId: null,
    });

    expect(mocks.resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ authorPersonId: null }),
    );
    expect(mocks.incSubjectAttribution).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'none' }),
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

interface CommitmentMocks {
  ideaBlockUpdate: ReturnType<typeof vi.fn>;
  resolveSubjectPersonId: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
}

function buildCommitmentWorker(opts: { resolvedPersonId: string | null; enabled?: boolean }): {
  worker: BlockIngestWorker;
  mocks: CommitmentMocks;
} {
  const ideaBlockUpdate = vi.fn(async () => ({}));
  const prisma = { ideaBlock: { update: ideaBlockUpdate } } as unknown;

  const resolveSubjectPersonId = vi.fn(async () => opts.resolvedPersonId);
  const entities = { resolveSubjectPersonId } as unknown;

  const getDynamic = vi.fn(async () => opts.enabled ?? true);
  const cfg = { getDynamic } as unknown;

  const worker = new BlockIngestWorker(
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    entities as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    cfg as never,
    {} as never,
  );
  return { worker, mocks: { ideaBlockUpdate, resolveSubjectPersonId, getDynamic } };
}

function attributeCommitment(
  worker: BlockIngestWorker,
  args: {
    event: unknown;
    block: ExtractedBlock;
    blockId: string;
    segments: Segment[];
    authorUserId: string | null;
    authorEmail?: string | null;
  },
): Promise<void> {
  return (
    worker as unknown as { attributeCommitmentAuthor: (a: unknown) => Promise<void> }
  ).attributeCommitmentAuthor(args);
}

const chatEvent = {
  id: 'raw-3',
  tenantId: 'tenant-1',
  sourceType: 'chat',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

const commitmentSegment: Segment = {
  startMs: 1000,
  endMs: 3000,
  speakers: [],
  text: 'обещаю сделать',
};

describe('BlockIngestWorker — P1.5 переатрибуция автора обещания', () => {
  it('(neg) meeting + сегмент без говорящего → автора не проставляем, resolve/update не зовём', async () => {
    const { worker, mocks } = buildCommitmentWorker({ resolvedPersonId: 'p-uploader' });

    await attributeCommitment(worker, {
      event: meetingEvent,
      block: buildBlock({ evidenceStartMs: 1500 }),
      blockId: 'blk-meeting-1',
      segments: [commitmentSegment],
      authorUserId: 'u-uploader',
      authorEmail: 'uploader@example.com',
    });

    expect(mocks.resolveSubjectPersonId).not.toHaveBeenCalled();
    expect(mocks.ideaBlockUpdate).not.toHaveBeenCalled();
  });

  it('(pos) chat + сегмент без говорящего, authorUserId задан → атрибуция по автору сообщения', async () => {
    const { worker, mocks } = buildCommitmentWorker({ resolvedPersonId: 'p-chat-author' });

    await attributeCommitment(worker, {
      event: chatEvent,
      block: buildBlock({ evidenceStartMs: 1500 }),
      blockId: 'blk-chat-1',
      segments: [commitmentSegment],
      authorUserId: 'u-chat-author',
      authorEmail: 'chat@example.com',
    });

    expect(mocks.resolveSubjectPersonId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ authorUserId: 'u-chat-author', speakerParticipantId: null, speakerName: null }),
    );
    expect(mocks.ideaBlockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ commitmentAuthorPersonId: 'p-chat-author' }),
      }),
    );
  });
});
