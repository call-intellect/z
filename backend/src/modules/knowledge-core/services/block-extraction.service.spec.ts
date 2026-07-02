import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { BlockExtractionService } from './block-extraction.service';
import type { MeetingSkeleton } from './meeting-skeleton.service';
import type { MeetingSkeletonService } from './meeting-skeleton.service';
import type { Segment } from './segment-builder.service';

interface CfgKnobs {
  windowSize: number;
  overlap: number;
  gleaningRounds: number;
  gleaningMinSegments: number;
  minConfidence?: number;
  skeletonPassEnabled?: boolean;
  headerMapEnabled?: boolean;
  skeletonMinSegments?: number;
}

function makeCfg(knobs: CfgKnobs): TypedConfigService {
  return {
    knowledgeCore: {
      blockIngestWindowSegments: knobs.windowSize,
      blockIngestWindowOverlapSegments: knobs.overlap,
      blockIngestGleaningRounds: knobs.gleaningRounds,
      blockIngestGleaningMinSegments: knobs.gleaningMinSegments,
      skeletonPassEnabled: knobs.skeletonPassEnabled ?? false,
      headerMapEnabled: knobs.headerMapEnabled ?? true,
      skeletonMinSegments: knobs.skeletonMinSegments ?? 6,
    },
    extraction: { typedEntityMinConfidence: knobs.minConfidence ?? 0 },
    aiFeatures: { promptInjectionGuardEnabled: false },
  } as unknown as TypedConfigService;
}

function seg(startMs: number, text: string): Segment {
  return { startMs, endMs: startMs + 1000, speakers: ['Анна'], text };
}

function block(quote: string, startMs: number, signalType = 'fact') {
  return {
    name: `Блок ${quote}`,
    criticalQuestion: 'q',
    trustedAnswer: 'a',
    signalType,
    tags: [],
    confidence: 0.9,
    evidenceQuote: quote,
    evidenceStartMs: startMs,
    evidenceEndMs: startMs + 500,
    mentionedEntities: [],
    role_relevant: false,
  };
}

function jsonOf(payload: Record<string, unknown>): { text: string } {
  return { text: JSON.stringify(payload) };
}

type LlmCallArg = { userMessage: string };
type LlmCall = (req: LlmCallArg) => Promise<{ text: string }>;

type Metrics = {
  incBlockGleaningRounds: ReturnType<typeof vi.fn>;
  incBlockGleaningBlocks: ReturnType<typeof vi.fn>;
  incBlockOverlapDedup: ReturnType<typeof vi.fn>;
};

function makeMetrics(): Metrics {
  return {
    incBlockGleaningRounds: vi.fn(),
    incBlockGleaningBlocks: vi.fn(),
    incBlockOverlapDedup: vi.fn(),
  };
}

function makeService(
  cfg: TypedConfigService,
  call: ReturnType<typeof vi.fn<LlmCall>>,
  buildSkeleton?: (args: {
    segments: Segment[];
  }) => Promise<MeetingSkeleton | null>,
  metrics?: Metrics,
): BlockExtractionService {
  const llm = { call } as unknown as LlmRouterService;
  const skeletonService = {
    buildSkeleton: buildSkeleton ?? (async () => null),
  } as unknown as MeetingSkeletonService;
  return new BlockExtractionService(
    cfg,
    llm,
    skeletonService,
    metrics as unknown as BusinessMetricsService | undefined,
  );
}

function userMsgAt(
  call: ReturnType<typeof vi.fn<LlmCall>>,
  idx: number,
): string {
  const c = call.mock.calls[idx];
  return c ? String(c[0].userMessage) : '';
}

const baseArgs = (segments: Segment[]) => ({
  tenantId: 't1',
  rawEventId: 'r1',
  segments,
});

