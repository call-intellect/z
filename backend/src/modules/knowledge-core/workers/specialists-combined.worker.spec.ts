import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { SpecialistsCombinedParseError } from '../services/specialists-combined.service';

import { SpecialistsCombinedWorker } from './specialists-combined.worker';

interface Deps {
  prisma: any;
  blockFetch: { getCanonicalBlocksForSource: ReturnType<typeof vi.fn> };
  combined: { extractAll: ReturnType<typeof vi.fn> };
  metrics: { incCombinedParseFailed: ReturnType<typeof vi.fn> };
}

function buildWorker(
  opts: {
    rawEvent?: { sourceTitle: string | null; dataClass: string } | null;
    blocks?: any[];
    meetingDeletedAt?: Date | null;
  } = {},
): { worker: SpecialistsCombinedWorker; deps: Deps } {
  const blocks =
    opts.blocks ??
    [
      {
        id: 'blk_1',
        name: 'Решение',
        criticalQuestion: 'Что?',
        trustedAnswer: 'Так.',
        signalType: 'decision',
        tags: [],
        dataClass: 'sensitive',
        evidence: [
          {
            id: 'ev_1',
            startMs: 0,
            endMs: 1,
            quote: 'берём вариант A',
            sourceTimestamp: null,
            authorLabel: 'Александр (клиент)',
          },
        ],
      },
    ];

  const prisma = {
    rawEvent: {
      findFirst: vi.fn(async () =>
        opts.rawEvent === undefined
          ? { sourceTitle: null, dataClass: 'sensitive' }
          : opts.rawEvent,
      ),
    },
    meeting: {
      findFirst: vi.fn(async () => ({ deletedAt: opts.meetingDeletedAt ?? null })),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async () => []),
    },
  };

  const blockFetch = {
    getCanonicalBlocksForSource: vi.fn(async () => blocks),
  };

  const combined = {
    extractAll: vi.fn(async () => ({
      created: {},
      emptySections: [],
      errors: [],
      llm: { modelUsed: 'm', durationMs: 1, inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
    })),
  };

  const cfg = { specialistsCombined: { enabled: true, delayMs: 0 } } as any;

  const metrics = { incCombinedParseFailed: vi.fn() };

  const worker = new SpecialistsCombinedWorker(
    {} as any, // redis
    prisma as any, // prisma
    blockFetch as any, // blockFetch
    combined as any, // combined
    cfg, // cfg (Optional)
    metrics as any, // metrics (Optional)
  );

  return { worker, deps: { prisma, blockFetch, combined, metrics } };
}

function chatJob(): Job<any> {
  return {
    id: 'specialists_combined_chatbox_sess-1',
    data: { tenantId: 'tenant-1', sourceType: 'chatbox', externalId: 'sess-1' },
  } as unknown as Job<any>;
}

function meetingJob(): Job<any> {
  return {
    id: 'specialists_combined_meeting_m-1',
    data: { tenantId: 'tenant-1', sourceType: 'meeting', externalId: 'm-1' },
  } as unknown as Job<any>;
}

