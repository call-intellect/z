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
    {} as any, // router
    {} as any, // axisClassifier
    cfg,
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
