import { describe, expect, it, vi } from 'vitest';

import type { ExtractedBlock } from '../services/block-extraction.service';
import type { Segment } from '../services/segment-builder.service';

import { BlockIngestWorker } from './block-ingest.worker';

function buildFakeTx() {
  const create = vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'block-1', ...a.data }));
  const evidenceCreate = vi.fn(async (a: { data: Record<string, unknown> }) => ({
    id: 'ev-1',
    ...a.data,
  }));
  const tx = {
    ideaBlock: {
      create,
      update: vi.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
    },
    ideaBlockEvidence: { create: evidenceCreate },
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  return { tx, create, evidenceCreate };
}

function buildWorker() {
  const { tx, create, evidenceCreate } = buildFakeTx();
  const prisma = {
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    ideaBlockEntity: { upsert: vi.fn(async () => ({})) },
  } as unknown;
  const getDynamic = vi.fn(async (key: string, _env?: unknown, def?: unknown) =>
    key === 'knowledge.reportBlockConfidenceCap' ? 0.6 : (def ?? false),
  );
  const cfg = {
    bitemporal: { enabled: false, supersedeEnabled: false, factSignalTypes: [] },
    getDynamic,
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
    { incSubjectAttribution: vi.fn(), incBlockWithoutEvidence: vi.fn() } as never,
    {} as never,
    cfg as never,
    {} as never,
  );
  return { worker, create, evidenceCreate };
}

function buildSummaryBlock(): ExtractedBlock {
  return {
    name: 'Суть встречи: Планёрка',
    criticalQuestion: 'О чём была встреча и что главное?',
    trustedAnswer: 'Обсудили бюджет и решили нанять подрядчика.',
    signalType: 'fact',
    tags: [],
    confidence: 0.9,
    evidenceQuote: 'Обсудили бюджет и решили нанять подрядчика.',
    evidenceStartMs: 0,
    evidenceEndMs: 0,
    mentionedEntities: [],
    role_relevant: false,
  };
}

const reportEvent = {
  id: 'raw-report',
  tenantId: 'tenant-1',
  sourceType: 'meeting_report',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

const segments: Segment[] = [];

async function callPersist(
  worker: BlockIngestWorker,
  block: ExtractedBlock,
  isMeetingSummary: boolean,
): Promise<string | null> {
  return (
    worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
  ).persistBlock({
    event: reportEvent,
    block,
    embedding: null,
    roleRelevant: false,
    roleId: null,
    segments,
    authorUserId: null,
    isMeetingSummary,
  });
}

describe('BlockIngestWorker — Ф4 «суть встречи» retrievable-узел', () => {
  it('summary-блок отчёта: confidence НЕ придушён до 0.6, без штрафа dynamicScore, evidence.rawEventId есть', async () => {
    const { worker, create, evidenceCreate } = buildWorker();
    await callPersist(worker, buildSummaryBlock(), true);

    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.confidence)).toBe('0.9');
    expect(data.primarySource).toBe('report');
    expect('dynamicScore' in data).toBe(false);
    const ev = evidenceCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(ev.rawEventId).toBe('raw-report');
    expect(String(ev.quote).length).toBeGreaterThan(0);
  });

  it('обычный отчётный блок (НЕ summary): cap 0.6 и dynamicScore 0.7 сохраняются', async () => {
    const { worker, create } = buildWorker();
    await callPersist(worker, { ...buildSummaryBlock(), confidence: 0.92 }, false);

    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.confidence)).toBe('0.6');
    expect(String(data.dynamicScore)).toBe('0.7');
  });

  it('tryGetReportSummaryMarkdown: достаёт summary только для meeting_report', () => {
    const { worker } = buildWorker();
    const fn = (worker as unknown as { tryGetReportSummaryMarkdown: (p: unknown) => string | null })
      .tryGetReportSummaryMarkdown;
    expect(fn.call(worker, { kind: 'meeting_report', reportSummaryMarkdown: 'Итоги' })).toBe('Итоги');
    expect(fn.call(worker, { kind: 'meeting_report', reportSummaryMarkdown: '   ' })).toBeNull();
    expect(fn.call(worker, { kind: 'other', reportSummaryMarkdown: 'x' })).toBeNull();
    expect(fn.call(worker, null)).toBeNull();
  });

  it('tryGetDocumentSummary: достаёт documentSummary из payload документа', () => {
    const { worker } = buildWorker();
    const fn = (worker as unknown as { tryGetDocumentSummary: (p: unknown) => string | null })
      .tryGetDocumentSummary;
    expect(fn.call(worker, { documentSummary: 'Резюме документа' })).toBe('Резюме документа');
    expect(fn.call(worker, { documentSummary: '   ' })).toBeNull();
    expect(fn.call(worker, { documentSummary: 42 })).toBeNull();
    expect(fn.call(worker, null)).toBeNull();
  });

  it('resolveSourceSummaryText: meeting→reportSummaryMarkdown, document→documentSummary, chat→null', () => {
    const { worker } = buildWorker();
    const fn = (
      worker as unknown as {
        resolveSourceSummaryText: (
          kind: 'meeting' | 'document' | 'chat',
          p: unknown,
        ) => string | null;
      }
    ).resolveSourceSummaryText;
    expect(
      fn.call(worker, 'meeting', { kind: 'meeting_report', reportSummaryMarkdown: 'M' }),
    ).toBe('M');
    expect(fn.call(worker, 'document', { documentSummary: 'D' })).toBe('D');
    expect(fn.call(worker, 'chat', { documentSummary: 'D' })).toBeNull();
  });
});