describe('BlockExtractionService.extractFull — overlap + позиция + gleaning', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('needle на стыке: блок в overlap-зоне из двух окон → один блок (дедуп)', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 1,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
    });
    const segments = [
      seg(0, 's0'),
      seg(1000, 's1'),
      seg(2000, 's2'),
      seg(3000, 's3'),
    ];
    const call = vi.fn(async () =>
      jsonOf({ blocks: [block('игла на стыке', 1000)] }),
    );
    const svc = makeService(cfg, call);

    const out = await svc.extractFull(baseArgs(segments));

    const needles = out.blocksInOrder.filter(
      (b) => b.evidenceQuote === 'игла на стыке',
    );
    expect(needles.length).toBe(1);

    let seenSeg1 = 0;
    for (let n = 0; n < call.mock.calls.length; n++) {
      if (userMsgAt(call, n).includes('"text": "s1"')) seenSeg1 += 1;
    }
    expect(seenSeg1).toBeGreaterThanOrEqual(2);
  });

  it('totalWindows/windowIndex переданы в промпт для много-оконного входа', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 1,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const svc = makeService(cfg, call);

    await svc.extractFull(baseArgs(segments));

    expect(userMsgAt(call, 0)).toContain('фрагмент 1 из 2');
    expect(userMsgAt(call, 1)).toContain('фрагмент 2 из 2');
  });

  it('одно-оконный вход не получает позиционную строку', async () => {
    const cfg = makeCfg({
      windowSize: 5,
      overlap: 1,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1')];
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const svc = makeService(cfg, call);

    await svc.extractFull(baseArgs(segments));

    expect(call).toHaveBeenCalledTimes(1);
    expect(userMsgAt(call, 0)).not.toContain('фрагмент');
  });

  it('gleaning: раунд добавляет B, дедуп A, exclude содержит A', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 1,
      gleaningMinSegments: 2,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi
      .fn()
      .mockResolvedValueOnce(jsonOf({ blocks: [block('A', 0)] }))
      .mockResolvedValueOnce(
        jsonOf({ blocks: [block('A', 0), block('B', 1000)] }),
      );
    const svc = makeService(cfg, call);

    const out = await svc.extractFull(baseArgs(segments));

    const quotes = out.blocksInOrder.map((b) => b.evidenceQuote).sort();
    expect(quotes).toEqual(['A', 'B']);
    expect(call).toHaveBeenCalledTimes(2);
    expect(userMsgAt(call, 1)).toContain('Уже найдено');
    expect(userMsgAt(call, 1)).toContain('Блок A');
  });

  it('gleaningRounds=0 → второго вызова нет', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 2,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi.fn(async () => jsonOf({ blocks: [block('A', 0)] }));
    const svc = makeService(cfg, call);

    await svc.extractFull(baseArgs(segments));

    expect(call).toHaveBeenCalledTimes(1);
  });

  it('segments < gleaningMinSegments → gleaning не зовётся', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 2,
      gleaningMinSegments: 5,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1')];
    const call = vi.fn(async () => jsonOf({ blocks: [block('A', 0)] }));
    const svc = makeService(cfg, call);

    await svc.extractFull(baseArgs(segments));

    expect(call).toHaveBeenCalledTimes(1);
  });

  it('gleaning прерывается, если раунд не дал новых блоков', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 3,
      gleaningMinSegments: 2,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi.fn(async () => jsonOf({ blocks: [block('A', 0)] }));
    const svc = makeService(cfg, call);

    await svc.extractFull(baseArgs(segments));

    expect(call).toHaveBeenCalledTimes(2);
  });

  it('overlap>=windowSize → шаг склампан в 1 (нет бесконечного цикла)', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 5,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const svc = makeService(cfg, call);

    const out = await svc.extractFull(baseArgs(segments));

    expect(out.blocksInOrder).toEqual([]);
    expect(call.mock.calls.length).toBeLessThanOrEqual(segments.length);
    expect(call.mock.calls.length).toBeGreaterThan(0);
  });

  it('overlap=0 → шаг=windowSize (поведение как раньше)', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2'), seg(3000, 's3')];
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const svc = makeService(cfg, call);

    await svc.extractFull(baseArgs(segments));

    expect(call).toHaveBeenCalledTimes(2);
  });

  it('typed remap: процесс из overlap-окна не задвоен, индекс валиден', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 1,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
      minConfidence: 0.5,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const overlapBlock = block('общий блок', 1000);
    const proc = {
      name: 'Процесс деплоя',
      confidence: 0.9,
      sourceBlockIndex: 0,
    };
    const call = vi.fn(async (req: { userMessage: string }) => {
      if (req.userMessage.includes('"text": "s1"')) {
        return jsonOf({ blocks: [overlapBlock], processes: [proc] });
      }
      return jsonOf({ blocks: [] });
    });
    const svc = makeService(cfg, call);

    const out = await svc.extractFull(baseArgs(segments));

    expect(out.typed.processes.length).toBe(1);
    const idx = out.typed.processes[0]?.sourceBlockIndex ?? null;
    expect(idx).not.toBeNull();
    expect(out.blocksInOrder[idx as number]?.evidenceQuote).toBe('общий блок');
  });

  it('typed с битым sourceBlockIndex (вне диапазона) пропускается', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
      minConfidence: 0.5,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi.fn(async () =>
      jsonOf({
        blocks: [block('A', 0)],
        decisions: [{ text: 'кривой', confidence: 0.9, sourceBlockIndex: 7 }],
      }),
    );
    const svc = makeService(cfg, call);

    const out = await svc.extractFull(baseArgs(segments));

    expect(out.typed.decisions.length).toBe(0);
  });

  it('пустой вход → пустой результат, LLM не зовётся', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 1,
      gleaningRounds: 1,
      gleaningMinSegments: 2,
    });
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const svc = makeService(cfg, call);

    const out = await svc.extractFull(baseArgs([]));

    expect(out.blocksInOrder).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });

  it('gleaning fail-open: ошибка раунда не валит окно', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 1,
      gleaningMinSegments: 2,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi
      .fn()
      .mockResolvedValueOnce(jsonOf({ blocks: [block('A', 0)] }))
      .mockRejectedValueOnce(new Error('boom'));
    const svc = makeService(cfg, call);

    const out = await svc.extractFull(baseArgs(segments));

    expect(out.blocksInOrder.map((b) => b.evidenceQuote)).toEqual(['A']);
  });
});

