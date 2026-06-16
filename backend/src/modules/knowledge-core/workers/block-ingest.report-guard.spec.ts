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
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({
        id: 'ev-1',
        ...a.data,
      })),
    },
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  return { tx, create };
}

function buildWorker(opts: { cap?: number } = {}) {
  const { tx, create } = buildFakeTx();
  const prisma = {
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    ideaBlockEntity: { upsert: vi.fn(async () => ({})) },
  } as unknown;

  const getDynamic = vi.fn(async (key: string, _env?: unknown, def?: unknown) => {
    if (key === 'knowledge.reportBlockConfidenceCap') {
      return opts.cap ?? (def as number);
    }
    return def ?? false;
  });
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
    { incSubjectAttribution: vi.fn() } as never,
    {} as never,
    cfg as never,
    {} as never,
  );
  return { worker, create, getDynamic };
}

function buildBlock(overrides: Partial<ExtractedBlock> = {}): ExtractedBlock {
  return {
    name: 'Решение',
    criticalQuestion: 'Что решили?',
    trustedAnswer: 'Решили так',
    signalType: 'decision',
    tags: [],
    confidence: 0.92,
    evidenceQuote: 'цитата',
    evidenceStartMs: 0,
    evidenceEndMs: 0,
    mentionedEntities: [],
    role_relevant: false,
    ...overrides,
  };
}

const reportEvent = {
  id: 'raw-report',
  tenantId: 'tenant-1',
  sourceType: 'meeting_report',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

const meetingEvent = {
  id: 'raw-meeting',
  tenantId: 'tenant-1',
  sourceType: 'meeting',
  occurredAt: new Date('2026-04-01T10:00:00.000Z'),
  dataClass: 'internal',
} as never;

const segments: Segment[] = [{ startMs: 0, endMs: 0, speakers: [], text: 'x' }];

type PersistArg = Parameters<(a: unknown) => Promise<string | null>>[0];

async function callPersist(worker: BlockIngestWorker, event: unknown, block: ExtractedBlock) {
  await (
    worker as unknown as { persistBlock: (a: PersistArg) => Promise<string | null> }
  ).persistBlock({
    event,
    block,
    embedding: null,
    roleRelevant: false,
    roleId: null,
    segments,
    authorUserId: null,
  } as never);
}

describe('BlockIngestWorker — Ф4 ГАРД A (report trust cap)', () => {
  it('(д) report-блок: confidence capped ≤0.6, primarySource=report, dynamicScore=0.7', async () => {
    const { worker, create, getDynamic } = buildWorker();
    await callPersist(worker, reportEvent, buildBlock({ confidence: 0.92 }));

    expect(getDynamic).toHaveBeenCalledWith('knowledge.reportBlockConfidenceCap', undefined, 0.6);
    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.confidence)).toBe('0.6');
    expect(data.primarySource).toBe('report');
    expect(String(data.dynamicScore)).toBe('0.7');
  });

  it('(д) report-блок с уже низким confidence: cap не повышает (min)', async () => {
    const { worker, create } = buildWorker();
    await callPersist(worker, reportEvent, buildBlock({ confidence: 0.3 }));

    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.confidence)).toBe('0.3');
    expect(data.primarySource).toBe('report');
  });

  it('(д) транскриптный блок (meeting): primarySource=transcript, confidence как из LLM, dynamicScore НЕ переопределён', async () => {
    const { worker, create, getDynamic } = buildWorker();
    await callPersist(worker, meetingEvent, buildBlock({ confidence: 0.92 }));

    expect(getDynamic).not.toHaveBeenCalledWith(
      'knowledge.reportBlockConfidenceCap',
      undefined,
      0.6,
    );
    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.confidence)).toBe('0.92');
    expect(data.primarySource).toBe('transcript');
    expect('dynamicScore' in data).toBe(false);
  });

  it('(д) кастомный cap из AdminSetting применяется', async () => {
    const { worker, create } = buildWorker({ cap: 0.45 });
    await callPersist(worker, reportEvent, buildBlock({ confidence: 0.92 }));

    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.confidence)).toBe('0.45');
  });
});
