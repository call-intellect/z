import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { AiChatQuotaService } from '../../ai-chat-quota/ai-chat-quota.service';

import { ClonesService } from './clones.service';

const TENANT_ID = 'tenant-1';
const PERSON_ID = 'person-cuid-1';
const REQUESTER_ID = 'user-requester-1';
const QUESTION = 'Как ты подходишь к оценке сроков?';

type TopicDensityResult = {
  refused: boolean;
  matchedBlocks: number;
  requiredBlocks: number;
  similarityThreshold: number;
};

function cloneBlock(id: string) {
  return {
    id,
    text: `текст блока ${id}`,
    meetingId: null,
    meetingTitle: null,
    startMs: null,
    endMs: null,
    snippet: null,
  };
}

function buildAskService(opts?: {
  groundingEnabled?: boolean;
  llmText?: string;
  topicRefused?: boolean;
  cloneQueryLogCreate?: ReturnType<typeof vi.fn>;
  cloneV2Enabled?: boolean;
}) {
  const cloneQueryLogCreate = opts?.cloneQueryLogCreate ?? vi.fn(async () => ({ id: 'log-1' }));

  const prisma = {
    skillProfile: {
      findUnique: vi.fn(async () => ({
        id: 'profile-1',
        status: 'active',
        person: {
          id: PERSON_ID,
          name: 'Анна Петрова',
          userId: 'user-bearer-1',
          relationship: 'employee',
        },
        traits: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      })),
    },
    executablePersona: {
      findFirst: vi.fn(async () => ({
        id: 'persona-1',
        version: 3,
        personaPrompt: 'persona-prompt',
        currentBearerPersonId: null,
      })),
    },
    cloneQueryLog: {
      create: cloneQueryLogCreate,
    },
  } as unknown as PrismaService;

  const aiChatQuota = {
    tryConsume: vi.fn(async () => undefined),
  } as unknown as AiChatQuotaService;

  const cfg = {
    skill: {
      cloneRespondGroundingEnabled: opts?.groundingEnabled ?? true,
      cloneTopicMinBlocks: 2,
      cloneTopicSimilarityThreshold: 0.7,
    },
    knowledgeAccess: { enforcement: 'off' },
    cloneV2: { enabled: opts?.cloneV2Enabled ?? false },
  } as unknown as TypedConfigService;

  const llmCall = vi.fn(async () => ({
    text: opts?.llmText ?? 'Ответ без единой цитаты.',
    modelUsed: 'test-model',
    inputTokens: 10,
    outputTokens: 20,
    tier: null,
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const incCloneAsk = vi.fn();
  const incCloneAskByOwner = vi.fn();
  const incCloneAskRefused = vi.fn();
  const metrics = {
    incCloneAsk,
    incCloneAskByOwner,
    incCloneAskRefused,
  } as unknown as BusinessMetricsService;

  const svc = new ClonesService(
    prisma,
    aiChatQuota,
    cfg,
    llm,
    metrics,
    undefined as never,
    undefined as never,
    undefined as never,
    null,
    undefined as never,
    undefined as never,
  );

  const anySvc = svc as unknown as Record<string, unknown>;
  anySvc.canAccessPersonClone = vi.fn(async () => ({ allowed: true }));
  anySvc.loadPersonSubgraph = vi.fn(async () => ({
    reasoningBlocks: [cloneBlock('b1'), cloneBlock('b2')],
    knowledgeProfileSummary: null,
    decisions: [],
  }));
  anySvc.assertTopicDensity = vi.fn(
    async (): Promise<TopicDensityResult> =>
      opts?.topicRefused
        ? {
            refused: true,
            matchedBlocks: 0,
            requiredBlocks: 2,
            similarityThreshold: 0.7,
          }
        : {
            refused: false,
            matchedBlocks: 2,
            requiredBlocks: 2,
            similarityThreshold: 0.7,
          },
  );
  const persistMessage = vi.fn(async () => ({
    conversationId: 'conv-1',
    messageId: 'msg-1',
  }));
  anySvc.persistMessage = persistMessage;

  return {
    svc,
    mocks: {
      cloneQueryLogCreate,
      persistMessage,
      incCloneAsk,
      incCloneAskByOwner,
      incCloneAskRefused,
      llmCall,
    },
  };
}

function ask(svc: ClonesService) {
  return svc.askPerson({
    tenantId: TENANT_ID,
    requesterUserId: REQUESTER_ID,
    personId: PERSON_ID,
    question: QUESTION,
  });
}

describe('ClonesService Э0.1 — пост-LLM grounding-гейт', () => {
  it('ответ LLM без [BLOCK]-цитат при включённом флаге → программный отказ ungrounded (LLM-текст НЕ возвращается)', async () => {
    const { svc, mocks } = buildAskService({
      groundingEnabled: true,
      llmText: 'Правдоподобный ответ без единой опоры на контекст.',
    });

    const res = await ask(svc);

    expect(res.refused).toBe(true);
    expect(res.refusalReason).toBe('ungrounded');
    expect(res.text).toBe(ClonesService.UNGROUNDED_REFUSAL_TEXT);
    expect(res.text).not.toContain('Правдоподобный ответ');
    expect(res.citations).toEqual([]);
    expect(mocks.incCloneAskRefused).toHaveBeenCalledWith({
      reason: 'ungrounded',
    });
    expect(mocks.incCloneAsk).toHaveBeenCalledWith({ scope: 'person' });
    expect(mocks.persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: ClonesService.UNGROUNDED_REFUSAL_TEXT,
        llmMeta: expect.objectContaining({
          refused: true,
          refusalReason: 'ungrounded',
        }),
      }),
    );
    expect(mocks.cloneQueryLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          cloneScope: 'person',
          cloneTargetId: PERSON_ID,
          userId: REQUESTER_ID,
          answeredGrounded: false,
          refusalReason: 'ungrounded',
        }),
      }),
    );
  });

  it('ответ с валидной [BLOCK:id]-цитатой → обычный ответ + CloneQueryLog(answeredGrounded=true)', async () => {
    const { svc, mocks } = buildAskService({
      groundingEnabled: true,
      llmText: 'Опираюсь на опыт [BLOCK:b1] — сроки без замеров не даю.',
    });

    const res = await ask(svc);

    expect(res.refused).toBeFalsy();
    expect(res.text).toContain('Опираюсь на опыт');
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations[0]).toEqual(expect.objectContaining({ blockId: 'b1' }));
    expect(mocks.incCloneAskRefused).not.toHaveBeenCalled();
    expect(mocks.cloneQueryLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answeredGrounded: true,
          refusalReason: null,
          questionPreview: QUESTION,
        }),
      }),
    );
  });

  it('kill-switch OFF → ответ без цитат проходит как раньше (refused нет)', async () => {
    const { svc, mocks } = buildAskService({
      groundingEnabled: false,
      llmText: 'Ответ без цитат при выключенном гейте.',
    });

    const res = await ask(svc);

    expect(res.refused).toBeFalsy();
    expect(res.text).toBe('Ответ без цитат при выключенном гейте.');
    expect(mocks.incCloneAskRefused).not.toHaveBeenCalled();
    expect(mocks.cloneQueryLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answeredGrounded: false,
          refusalReason: null,
        }),
      }),
    );
  });

  it('topic_starved-путь → CloneQueryLog с refusalReason=topic_starved', async () => {
    const { svc, mocks } = buildAskService({ topicRefused: true });

    const res = await ask(svc);

    expect(res.refused).toBe(true);
    expect(res.refusalReason).toBe('topic_starved');
    expect(res.text).toBe(ClonesService.TOPIC_STARVED_REFUSAL_TEXT);
    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.cloneQueryLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answeredGrounded: false,
          refusalReason: 'topic_starved',
        }),
      }),
    );
  });

  it('prisma.cloneQueryLog.create бросает → ответ всё равно возвращается (best-effort, warn не throw)', async () => {
    const { svc } = buildAskService({
      llmText: 'Опираюсь [BLOCK:b1].',
      cloneQueryLogCreate: vi.fn(async () => {
        throw new Error('db down');
      }),
    });

    const res = await ask(svc);

    expect(res.text).toContain('Опираюсь');
    expect(res.refused).toBeFalsy();
    expect(res.conversationId).toBe('conv-1');
  });
});