describe('SpecialistsCombinedWorker — WP-A канало-агностичный combo', () => {
  it('chat (chatbox): контекст грузится из RawEvent, НЕ из Meeting; извлечение запущено', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: null, dataClass: 'sensitive' },
    });

    await worker.process(chatJob());

    expect(deps.prisma.meeting.findFirst).not.toHaveBeenCalled();
    expect(deps.prisma.rawEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          sourceType: 'chatbox',
          sourceExternalId: 'sess-1',
        }),
      }),
    );
    expect(deps.blockFetch.getCanonicalBlocksForSource).toHaveBeenCalledWith(
      'tenant-1',
      'chatbox',
      'sess-1',
    );
    expect(deps.combined.extractAll).toHaveBeenCalledTimes(1);
    const callArg = (deps.combined.extractAll.mock.calls[0]![0] as any);
    expect(callArg.channelKind).toBe('chat');
    expect(callArg.sourceType).toBe('chatbox');
    expect(callArg.dataClass).toBe('sensitive');
    expect(callArg.tenantId).toBe('tenant-1');
    expect(callArg.meetingId).toBe('sess-1');
    expect(callArg.meetingTitle).toBe('Переписка');
  });

  it('chat: speaker берётся из evidence.authorLabel, а не "—"', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: 'Чат с Александром', dataClass: 'sensitive' },
    });

    await worker.process(chatJob());

    const callArg = (deps.combined.extractAll.mock.calls[0]![0] as any);
    expect(callArg.meetingTitle).toBe('Чат с Александром');
    expect(callArg.blocks[0].evidence.speaker).toBe('Александр (клиент)');
  });

  it('meeting: контекст эквивалентен — channelKind=meeting, dataClass из RawEvent, deletedAt-гард', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: 'Встреча: планёрка', dataClass: 'internal' },
      blocks: [
        {
          id: 'blk_1',
          name: 'Решение',
          criticalQuestion: 'Что?',
          trustedAnswer: 'Так.',
          signalType: 'decision',
          tags: [],
          dataClass: 'internal',
          evidence: [
            {
              id: 'ev_1',
              startMs: 0,
              endMs: 1,
              quote: 'q',
              sourceTimestamp: null,
              authorLabel: null,
            },
          ],
        },
      ],
    });

    await worker.process(meetingJob());

    expect(deps.prisma.meeting.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', tenantId: 'tenant-1' },
      select: { deletedAt: true },
    });
    const callArg = (deps.combined.extractAll.mock.calls[0]![0] as any);
    expect(callArg.channelKind).toBe('meeting');
    expect(callArg.sourceType).toBe('meeting');
    expect(callArg.dataClass).toBe('internal');
    expect(callArg.meetingId).toBe('m-1');
    expect(callArg.meetingTitle).toBe('Встреча: планёрка');
    expect(callArg.blocks[0].evidence.speaker).toBe('—');
  });

  it('meeting удалён → skip, extractAll не вызывается', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: 'Встреча', dataClass: 'internal' },
      meetingDeletedAt: new Date(),
    });

    await worker.process(meetingJob());

    expect(deps.combined.extractAll).not.toHaveBeenCalled();
  });

  it('RawEvent источника нет → skip', async () => {
    const { worker, deps } = buildWorker({ rawEvent: null });

    await worker.process(chatJob());

    expect(deps.blockFetch.getCanonicalBlocksForSource).not.toHaveBeenCalled();
    expect(deps.combined.extractAll).not.toHaveBeenCalled();
  });

  it('нет canonical-блоков → skip', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: 'Чат', dataClass: 'sensitive' },
      blocks: [],
    });

    await worker.process(chatJob());

    expect(deps.combined.extractAll).not.toHaveBeenCalled();
  });

  it('legacy payload (только meetingId) → резолвится как meeting', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: 'Встреча', dataClass: 'internal' },
    });
    const legacyJob = {
      id: 'specialists_combined_legacy',
      data: { tenantId: 'tenant-1', meetingId: 'm-legacy' },
    } as unknown as Job<any>;

    await worker.process(legacyJob);

    expect(deps.prisma.rawEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceType: 'meeting', sourceExternalId: 'm-legacy' }),
      }),
    );
    const callArg = (deps.combined.extractAll.mock.calls[0]![0] as any);
    expect(callArg.channelKind).toBe('meeting');
    expect(callArg.meetingId).toBe('m-legacy');
  });

  it('рубильник OFF → skip без выборок', async () => {
    const { worker, deps } = buildWorker();
    (worker as any).cfg = { specialistsCombined: { enabled: false, delayMs: 0 } };

    await worker.process(chatJob());

    expect(deps.prisma.rawEvent.findFirst).not.toHaveBeenCalled();
    expect(deps.combined.extractAll).not.toHaveBeenCalled();
  });

  it('F-8: SpecialistsCombinedParseError (repair исчерпан) → incCombinedParseFailed + финализация без throw', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: 'Чат', dataClass: 'sensitive' },
    });
    deps.combined.extractAll.mockRejectedValueOnce(
      new SpecialistsCombinedParseError('parse failed after repair', 'raw'),
    );

    await expect(worker.process(chatJob())).resolves.toBeUndefined();

    expect(deps.metrics.incCombinedParseFailed).toHaveBeenCalledTimes(1);
    expect(deps.metrics.incCombinedParseFailed).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      sourceType: 'chatbox',
    });
  });

  it('F-8: не-parse ошибка extractAll пробрасывается (BullMQ retry), метрика НЕ инкрементится', async () => {
    const { worker, deps } = buildWorker({
      rawEvent: { sourceTitle: 'Чат', dataClass: 'sensitive' },
    });
    deps.combined.extractAll.mockRejectedValueOnce(new Error('llm down'));

    await expect(worker.process(chatJob())).rejects.toThrow('llm down');
    expect(deps.metrics.incCombinedParseFailed).not.toHaveBeenCalled();
  });
});
