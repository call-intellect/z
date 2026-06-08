import { describe, expect, it, vi } from 'vitest';

import type { ExtractedBlock } from '../services/block-extraction.service';

import { BlockIngestWorker } from './block-ingest.worker';

/**
 * KC-Temporal W1.1 / W1.4 (2026-05-25) — юнит-тесты для:
 *   1. Проставления `validFrom = event.occurredAt` при
 *      `cfg.bitemporal.enabled = true`.
 *   2. Игнорирования `validFrom` при `cfg.bitemporal.enabled = false` (legacy).
 *   3. Маппинга `mentionedEntities[*].sourceSpan` в `propertySpans`.
 *
 * Тест дёргает `persistBlock` напрямую через рефлексию (private), чтобы
 * не поднимать всю pipeline ingest'а. BlockIngestWorker конструируется
 * с замоканными зависимостями (PrismaService.$transaction подсовывает
 * fake-tx, который возвращает заранее заготовленные записи).
 */

interface InsertedIdeaBlock {
  id: string;
  data: Record<string, unknown>;
}

interface InsertedEvidence {
  id: string;
  data: Record<string, unknown>;
}

function buildFakeTx(): {
  tx: any;
  inserted: { block: InsertedIdeaBlock | null; evidence: InsertedEvidence | null; updates: Array<{ where: any; data: any }> };
} {
  let blockSeq = 0;
  let evSeq = 0;
  const state: {
    block: InsertedIdeaBlock | null;
    evidence: InsertedEvidence | null;
    updates: Array<{ where: any; data: any }>;
  } = { block: null, evidence: null, updates: [] };
  const tx = {
    ideaBlock: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        blockSeq += 1;
        const id = `block-${blockSeq}`;
        state.block = { id, data: args.data };
        return { id, ...args.data };
      }),
      update: vi.fn(async (args: { where: any; data: any }) => {
        state.updates.push(args);
        return { id: args.where.id, ...args.data };
      }),
    },
    ideaBlockEvidence: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        evSeq += 1;
        const id = `ev-${evSeq}`;
        state.evidence = { id, data: args.data };
        return { id, ...args.data };
      }),
    },
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  return { tx, inserted: state };
}

function buildWorker(cfgEnabled: boolean) {
  const fakeTx = buildFakeTx();
  const prisma = {
    $transaction: vi.fn(async (fn: any) => fn(fakeTx.tx)),
  } as any;
  const cfg = {
    bitemporal: { enabled: cfgEnabled, supersedeEnabled: false, factSignalTypes: [] },
  } as any;
  // Минимум DI — остальные сервисы не дёргаются в persistBlock.
  const worker = new BlockIngestWorker(
    {} as any, // redis
    prisma, // prisma
    {} as any, // s3
    {} as any, // segments
    {} as any, // extractor
    {} as any, // embeddings
    {} as any, // entities (linkEntity вызывается ВНЕ persistBlock — после)
    {} as any, // coreQueue
    {} as any, // gate
    {} as any, // graph
    {} as any, // metrics
    // Ф3 МТЗ — RouterService больше НЕ инжектится в BlockIngestWorker
    // (диспатч специалистов перенесён в block-distill на canonical-переход).
    {} as any, // axisClassifier
    cfg,
    {} as any, // blockAccessDeriver (Ф3 — не дёргается в persistBlock)
  );
  return { worker, fakeTx };
}

function buildBlock(overrides: Partial<ExtractedBlock> = {}): ExtractedBlock {
  return {
    name: 'Тестовый блок',
    criticalQuestion: 'Что?',
    trustedAnswer: 'Ответ',
    signalType: 'fact',
    tags: [],
    confidence: 0.9,
    evidenceQuote: 'цитата',
    evidenceStartMs: 0,
    evidenceEndMs: 1000,
    mentionedEntities: [],
    role_relevant: false,
    ...overrides,
  };
}

/**
 * Фикс cross-attribution chatbox — субъект атрибутируется ПО ГОВОРЯЩЕМУ
 * сегмента (per-message), а не session-level менеджером:
 *   - tryGetActorIdentity: chatbox с transcript.turns (authorPersonId) НЕ
 *     отдаёт session-level authorPersonId; legacy chatbox (без turns) — отдаёт.
 *   - attributeSubject: блок в client-сегменте (authorPersonId=null) → subject
 *     НЕ пишется; блок в manager-сегменте → resolveSubjectEntityId(personId
 *     менеджера); meeting-сегмент (без authorPersonId) → прежний путь
 *     (speakerParticipantId).
 */