describe('ClonesService Э0.1 — judgmental-режим НЕ попадает под grounding-гейт', () => {
  it('v2-путь (askPersonV2), mode=judgmental, 0 цитат → НЕ refused, text = LLM-текст', async () => {
    const llmText = 'Рассуждение по аналогии без единой цитаты-опоры.';
    const { svc, mocks } = buildAskService({
      groundingEnabled: true,
      cloneV2Enabled: true,
      llmText,
    });
    const anySvc = svc as unknown as Record<string, unknown>;
    anySvc.rbac = {
      canAccessPersonClone: vi.fn(async () => ({ allowed: true })),
    };
    anySvc.runDialogLayer = vi.fn(async () => ({
      standaloneQuestion: QUESTION,
      intent: 'exploratory',
      queries: [QUESTION],
      confidence: 0.9,
    }));
    anySvc.retrievePracticeSkills = vi.fn(async () => []);
    anySvc.recordPracticeSkillUsages = vi.fn(async () => undefined);

    const res = await ask(svc);

    expect(res.refused).toBeFalsy();
    expect(res.text).toBe(llmText);
    expect(res.citations).toEqual([]);
    expect(mocks.incCloneAskRefused).not.toHaveBeenCalled();
    expect(mocks.persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: llmText,
        llmMeta: expect.objectContaining({ mode: 'judgmental', cloneV2: true }),
      }),
    );
    expect(mocks.cloneQueryLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answeredGrounded: false,
          refusalReason: null,
        }),
      }),
    );
  });

  it('контраст хелпера: isUngrounded([], judgmental)=false, isUngrounded([], factual)=true при флаге ON', () => {
    const { svc } = buildAskService({ groundingEnabled: true });
    const isUngrounded = (
      svc as unknown as {
        isUngrounded: (citations: unknown[], mode: 'factual' | 'judgmental') => boolean;
      }
    ).isUngrounded.bind(svc);

    expect(isUngrounded([], 'judgmental')).toBe(false);
    expect(isUngrounded([], 'factual')).toBe(true);
  });
});