describe('BlockExtractionService.extractFull — скелет → шапка-карта (Ф6)', () => {
  beforeEach(() => vi.restoreAllMocks());

  const longSegments = (): Segment[] =>
    Array.from({ length: 8 }, (_, i) => seg(i * 1000, `s${i}`));

  const skeletonFixture: MeetingSkeleton = {
    agenda: 'Обсуждение переноса склада',
    milestones: [{ title: 'Старт', fromIndex: 0, toIndex: 2 }],
    keyNames: ['Марина', 'ООО Ромашка'],
  };

  it('skeletonPassEnabled=false → buildSkeleton НЕ зван', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
      skeletonPassEnabled: false,
      skeletonMinSegments: 6,
    });
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const buildSkeleton = vi.fn(async () => skeletonFixture);
    const svc = makeService(cfg, call, buildSkeleton);

    await svc.extractFull(baseArgs(longSegments()));

    expect(buildSkeleton).not.toHaveBeenCalled();
  });

  it('segments.length <= skeletonMinSegments → buildSkeleton НЕ зван', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
      skeletonPassEnabled: true,
      skeletonMinSegments: 10,
    });
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const buildSkeleton = vi.fn(async () => skeletonFixture);
    const svc = makeService(cfg, call, buildSkeleton);

    await svc.extractFull(baseArgs(longSegments()));

    expect(buildSkeleton).not.toHaveBeenCalled();
  });

  it('skeleton=null (fail-open) → окна извлекаются как раньше', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
      skeletonPassEnabled: true,
      skeletonMinSegments: 6,
    });
    const segments = longSegments();
    const call = vi.fn(async () => jsonOf({ blocks: [block('A', 0)] }));
    const buildSkeleton = vi.fn(async () => null);
    const svc = makeService(cfg, call, buildSkeleton);

    const out = await svc.extractFull(baseArgs(segments));

    expect(buildSkeleton).toHaveBeenCalledTimes(1);
    expect(out.blocksInOrder.map((b) => b.evidenceQuote)).toEqual(['A']);
    for (let n = 0; n < call.mock.calls.length; n++) {
      expect(userMsgAt(call, n)).not.toContain('Карта встречи');
    }
  });

  it('headerMapEnabled=false → buildSkeleton НЕ зван', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
      skeletonPassEnabled: true,
      headerMapEnabled: false,
      skeletonMinSegments: 6,
    });
    const segments = longSegments();
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const buildSkeleton = vi.fn(async () => skeletonFixture);
    const svc = makeService(cfg, call, buildSkeleton);

    await svc.extractFull(baseArgs(segments));

    expect(buildSkeleton).not.toHaveBeenCalled();
    for (let n = 0; n < call.mock.calls.length; n++) {
      expect(userMsgAt(call, n)).not.toContain('Карта встречи');
    }
  });

  it('happy: секция «Карта встречи» в user-промпте каждого окна', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
      skeletonPassEnabled: true,
      headerMapEnabled: true,
      skeletonMinSegments: 6,
    });
    const segments = longSegments();
    const call = vi.fn(async () => jsonOf({ blocks: [] }));
    const buildSkeleton = vi.fn(async () => skeletonFixture);
    const svc = makeService(cfg, call, buildSkeleton);

    await svc.extractFull(baseArgs(segments));

    expect(buildSkeleton).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.length).toBeGreaterThan(0);
    for (let n = 0; n < call.mock.calls.length; n++) {
      expect(userMsgAt(call, n)).toContain('Карта встречи');
      expect(userMsgAt(call, n)).toContain('Обсуждение переноса склада');
    }
  });
});