function buildAttributionWorker() {
  const resolveSubjectEntityId = vi.fn(async () => 'ent-1');
  const upsert = vi.fn(async () => ({}));
  const incSubjectAttribution = vi.fn();
  const getDynamic = vi.fn(async () => true);
  const prisma = {
    ideaBlockEntity: { upsert },
  } as any;
  const entities = { resolveSubjectEntityId } as any;
  const metrics = { incSubjectAttribution } as any;
  const cfg = { getDynamic } as any;
  const worker = new BlockIngestWorker(
    {} as any, // redis
    prisma, // prisma
    {} as any, // s3
    {} as any, // segments
    {} as any, // extractor
    {} as any, // embeddings
    entities, // entities
    {} as any, // coreQueue
    {} as any, // gate
    {} as any, // graph
    metrics, // metrics
    {} as any, // axisClassifier
    cfg, // cfg
    {} as any, // blockAccessDeriver
  );
  return { worker, resolveSubjectEntityId, upsert, incSubjectAttribution };
}

describe('BlockIngestWorker.tryGetActorIdentity — chatbox per-message vs legacy', () => {
  it('chatbox С transcript.turns (authorPersonId) → НЕ отдаёт session-level authorPersonId', () => {
    const { worker } = buildAttributionWorker();
    const payload = {
      kind: 'chatbox_chat_session',
      responsible: { personId: 'p-manager' },
      transcript: {
        turns: [
          { speaker: 'Клиент', text: 'q', startSec: 0, endSec: 0.9, authorPersonId: null },
          { speaker: 'Менеджер', text: 'a', startSec: 1, endSec: 1.9, authorPersonId: 'p-manager' },
        ],
      },
    };
    const identity = (worker as any).tryGetActorIdentity(payload);
    expect(identity.authorPersonId).toBeNull();
  });

  it('chatbox БЕЗ turns (legacy) → отдаёт responsible.personId (back-compat)', () => {
    const { worker } = buildAttributionWorker();
    const payload = {
      kind: 'chatbox_chat_session',
      responsible: { personId: 'p-manager' },
    };
    const identity = (worker as any).tryGetActorIdentity(payload);
    expect(identity.authorPersonId).toBe('p-manager');
  });
});

describe('BlockIngestWorker.attributeSubject — атрибуция по говорящему сегмента', () => {
  const tenantEvent = {
    id: 'raw-1',
    tenantId: 'tenant-1',
    sourceType: 'chatbox',
    occurredAt: new Date('2026-06-04T12:00:00.000Z'),
    dataClass: 'sensitive',
  } as any;

  it('блок в client-сегменте (authorPersonId=null) → subject НЕ пишется', async () => {
    const { worker, resolveSubjectEntityId, upsert } = buildAttributionWorker();
    // chatbox per-message сегменты: первый — клиентский (author=null).
    const segments = [
      { startMs: 0, endMs: 900, speakers: ['Клиент'], text: 'q', speakerParticipantId: null, authorPersonId: null },
      { startMs: 1000, endMs: 1900, speakers: ['Менеджер'], text: 'a', speakerParticipantId: null, authorPersonId: 'p-manager' },
    ];
    await (worker as any).attributeSubject({
      event: tenantEvent,
      block: buildBlock({ signalType: 'reasoning', evidenceStartMs: 0, evidenceEndMs: 0 }),
      blockId: 'block-1',
      segments,
      authorUserId: null,
      authorPersonId: null,
      authorEmail: null,
    });
    expect(resolveSubjectEntityId).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('блок в manager-сегменте → resolveSubjectEntityId(authorPersonId=менеджер); subject пишется', async () => {
    const { worker, resolveSubjectEntityId, upsert } = buildAttributionWorker();
    const segments = [
      { startMs: 0, endMs: 900, speakers: ['Клиент'], text: 'q', speakerParticipantId: null, authorPersonId: null },
      { startMs: 1000, endMs: 1900, speakers: ['Менеджер'], text: 'a', speakerParticipantId: null, authorPersonId: 'p-manager' },
    ];
    await (worker as any).attributeSubject({
      event: tenantEvent,
      block: buildBlock({ signalType: 'expertise', evidenceStartMs: 1000, evidenceEndMs: 1000 }),
      blockId: 'block-2',
      segments,
      authorUserId: null,
      authorPersonId: null,
      authorEmail: null,
    });
    expect(resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        authorPersonId: 'p-manager',
        speakerParticipantId: null,
        speakerName: null,
        authorUserId: null,
        authorEmail: null,
      }),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: meeting-сегмент (без authorPersonId, со speakerParticipantId) → прежний путь', async () => {
    const { worker, resolveSubjectEntityId } = buildAttributionWorker();
    // meeting-сегмент: поле authorPersonId ОТСУТСТВУЕТ.
    const segments = [
      { startMs: 0, endMs: 5000, speakers: ['Алиса'], text: 'рассуждение', speakerParticipantId: 'pt-1' },
    ];
    await (worker as any).attributeSubject({
      event: { ...tenantEvent, sourceType: 'meeting' },
      block: buildBlock({ signalType: 'reasoning', evidenceStartMs: 1200, evidenceEndMs: 1200 }),
      blockId: 'block-3',
      segments,
      authorUserId: null,
      authorPersonId: null,
      authorEmail: null,
    });
    expect(resolveSubjectEntityId).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        speakerParticipantId: 'pt-1',
        speakerName: 'Алиса',
        authorPersonId: null,
      }),
    );
  });
});

