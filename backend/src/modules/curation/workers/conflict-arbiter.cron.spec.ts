import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { ConflictService } from '../services/conflict.service';

import { ConflictArbiterCron } from './conflict-arbiter.cron';

/**
 * Autonomy W1 «LLM-арбитр конфликтов» (2026-06-12) — юнит-тесты
 * ConflictArbiterCron: авто-резолв при уверенном консенсусе дебата,
 * все «стоп-условия» (split / fallback / evolving / низкая confidence /
 * kill-switch) и устойчивость sweep'а к ошибке одного конфликта.
 */
describe('ConflictArbiterCron (Autonomy W1)', () => {
  let prisma: PrismaService;
  let conflicts: ConflictService;
  let conversational: ConversationalService;
  let metrics: BusinessMetricsService;
  let cfg: TypedConfigService;
  let debate: MultiAgentDebateService;
  let cron: ConflictArbiterCron;

  let conflictFindManyMock: ReturnType<typeof vi.fn>;
  let orgFindUniqueMock: ReturnType<typeof vi.fn>;
  let cardVersionFindFirstMock: ReturnType<typeof vi.fn>;
  let resolveMock: ReturnType<typeof vi.fn>;
  let sendNotificationMock: ReturnType<typeof vi.fn>;
  let incConflictArbiterMock: ReturnType<typeof vi.fn>;
  let judgeMock: ReturnType<typeof vi.fn>;

  function makeCfg(
    over: Partial<{
      conflictArbiterEnabled: boolean;
      conflictArbiterMinConfidence: number;
      conflictArbiterBatchSize: number;
    }> = {},
  ): TypedConfigService {
    return {
      curation: {
        conflictArbiterEnabled: true,
        conflictArbiterMinConfidence: 0.7,
        conflictArbiterBatchSize: 20,
        ...over,
      },
    } as unknown as TypedConfigService;
  }

  function conflictItem(over: Record<string, unknown> = {}) {
    return {
      id: 'c-1',
      tenantId: 't-1',
      resourceType: 'regulation',
      existingId: 'card-old',
      newId: 'card-new',
      relationType: 'contradicts',
      detectedBy: 'block-linker',
      evidence: { quote: 'противоречие' },
      status: 'open',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      ...over,
    };
  }

  /** Уверенный majority accept_new (2×0.8 за, 1 против) — авто-резолвится. */
  function verdict(over: Partial<DebateVerdict> = {}): DebateVerdict {
    return {
      decision: 'accept_new',
      votes: [
        {
          stance: 'strict-critic',
          verdict: 'accept_new',
          reasoning: 'критик: новое обосновано',
          confidence: 0.8,
          provider: 'deepseek',
          costUsd: 0.001,
        },
        {
          stance: 'empathetic-supporter',
          verdict: 'accept_new',
          reasoning: 'сторонник: новое свежее',
          confidence: 0.8,
          provider: 'openai-via-proxy',
          costUsd: 0.001,
        },
        {
          stance: 'neutral-judge',
          verdict: 'keep_old',
          reasoning: 'нейтральный: сомневаюсь',
          confidence: 0.6,
          provider: 'deepseek',
          costUsd: 0.001,
        },
      ],
      consensusType: 'majority',
      rounds: 1,
      totalCostUsd: 0.003,
      fallbackUsed: null,
      ...over,
    };
  }

  function buildCron(cfgOverride?: TypedConfigService): ConflictArbiterCron {
    return new ConflictArbiterCron(
      prisma,
      conflicts,
      conversational,
      metrics,
      cfgOverride ?? cfg,
      debate,
    );
  }

  beforeEach(() => {
    conflictFindManyMock = vi.fn().mockResolvedValue([conflictItem()]);
    orgFindUniqueMock = vi.fn().mockResolvedValue({ ownerId: 'owner-1' });
    cardVersionFindFirstMock = vi
      .fn()
      .mockResolvedValue({ payload: { title: 'версия' } });
    resolveMock = vi.fn().mockResolvedValue({ id: 'c-1', status: 'resolved' });
    sendNotificationMock = vi.fn().mockResolvedValue({ id: 'n-1' });
    incConflictArbiterMock = vi.fn();
    judgeMock = vi.fn().mockResolvedValue(verdict());

    prisma = {
      conflictItem: { findMany: conflictFindManyMock },
      org: { findUnique: orgFindUniqueMock },
      cardVersion: { findFirst: cardVersionFindFirstMock },
    } as unknown as PrismaService;
    conflicts = { resolve: resolveMock } as unknown as ConflictService;
    conversational = {
      sendNotification: sendNotificationMock,
    } as unknown as ConversationalService;
    metrics = {
      incConflictArbiter: incConflictArbiterMock,
    } as unknown as BusinessMetricsService;
    cfg = makeCfg();
    debate = { judge: judgeMock } as unknown as MultiAgentDebateService;

    cron = buildCron();
  });

  it('majority accept_new conf 0.8 → resolve от владельца Org + system.message', async () => {
    const res = await cron.runForOrg('t-1');

    expect(res.autoResolved).toBe(1);
    expect(judgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskFamily: 'conflict-arbiter',
        taskType: 'debate-conflict-arbiter',
        tenantId: 't-1',
      }),
    );
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        conflictId: 'c-1',
        reviewerUserId: 'owner-1',
        resolution: 'accept_new',
        reasoning: expect.stringContaining('[Кора-арбитр]'),
      }),
    );
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        recipientUserId: 'owner-1',
        eventType: 'system.message',
        payload: expect.objectContaining({
          title: 'Кора разрешила конфликт знаний',
        }),
      }),
    );
    expect(incConflictArbiterMock).toHaveBeenCalledWith({
      verdict: 'accept_new',
      outcome: 'auto_resolved',
    });
  });

  it('split → resolve НЕ вызван, конфликт остаётся open', async () => {
    judgeMock.mockResolvedValue(
      verdict({ decision: 'split_uncertain', consensusType: 'split' }),
    );

    const res = await cron.runForOrg('t-1');

    expect(res.leftOpen).toBe(1);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(incConflictArbiterMock).toHaveBeenCalledWith({
      verdict: 'split_uncertain',
      outcome: 'left_open',
    });
  });

  it('fallbackUsed=cost_cap → resolve НЕ вызван даже при консенсусе', async () => {
    judgeMock.mockResolvedValue(verdict({ fallbackUsed: 'cost_cap' }));

    const res = await cron.runForOrg('t-1');

    expect(res.leftOpen).toBe(1);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(incConflictArbiterMock).toHaveBeenCalledWith({
      verdict: 'accept_new',
      outcome: 'left_open',
    });
  });

  it('decision=evolving (majority, высокая confidence) → НЕ авто-резолвим (нет механизма дат)', async () => {
    judgeMock.mockResolvedValue(
      verdict({
        decision: 'evolving',
        votes: [
          {
            stance: 'strict-critic',
            verdict: 'evolving',
            reasoning: 'оба верны в разное время',
            confidence: 0.9,
            provider: 'deepseek',
            costUsd: 0.001,
          },
          {
            stance: 'empathetic-supporter',
            verdict: 'evolving',
            reasoning: 'смена с даты',
            confidence: 0.9,
            provider: 'openai-via-proxy',
            costUsd: 0.001,
          },
          {
            stance: 'neutral-judge',
            verdict: 'evolving',
            reasoning: 'эволюция знания',
            confidence: 0.9,
            provider: 'deepseek',
            costUsd: 0.001,
          },
        ],
        consensusType: 'unanimous',
      }),
    );

    const res = await cron.runForOrg('t-1');

    expect(res.leftOpen).toBe(1);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(incConflictArbiterMock).toHaveBeenCalledWith({
      verdict: 'evolving',
      outcome: 'left_open',
    });
  });

  it('avg confidence 0.5 < 0.7 → resolve НЕ вызван', async () => {
    judgeMock.mockResolvedValue(
      verdict({
        votes: [
          {
            stance: 'strict-critic',
            verdict: 'accept_new',
            reasoning: 'слабо уверен',
            confidence: 0.5,
            provider: 'deepseek',
            costUsd: 0.001,
          },
          {
            stance: 'empathetic-supporter',
            verdict: 'accept_new',
            reasoning: 'слабо уверен',
            confidence: 0.5,
            provider: 'openai-via-proxy',
            costUsd: 0.001,
          },
          {
            stance: 'neutral-judge',
            verdict: 'keep_old',
            reasoning: 'против',
            confidence: 0.9,
            provider: 'deepseek',
            costUsd: 0.001,
          },
        ],
      }),
    );

    const res = await cron.runForOrg('t-1');

    expect(res.leftOpen).toBe(1);
    expect(resolveMock).not.toHaveBeenCalled();
    expect(incConflictArbiterMock).toHaveBeenCalledWith({
      verdict: 'accept_new',
      outcome: 'left_open',
    });
  });

  it('гейт: conflictArbiterEnabled=false → judge НЕ вызывается вообще', async () => {
    const disabledCron = buildCron(makeCfg({ conflictArbiterEnabled: false }));

    const res = await disabledCron.runForAllOrgs();

    expect(res.enabled).toBe(false);
    expect(judgeMock).not.toHaveBeenCalled();
    expect(conflictFindManyMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('ошибка judge на 1-м конфликте → 2-й конфликт всё равно обработан', async () => {
    conflictFindManyMock.mockResolvedValue([
      conflictItem({ id: 'c-1' }),
      conflictItem({ id: 'c-2' }),
    ]);
    judgeMock
      .mockRejectedValueOnce(new Error('llm boom'))
      .mockResolvedValueOnce(verdict());

    const res = await cron.runForOrg('t-1');

    expect(res.errors).toBe(1);
    expect(res.autoResolved).toBe(1);
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({ conflictId: 'c-2' }),
    );
    expect(incConflictArbiterMock).toHaveBeenCalledWith({
      verdict: 'unknown',
      outcome: 'error',
    });
  });

  it('нет CardVersion одной из карточек → конфликт пропущен без дебата', async () => {
    cardVersionFindFirstMock
      .mockResolvedValueOnce({ payload: { title: 'есть' } })
      .mockResolvedValueOnce(null);

    const res = await cron.runForOrg('t-1');

    expect(res.skipped).toBe(1);
    expect(judgeMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('runForAllOrgs: ошибка одного Org не валит проход', async () => {
    // 1-й вызов findMany — distinct по тенантам; затем батч только для t-2
    // (t-1 падает на org.findUnique до батч-запроса).
    conflictFindManyMock
      .mockResolvedValueOnce([{ tenantId: 't-1' }, { tenantId: 't-2' }])
      .mockResolvedValueOnce([conflictItem({ id: 'c-2', tenantId: 't-2' })]);
    orgFindUniqueMock.mockImplementation(
      async (args: { where: { id: string } }) => {
        if (args.where.id === 't-1') throw new Error('db boom');
        return { ownerId: 'owner-2' };
      },
    );

    const res = await cron.runForAllOrgs();

    expect(res.scannedOrgs).toBe(2);
    expect(res.errors).toBe(1);
    expect(res.autoResolved).toBe(1);
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-2', reviewerUserId: 'owner-2' }),
    );
  });
});
