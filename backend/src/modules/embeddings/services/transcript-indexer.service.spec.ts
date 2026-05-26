import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { EmbeddingFallbackService } from './embedding-fallback.service';
import {
  TranscriptIndexerService,
  formatVectorLiteral,
} from './transcript-indexer.service';

function makeCfg(over: Partial<{ batchSize: number; chunkTargetTokens: number; chunkOverlapTokens: number }> = {}): TypedConfigService {
  return {
    ai: {
      embeddings: {
        provider: 'openai-via-proxy',
        model: 'text-embedding-3-small',
        dimensions: 1536,
        proxyApiKey: '',
        proxyEmbeddingsUrl: '',
        fallbackLocalUrl: '',
        batchSize: over.batchSize ?? 50,
        chunkTargetTokens: over.chunkTargetTokens ?? 5,
        chunkOverlapTokens: over.chunkOverlapTokens ?? 1,
      },
    },
  } as unknown as TypedConfigService;
}

interface BuildOpts {
  meeting?: {
    ownerId?: string;
    transcript?: { turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }> } | null;
  } | null;
  mergedTurns?: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
  embedFn?: ReturnType<typeof vi.fn>;
}

function build(opts: BuildOpts) {
  const meetingFindUnique = vi.fn(async () =>
    opts.meeting === null
      ? null
      : {
          id: 'm-1',
          ownerId: opts.meeting?.ownerId ?? 'u-1',
          transcript: opts.meeting?.transcript ?? {
            turns: opts.mergedTurns ?? [
              { speaker: 'Alice', text: 'one two three four five six seven eight', startSec: 0, endSec: 8 },
            ],
          },
        },
  );
  const meetingUpdate = vi.fn(async () => undefined);
  const chunkDeleteMany = vi.fn(async () => ({ count: 0 }));
  const executeRawUnsafe = vi.fn(async () => 1);

  const prisma = {
    meeting: { findUnique: meetingFindUnique, update: meetingUpdate },
    meetingTranscriptChunk: { deleteMany: chunkDeleteMany },
    $executeRawUnsafe: executeRawUnsafe,
  } as unknown as PrismaService;

  const embed =
    opts.embedFn ??
    vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
  const embeddings = { embed } as unknown as EmbeddingFallbackService;

  const svc = new TranscriptIndexerService(prisma, embeddings, makeCfg());
  return { svc, meetingFindUnique, meetingUpdate, chunkDeleteMany, executeRawUnsafe, embed };
}

describe('TranscriptIndexerService', () => {
  it('chunkTurns: разбивает на чанки с overlap', () => {
    const { svc } = build({});
    // 8 слов, target=5, overlap=1 → [0..5], [4..8]
    const chunks = svc.chunkTurns(
      [{ speaker: 'A', text: 'a b c d e f g h', startSec: 0, endSec: 8 }],
      { targetTokens: 5, overlapTokens: 1 },
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toContain('A: a b c d e');
    expect(chunks[1]?.text).toContain('A: e f g h');
  });

  it('chunkTurns: пустые turns — пустой результат', () => {
    const { svc } = build({});
    expect(svc.chunkTurns([], { targetTokens: 5, overlapTokens: 1 })).toEqual([]);
  });

  it('indexMeeting: success — deleteMany + insert + ready', async () => {
    const ctx = build({});
    const result = await ctx.svc.indexMeeting('m-1');
    expect(result.chunksIndexed).toBeGreaterThan(0);
    expect(ctx.chunkDeleteMany).toHaveBeenCalledWith({ where: { meetingId: 'm-1' } });
    expect(ctx.executeRawUnsafe).toHaveBeenCalled();
    // последний meeting.update — статус ready.
    const lastUpdate = ctx.meetingUpdate.mock.calls.at(-1) as
      | [{ where: unknown; data: { embeddingsStatus: string } }]
      | undefined;
    expect(lastUpdate?.[0].data.embeddingsStatus).toBe('ready');
  });

  it('indexMeeting: пустой transcript — статус ready без insert', async () => {
    const ctx = build({ mergedTurns: [] });
    const result = await ctx.svc.indexMeeting('m-1');
    expect(result.chunksIndexed).toBe(0);
    expect(ctx.executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('indexMeeting: provider упал — статус failed + бросает ошибку', async () => {
    const embedFail = vi.fn(async () => {
      throw new Error('embed boom');
    });
    const ctx = build({ embedFn: embedFail });
    await expect(ctx.svc.indexMeeting('m-1')).rejects.toThrow(/embed boom/);
    // Должны увидеть update с embeddingsStatus=failed.
    const updateCalls = (ctx.meetingUpdate as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const failedCall = updateCalls.find(
      (c) => (c[0] as { data: { embeddingsStatus?: string } }).data.embeddingsStatus === 'failed',
    );
    expect(failedCall).toBeDefined();
  });

  it('indexMeeting: meeting не найден — ошибка', async () => {
    const ctx = build({ meeting: null });
    await expect(ctx.svc.indexMeeting('m-1')).rejects.toThrow();
  });

  it('indexMeeting: provider вернул не то количество — ошибка', async () => {
    const embedShort = vi.fn(async () => [[0.1]]); // вернёт 1, а ждём столько же сколько чанков
    const ctx = build({
      mergedTurns: [
        { speaker: 'A', text: 'a b c d e f g h i j', startSec: 0, endSec: 10 },
      ],
      embedFn: embedShort,
    });
    await expect(ctx.svc.indexMeeting('m-1')).rejects.toThrow();
  });
});

describe('formatVectorLiteral', () => {
  it('форматирует массив чисел в pgvector-литерал', () => {
    expect(formatVectorLiteral([1, 2.5, -3])).toBe('[1,2.5,-3]');
  });
  it('NaN — ошибка', () => {
    expect(() => formatVectorLiteral([1, Number.NaN])).toThrow();
  });
  it('Infinity — ошибка', () => {
    expect(() => formatVectorLiteral([1, Number.POSITIVE_INFINITY])).toThrow();
  });
});
