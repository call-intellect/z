/**
 * Pulse Wave 6 §6.8 — DecisionHygieneScorerWorker (unit).
 *
 * Проверяем: happy type-1 / happy type-2 / skip уже классифицированного /
 * невалидный JSON от LLM.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { DecisionHygieneScorerWorker } from './decision-hygiene-scorer.worker';

interface HarnessOpts {
  decision: Record<string, unknown> | null;
  llmText?: string;
  llmThrows?: Error;
  basisCount?: number;
}

interface WorkerHarness {
  worker: DecisionHygieneScorerWorker;
  decisionUpdate: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
  basisCount: ReturnType<typeof vi.fn>;
}

function buildHarness(opts: HarnessOpts): WorkerHarness {
  const decisionUpdate = vi.fn(async () => ({}));
  const basisCount = vi.fn(async () => opts.basisCount ?? 0);

  const prisma = {
    decision: {
      findUnique: vi.fn(async () => opts.decision),
      update: decisionUpdate,
    },
    ideaBlock: {
      count: basisCount,
    },
  } as unknown as PrismaService;

  const redis = { client: {} } as unknown as RedisService;

  const llmCall = vi.fn(async () => {
    if (opts.llmThrows) throw opts.llmThrows;
    return {
      text: opts.llmText ?? '',
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 200,
      outputTokens: 50,
      cachedTokens: 0,
      durationMs: 500,
      tier: 'primary' as const,
      providerUsed: 'deepseek',
    };
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const worker = new DecisionHygieneScorerWorker(redis, prisma, llm);
  return { worker, decisionUpdate, llmCall, basisCount };
}

function buildDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd-1',
    tenantId: 'org-1',
    statement: 'Нанимаем CTO с опционом 3 %.',
    text: 'Нанимаем CTO с опционом 3 %.',
    rationale: 'Без сильного CTO Series A не закроем.',
    alternatives: null,
    sourceBlockIds: [],
    reversibility: null,
    dataClass: 'sensitive',
    ...overrides,
  };
}

const JOB = {
  id: 'j-1',
  data: { decisionId: 'd-1', tenantId: 'org-1' },
  opts: { attempts: 3 },
  attemptsMade: 0,
} as unknown as Parameters<DecisionHygieneScorerWorker['process']>[0];

describe('DecisionHygieneScorerWorker.process', () => {
  it('happy type-1: пишет reversibility=type-1', async () => {
    const h = buildHarness({
      decision: buildDecision(),
      llmText: JSON.stringify({
        reversibility: 'type-1',
        rationale: 'Найм senior — крайне сложно откатить.',
      }),
    });

    await h.worker.process(JOB);

    expect(h.llmCall).toHaveBeenCalledTimes(1);
    expect(h.decisionUpdate).toHaveBeenCalledTimes(1);
    const arg = h.decisionUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { reversibility: string; reversibilityAt: Date };
    };
    expect(arg.where.id).toBe('d-1');
    expect(arg.data.reversibility).toBe('type-1');
    expect(arg.data.reversibilityAt).toBeInstanceOf(Date);
  });

  it('happy type-2: пишет reversibility=type-2', async () => {
    const h = buildHarness({
      decision: buildDecision({
        statement: 'Запускаем A/B-тест нового onboarding.',
      }),
      llmText: JSON.stringify({
        reversibility: 'type-2',
        rationale: 'A/B-тест легко откатить через feature-flag.',
      }),
    });

    await h.worker.process(JOB);

    expect(h.decisionUpdate).toHaveBeenCalledTimes(1);
    const arg = h.decisionUpdate.mock.calls[0]?.[0] as {
      data: { reversibility: string };
    };
    expect(arg.data.reversibility).toBe('type-2');
  });

  it('already classified (reversibility !== null) — skip + LLM не вызывается', async () => {
    const h = buildHarness({
      decision: buildDecision({ reversibility: 'type-2' }),
    });

    await h.worker.process(JOB);

    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.decisionUpdate).not.toHaveBeenCalled();
  });

  it('невалидный JSON от LLM — поле не обновляется', async () => {
    const h = buildHarness({
      decision: buildDecision(),
      llmText: 'Не JSON, просто текст вердикта',
    });

    await h.worker.process(JOB);

    expect(h.llmCall).toHaveBeenCalledTimes(1);
    expect(h.decisionUpdate).not.toHaveBeenCalled();
  });

  it('decision не найден — silent skip', async () => {
    const h = buildHarness({ decision: null });
    await h.worker.process(JOB);
    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.decisionUpdate).not.toHaveBeenCalled();
  });

  it('пустой statement+text — skip без вызова LLM', async () => {
    const h = buildHarness({
      decision: buildDecision({ statement: null, text: '' }),
    });
    await h.worker.process(JOB);
    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.decisionUpdate).not.toHaveBeenCalled();
  });

  it('type-1 без alternatives и без decision_basis блоков — лог warning, но update проходит', async () => {
    const h = buildHarness({
      decision: buildDecision({
        sourceBlockIds: ['b-1', 'b-2'],
        alternatives: null,
      }),
      llmText: JSON.stringify({
        reversibility: 'type-1',
        rationale: 'Найм senior.',
      }),
      basisCount: 0,
    });

    await h.worker.process(JOB);

    expect(h.decisionUpdate).toHaveBeenCalledTimes(1);
    // basisCount запрошен с sourceBlockIds.
    expect(h.basisCount).toHaveBeenCalled();
  });

  it('LLM упал — пробрасываем ошибку, чтобы BullMQ ретрайнул', async () => {
    const h = buildHarness({
      decision: buildDecision(),
      llmThrows: new Error('LLM provider down'),
    });

    await expect(h.worker.process(JOB)).rejects.toThrow('LLM provider down');
    expect(h.decisionUpdate).not.toHaveBeenCalled();
  });

  it('tenant mismatch — skip', async () => {
    const h = buildHarness({
      decision: buildDecision({ tenantId: 'org-OTHER' }),
    });

    await h.worker.process(JOB);

    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.decisionUpdate).not.toHaveBeenCalled();
  });
});