describe('BlockExtractionService.extractFull — метрики наблюдения (Ф12a)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('дубль на стыке окон → incBlockOverlapDedup с count>0', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 1,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
    });
    const segments = [
      seg(0, 's0'),
      seg(1000, 's1'),
      seg(2000, 's2'),
      seg(3000, 's3'),
    ];
    const call = vi.fn(async () =>
      jsonOf({ blocks: [block('игла на стыке', 1000)] }),
    );
    const metrics = makeMetrics();
    const svc = makeService(cfg, call, undefined, metrics);

    await svc.extractFull(baseArgs(segments));

    expect(metrics.incBlockOverlapDedup).toHaveBeenCalledTimes(1);
    const arg = metrics.incBlockOverlapDedup.mock.calls[0]?.[0];
    expect(arg.count).toBeGreaterThan(0);
    expect(typeof arg.tenantTop).toBe('string');
  });

  it('gleaning: 1 раунд, +1 блок → метрики rounds/blocks', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 1,
      gleaningMinSegments: 2,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi
      .fn()
      .mockResolvedValueOnce(jsonOf({ blocks: [block('A', 0)] }))
      .mockResolvedValueOnce(
        jsonOf({ blocks: [block('A', 0), block('B', 1000)] }),
      );
    const metrics = makeMetrics();
    const svc = makeService(cfg, call, undefined, metrics);

    await svc.extractFull(baseArgs(segments));

    expect(metrics.incBlockGleaningRounds).toHaveBeenCalledWith(
      expect.objectContaining({ rounds: 1 }),
    );
    expect(metrics.incBlockGleaningBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
    );
  });

  it('gleaningRounds=0 → метрики gleaning не зовутся', async () => {
    const cfg = makeCfg({
      windowSize: 3,
      overlap: 0,
      gleaningRounds: 0,
      gleaningMinSegments: 2,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1'), seg(2000, 's2')];
    const call = vi.fn(async () => jsonOf({ blocks: [block('A', 0)] }));
    const metrics = makeMetrics();
    const svc = makeService(cfg, call, undefined, metrics);

    await svc.extractFull(baseArgs(segments));

    expect(metrics.incBlockGleaningRounds).not.toHaveBeenCalled();
    expect(metrics.incBlockGleaningBlocks).not.toHaveBeenCalled();
  });

  it('метрики опциональны: без сервиса метрик не падает', async () => {
    const cfg = makeCfg({
      windowSize: 2,
      overlap: 1,
      gleaningRounds: 0,
      gleaningMinSegments: 99,
    });
    const segments = [seg(0, 's0'), seg(1000, 's1')];
    const call = vi.fn(async () => jsonOf({ blocks: [block('A', 0)] }));
    const svc = makeService(cfg, call);

    await expect(svc.extractFull(baseArgs(segments))).resolves.toBeDefined();
  });
});