describe('BlockIngestWorker — KC-Temporal W1.1 validFrom', () => {
  it('проставляет validFrom = event.occurredAt при cfg.bitemporal.enabled=true', async () => {
    const { worker, fakeTx } = buildWorker(true);
    const occurredAt = new Date('2026-04-01T10:00:00.000Z');
    const event = {
      id: 'raw-1',
      tenantId: 'tenant-1',
      sourceType: 'meeting',
      occurredAt,
      dataClass: 'internal',
    } as any;

    // persistBlock — private; обращаемся через any-cast.
    const result = await (worker as any).persistBlock({
      event,
      block: buildBlock(),
      embedding: null,
      roleRelevant: false,
      roleId: null,
    });
    expect(result).toBe('block-1');

    const data = fakeTx.inserted.block?.data;
    expect(data).toBeDefined();
    expect(data?.['validFrom']).toEqual(occurredAt);
  });

  it('НЕ проставляет validFrom при cfg.bitemporal.enabled=false (legacy)', async () => {
    const { worker, fakeTx } = buildWorker(false);
    const occurredAt = new Date('2026-04-01T10:00:00.000Z');
    const event = {
      id: 'raw-2',
      tenantId: 'tenant-1',
      sourceType: 'meeting',
      occurredAt,
      dataClass: 'internal',
    } as any;

    await (worker as any).persistBlock({
      event,
      block: buildBlock(),
      embedding: null,
      roleRelevant: false,
      roleId: null,
    });

    const data = fakeTx.inserted.block?.data;
    expect(data).toBeDefined();
    // При выключенном флаге поле validFrom вообще не передаётся в create.
    expect(Object.prototype.hasOwnProperty.call(data ?? {}, 'validFrom')).toBe(false);
  });
});

describe('BlockIngestWorker — KC-Temporal W1.4 propertySpans', () => {
  it('маппит mentionedEntities[*].sourceSpan в propertySpans', async () => {
    const { worker, fakeTx } = buildWorker(false);
    const event = {
      id: 'raw-3',
      tenantId: 'tenant-1',
      sourceType: 'meeting',
      occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      dataClass: 'internal',
    } as any;

    const block = buildBlock({
      mentionedEntities: [
        {
          type: 'person',
          name: 'Маша',
          mentionContext: 'упомянута Маша',
          sourceSpan: { startMs: 1500, endMs: 1800 },
        },
        {
          // Без sourceSpan — должна быть пропущена.
          type: 'vendor',
          name: 'Z',
          mentionContext: 'компания Z',
        },
      ],
    });

    await (worker as any).persistBlock({
      event,
      block,
      embedding: null,
      roleRelevant: false,
      roleId: null,
    });

    // propertySpans пишется ОТДЕЛЬНЫМ update'ом после insert'а evidence,
    // потому что требует evidenceId.
    expect(fakeTx.inserted.updates.length).toBe(1);
    const update = fakeTx.inserted.updates[0];
    const spans = update?.data?.propertySpans as Array<Record<string, unknown>>;
    expect(Array.isArray(spans)).toBe(true);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      field: 'mentionedEntity',
      evidenceId: 'ev-1',
      startMs: 1500,
      endMs: 1800,
    });
  });

  it('если ни у одной mention нет sourceSpan — НЕ делает update propertySpans', async () => {
    const { worker, fakeTx } = buildWorker(false);
    const event = {
      id: 'raw-4',
      tenantId: 'tenant-1',
      sourceType: 'meeting',
      occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      dataClass: 'internal',
    } as any;

    const block = buildBlock({
      mentionedEntities: [
        {
          type: 'person',
          name: 'Маша',
          mentionContext: 'без span',
        },
      ],
    });

    await (worker as any).persistBlock({
      event,
      block,
      embedding: null,
      roleRelevant: false,
      roleId: null,
    });

    expect(fakeTx.inserted.updates.length).toBe(0);
  });
});
