import { describe, expect, it, vi } from 'vitest';

import type { ExtractedBlock } from '../services/block-extraction.service';
import type { Segment } from '../services/segment-builder.service';

import { BlockIngestWorker } from './block-ingest.worker';

function buildFakeTx() {
  const create = vi.fn(async (a: { data: Record<string, unknown> }) => ({
    id: 'block-1',
    ...a.data,
  }));
  const tx = {
    ideaBlock: {
      create,
      update: vi.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })),
    },
    ideaBlockEvidence: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'ev-1', ...a.data })),
    },
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  return { tx, create };
}

function buildWorker() {
  const { tx, create } = buildFakeTx();
  const prisma = {
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    ideaBlockEntity: { upsert: vi.fn(async () => ({})) },
  } as unknown;

  const getDynamic = vi.fn(async (_key: string, _env?: unknown, def?: unknown) => def ?? false);
  const cfg = {
    bitemporal: { enabled: false, supersedeEnabled: false, factSignalTypes: [] },
    getDynamic,
  } as unknown;

  const incBlockWithoutEvidence = vi.fn();
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
    { incSubjectAttribution: vi.fn(), incBlockWithoutEvidence } as never,
    {} as never,
    cfg as never,
    {} as never,
  );
  return { worker, create, incBlockWithoutEvidence };
}

function buildBlock(overrides: Partial<ExtractedBlock> = {}): ExtractedBlock {
  return {
    name: 'Факт',
    criticalQuestion: 'Что обсудили?',
    trustedAnswer: 'Обсудили так',
    signalType: 'fact',
    tags: [],
    confidence: 0.8,
    evidenceQuote: 'дословная цитата из встречи',
    evidenceStartMs: 0,
    evidenceEndMs: 0,
    mentionedEntities: [],
    role_relevant: false,
    ...overrides,
  };
}

const meetingEvent = {
  id: 'raw-meeting',
  tenantId: 'tenant-1',
  sourceType: 'meeting',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

const segments: Segment[] = [{ startMs: 0, endMs: 0, speakers: [], text: 'x' }];

async function callPersist(worker: BlockIngestWorker, block: ExtractedBlock): Promise<string | null> {
  return (
    worker as unknown as { persistBlock: (a: unknown) => Promise<string | null> }
  ).persistBlock({
    event: meetingEvent,
    block,
    embedding: null,
    roleRelevant: false,
    roleId: null,
    segments,
    authorUserId: null,
  });
}

describe('BlockIngestWorker — Ф2 провенанс-инвариант (блок без evidence запрещён)', () => {
  it('блок с пустой evidenceQuote НЕ записывается, метрика инкрементнута, вернул null', async () => {
    const { worker, create, incBlockWithoutEvidence } = buildWorker();
    const result = await callPersist(worker, buildBlock({ evidenceQuote: '' }));

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(incBlockWithoutEvidence).toHaveBeenCalledWith({ reason: 'empty_quote' });
  });

  it('блок с пробельной evidenceQuote отбрасывается (trim)', async () => {
    const { worker, create, incBlockWithoutEvidence } = buildWorker();
    const result = await callPersist(worker, buildBlock({ evidenceQuote: '   \n  ' }));

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(incBlockWithoutEvidence).toHaveBeenCalledTimes(1);
  });

  it('блок с непустой evidenceQuote записывается (create вызван, метрика НЕ инкрементнута)', async () => {
    const { worker, create, incBlockWithoutEvidence } = buildWorker();
    const result = await callPersist(worker, buildBlock({ evidenceQuote: 'реальная цитата' }));

    expect(result).toBe('block-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(incBlockWithoutEvidence).not.toHaveBeenCalled();
  });
});