describe('ClonesService Э0.1 — listQueryLog (журнал владельца)', () => {
  it('фильтрует по tenantId (+опц. cloneTargetId) и мапит строки в DTO с ISO-датой', async () => {
    const createdAt = new Date('2026-06-12T10:00:00.000Z');
    const findMany = vi.fn(async () => [
      {
        id: 'log-1',
        tenantId: TENANT_ID,
        cloneScope: 'role' as const,
        cloneTargetId: 'role-1',
        userId: REQUESTER_ID,
        questionPreview: 'вопрос…',
        questionHash: 'hash',
        answeredGrounded: false,
        refusalReason: 'ungrounded',
        createdAt,
      },
    ]);
    const count = vi.fn(async () => 1);
    const prisma = {
      cloneQueryLog: { findMany, count },
    } as unknown as PrismaService;

    const svc = new ClonesService(
      prisma,
      undefined as never,
      {} as unknown as TypedConfigService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      null,
      undefined as never,
      undefined as never,
    );

    const res = await svc.listQueryLog({
      tenantId: TENANT_ID,
      limit: 50,
      offset: 0,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_ID },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      }),
    );
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT_ID } }));
    expect(res.total).toBe(1);
    expect(res.items).toEqual([
      {
        id: 'log-1',
        cloneScope: 'role',
        cloneTargetId: 'role-1',
        userId: REQUESTER_ID,
        questionPreview: 'вопрос…',
        answeredGrounded: false,
        refusalReason: 'ungrounded',
        createdAt: '2026-06-12T10:00:00.000Z',
      },
    ]);
  });

  it('cloneTargetId-фильтр попадает в where', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const prisma = {
      cloneQueryLog: { findMany, count },
    } as unknown as PrismaService;

    const svc = new ClonesService(
      prisma,
      undefined as never,
      {} as unknown as TypedConfigService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      null,
      undefined as never,
      undefined as never,
    );

    await svc.listQueryLog({
      tenantId: TENANT_ID,
      cloneTargetId: 'role-1',
      limit: 10,
      offset: 5,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_ID, cloneTargetId: 'role-1' },
        take: 10,
        skip: 5,
      }),
    );
  });
});