describe('BlockIngestWorker — Ф8 summary-узел для документа (снят гейт meeting_report)', () => {
  function buildDocWorker() {
    const { tx, create } = buildFakeTx();
    const prisma = {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      ideaBlockEntity: { upsert: vi.fn(async () => ({})) },
    } as unknown;
    const embedBlocks = vi.fn(async () => [[0.1, 0.2, 0.3]]);
    const embeddings = { embedBlocks } as unknown;
    const getDynamic = vi.fn(async (key: string, _e?: unknown, def?: unknown) =>
      key === 'knowledge.reportBlockConfidenceCap' ? 0.6 : (def ?? false),
    );
    const cfg = {
      bitemporal: { enabled: false, supersedeEnabled: false, factSignalTypes: [] },
      getDynamic,
    } as unknown;
    const worker = new BlockIngestWorker(
      {} as never,
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      embeddings as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { incSubjectAttribution: vi.fn(), incBlockWithoutEvidence: vi.fn() } as never,
      {} as never,
      cfg as never,
      {} as never,
    );
    return { worker, create, embedBlocks };
  }

  const docEvent = {
    id: 'raw-doc',
    tenantId: 'tenant-1',
    sourceType: 'external',
    sourceTitle: 'План логистики 2026',
    occurredAt: new Date('2026-04-01T10:00:00.000Z'),
    dataClass: 'internal',
  } as never;

  it('document + documentSummary непустой → строит summary-блок «Суть документа», вектор есть', async () => {
    const { worker, create, embedBlocks } = buildDocWorker();
    const res = await (
      worker as unknown as {
        maybePersistSourceSummary: (a: unknown) => Promise<{
          blockId: string | null;
          text: string | null;
          vector: number[] | null;
        }>;
      }
    ).maybePersistSourceSummary({
      event: docEvent,
      payload: { documentSummary: 'Документ про маршруты доставки и склады.' },
      contextHeader: 'ctx',
    });

    expect(res.blockId).toBe('block-1');
    expect(res.text).toBe('Документ про маршруты доставки и склады.');
    expect(res.vector).toEqual([0.1, 0.2, 0.3]);
    expect(embedBlocks).toHaveBeenCalledOnce();
    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.name)).toContain('Суть документа');
  });

  it('document без summary-текста → return null (не падает, блок не создаётся)', async () => {
    const { worker, create } = buildDocWorker();
    const res = await (
      worker as unknown as {
        maybePersistSourceSummary: (a: unknown) => Promise<{ blockId: string | null }>;
      }
    ).maybePersistSourceSummary({
      event: docEvent,
      payload: { documentSummary: '' },
      contextHeader: 'ctx',
    });

    expect(res.blockId).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
