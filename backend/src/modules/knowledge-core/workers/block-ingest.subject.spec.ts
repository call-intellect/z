import { describe, expect, it, vi } from 'vitest';

import type { ExtractedBlock } from '../services/block-extraction.service';
import type { Segment } from '../services/segment-builder.service';

import { BlockIngestWorker } from './block-ingest.worker';

/**
 * Фаза 1.2 (meeting-identity & clones-attribution) — юнит-тесты для
 * детерминированной атрибуции автора блока-рассуждения как
 * `IdeaBlockEntity.role='subject'` (без LLM, prompt-cache сохранён).
 *
 * Тест дёргает приватный `persistBlock` через any-cast — он внутри сам
 * вызывает `attributeSubject` для блоков из reasoning-семейства. Все
 * зависимости замоканы: `entities.resolveSubjectEntityId`,
 * `prisma.ideaBlockEntity.upsert`, `cfg.getDynamic`.
 */

interface Mocks {
  resolveSubjectEntityId: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
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

function buildWorker(opts: {
  subjectEntityId: string | null;
  killSwitch: boolean;
}): { worker: BlockIngestWorker; mocks: Mocks } {
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

  const worker = new BlockIngestWorker(
    {} as never, // redis
    prisma as never, // prisma
    {} as never, // s3
    {} as never, // segments
    {} as never, // extractor
    {} as never, // embeddings
    entities as never, // entities
    {} as never, // coreQueue
    {} as never, // gate
    {} as never, // graph
    {} as never, // metrics
    {} as never, // axisClassifier
    cfg as never, // cfg
  );
  return { worker, mocks: { resolveSubjectEntityId, upsert, getDynamic } };
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

    await (worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }).persistBlock({
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
          blockId_entityId: expect.objectContaining({ entityId: 'e1' }),
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

    await (worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }).persistBlock({
      event: textEvent,
      block: buildBlock({ evidenceStartMs: 0, evidenceEndMs: 0 }),
      embedding: null,
      roleRelevant: false,
      roleId: null,
      // Для text endMs=0 → ни один сегмент не покрывает; identity по authorUserId.
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
          blockId_entityId: expect.objectContaining({ entityId: 'e2' }),
        }),
      }),
    );
  });

  it('(c) kill-switch false → upsert НЕ вызван', async () => {
    const { worker, mocks } = buildWorker({
      subjectEntityId: 'e1',
      killSwitch: false,
    });

    await (worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }).persistBlock({
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

    await (worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }).persistBlock({
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

    await (worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }).persistBlock({
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
});
