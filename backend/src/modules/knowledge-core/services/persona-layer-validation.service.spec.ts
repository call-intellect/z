import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { PersonaLayerValidationService } from './persona-layer-validation.service';

const TENANT_ID = 'tenant-1';
const ROLE_ID = 'role-1';

const V1_PERSONA_MARKER = 'V1-BASELINE-PERSONA';
const V2_PERSONA_MARKER = 'V2-PERSONA-ВСЕ-СЛОИ';

const V1_PERSONA_TEXT = `${V1_PERSONA_MARKER}: я обычно сначала собираю данные, потом эскалирую владельцу с вариантами, затем режу scope.`;

function buildService(opts?: { hasPersona?: boolean; blockCount?: number; judgeText?: string }) {
  const hasPersona = opts?.hasPersona ?? true;
  const blockCount = opts?.blockCount ?? 6;
  const blockIds = Array.from({ length: blockCount }, (_, i) => `b${i + 1}`);

  const mentionsFindMany = vi.fn(async () => blockIds.map((id) => ({ blockId: id })));
  const ideaBlockFindMany = vi.fn(async () =>
    blockIds.map((id) => ({
      id,
      name: `блок ${id}`,
      criticalQuestion: `что делать при ${id}?`,
      trustedAnswer: `реальный ход ${id}: сначала эскалация с вариантами, потом резать scope`,
    })),
  );

  const personaFindFirst = vi.fn(async () =>
    hasPersona
      ? {
          id: 'persona-v2',
          tenantId: TENANT_ID,
          scope: 'role',
          scopeRefId: ROLE_ID,
          version: 3,
          status: 'active',
          personaPrompt: V2_PERSONA_MARKER,
        }
      : null,
  );
  const personaUpdate = vi.fn(async () => ({ id: 'persona-v2' }));
  const personaUpdateMany = vi.fn(async () => ({ count: 0 }));

  const prisma = {
    executablePersona: {
      findFirst: personaFindFirst,
      update: personaUpdate,
      updateMany: personaUpdateMany,
    },
    role: {
      findUnique: vi.fn(async () => ({ name: 'Руководитель проектов' })),
    },
    personRole: {
      findMany: vi.fn(async () => [{ personId: 'p1' }]),
    },
    appointment: {
      findMany: vi.fn(async () => [{ personId: 'p1' }, { personId: 'p2' }]),
    },
    skillProfile: {
      findMany: vi.fn(async () => [
        {
          id: 'profile-1',
          person: { name: 'Иван', relationship: 'employee' },
          traits: [
            {
              category: 'оценка сроков',
              statement: 'Похоже, не даёт сроки без данных.',
              confidence: 'high',
              observationCount: 6,
            },
          ],
        },
      ]),
    },
    person: {
      findMany: vi.fn(async () => [{ entityId: 'e1' }, { entityId: 'e2' }]),
    },
    ideaBlockEntity: {
      findMany: mentionsFindMany,
    },
    ideaBlock: {
      findMany: ideaBlockFindMany,
    },
  } as unknown as PrismaService;

  const getDynamic = vi.fn(async (_key: string, _env?: string, def?: unknown) => def);
  const cfg = { getDynamic } as unknown as TypedConfigService;

  const llmCall = vi.fn(async (params: { taskType: string; userMessage: string }) => {
    const base = {
      modelUsed: 'deepseek:deepseek-v4-flash',
      tier: 'primary' as const,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      durationMs: 10,
    };
    if (params.taskType === 'executable-persona-compile') {
      return { ...base, text: V1_PERSONA_TEXT };
    }
    if (params.taskType === 'clone-respond') {
      return {
        ...base,
        text: 'Сначала эскалирую владельцу с 2 вариантами, потом режу scope.',
      };
    }
    if (params.taskType === 'persona-behavior-judge') {
      return {
        ...base,
        text:
          opts?.judgeText ??
          JSON.stringify({
            scoreA: 0.5,
            scoreB: 1,
            behaviorMatchA: 'направление верное, шаги другие',
            behaviorMatchB: 'ход по сути совпадает',
          }),
      };
    }
    throw new Error(`unexpected taskType: ${params.taskType}`);
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const observePersonaLayerScore = vi.fn();
  const incPersonaLayerValidationCase = vi.fn();
  const metrics = {
    observePersonaLayerScore,
    incPersonaLayerValidationCase,
  } as unknown as BusinessMetricsService;

  const svc = new PersonaLayerValidationService(prisma, cfg, llm, metrics);

  const warnSpy = vi.fn();
  (svc as unknown as { logger: unknown }).logger = {
    warn: warnSpy,
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  };

  return {
    svc,
    mocks: {
      llmCall,
      getDynamic,
      personaFindFirst,
      personaUpdate,
      personaUpdateMany,
      observePersonaLayerScore,
      incPersonaLayerValidationCase,
      warnSpy,
      mentionsFindMany,
      ideaBlockFindMany,
    },
  };
}

function run(svc: PersonaLayerValidationService) {
  return svc.validateRole({ tenantId: TENANT_ID, roleId: ROLE_ID });
}

function cloneRespondCalls(
  llmCall: ReturnType<typeof vi.fn>,
): Array<{ taskType: string; userMessage: string }> {
  return llmCall.mock.calls
    .map((c) => c[0] as { taskType: string; userMessage: string })
    .filter((p) => p.taskType === 'clone-respond');
}

describe('PersonaLayerValidationService ВАЛ.1 — поведенческая валидация persona v1-vs-v2', () => {
  it('happy-path: на каждый кейс 2 clone-respond (v1 и v2 в USER) + 1 judge → observePersonaLayerScore с variant v1 и v2', async () => {
    const { svc, mocks } = buildService();

    const res = await run(svc);

    expect(res).toEqual({ cases: 3, avgV1: 0.5, avgV2: 1, skipped: null });
    expect(mocks.getDynamic).toHaveBeenCalledWith(
      'knowledge.personaValidationCasesPerRole',
      undefined,
      3,
    );

    const calls = mocks.llmCall.mock.calls.map(
      (c) => c[0] as { taskType: string; userMessage: string },
    );
    expect(calls.filter((p) => p.taskType === 'executable-persona-compile')).toHaveLength(1);
    const respond = calls.filter((p) => p.taskType === 'clone-respond');
    expect(respond).toHaveLength(6);
    expect(calls.filter((p) => p.taskType === 'persona-behavior-judge')).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const [a, b] = respond.slice(i * 2, i * 2 + 2);
      expect(a?.userMessage).toContain(V1_PERSONA_MARKER);
      expect(a?.userMessage).not.toContain(V2_PERSONA_MARKER);
      expect(b?.userMessage).toContain(V2_PERSONA_MARKER);
      expect(b?.userMessage).not.toContain(V1_PERSONA_MARKER);
    }

    expect(mocks.observePersonaLayerScore).toHaveBeenCalledWith({
      variant: 'v1',
      score: 0.5,
    });
    expect(mocks.observePersonaLayerScore).toHaveBeenCalledWith({
      variant: 'v2',
      score: 1,
    });
    expect(mocks.observePersonaLayerScore).toHaveBeenCalledTimes(6);
    expect(mocks.incPersonaLayerValidationCase).toHaveBeenCalledTimes(3);
    expect(mocks.incPersonaLayerValidationCase).toHaveBeenCalledWith({
      outcome: 'judged',
    });
  });

  it('кейс-блоки ИСКЛЮЧЕНЫ из subgraph clone-respond вызовов (анти-подглядывание)', async () => {
    const { svc, mocks } = buildService();

    await run(svc);

    const respond = cloneRespondCalls(mocks.llmCall);
    expect(respond.length).toBeGreaterThan(0);
    for (const call of respond) {
      expect(call.userMessage).not.toContain('[BLOCK:b1]');
      expect(call.userMessage).not.toContain('[BLOCK:b2]');
      expect(call.userMessage).not.toContain('[BLOCK:b3]');
      expect(call.userMessage).toContain('[BLOCK:b4]');
      expect(call.userMessage).toContain('[BLOCK:b6]');
    }
  });

  it('нет active persona → skipped=no_persona, LLM НЕ вызван', async () => {
    const { svc, mocks } = buildService({ hasPersona: false });

    const res = await run(svc);

    expect(res).toEqual({
      cases: 0,
      avgV1: null,
      avgV2: null,
      skipped: 'no_persona',
    });
    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.observePersonaLayerScore).not.toHaveBeenCalled();
  });

  it('judge вернул битый JSON → кейс пропущен (counter skipped), не throw', async () => {
    const { svc, mocks } = buildService({ judgeText: 'это не JSON' });

    const res = await run(svc);

    expect(res).toEqual({ cases: 0, avgV1: null, avgV2: null, skipped: null });
    expect(mocks.incPersonaLayerValidationCase).toHaveBeenCalledTimes(3);
    expect(mocks.incPersonaLayerValidationCase).toHaveBeenCalledWith({
      outcome: 'skipped',
    });
    expect(mocks.observePersonaLayerScore).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalled();
  });

  it('R10 — НЕТ блокирующих действий: executablePersona.update/updateMany не вызывались', async () => {
    const { svc, mocks } = buildService();

    await run(svc);

    expect(mocks.personaUpdate).not.toHaveBeenCalled();
    expect(mocks.personaUpdateMany).not.toHaveBeenCalled();
  });

  it('Б19: кейсы берутся свежими сверху — mentions БЕЗ take, ideaBlock с take:30 + orderBy createdAt desc', async () => {
    const { svc, mocks } = buildService();

    await run(svc);

    const mentionsArg = (mocks.mentionsFindMany.mock.calls[0] as unknown[])[0] as {
      take?: number;
    };
    expect(mentionsArg.take).toBeUndefined();

    const blockArg = (mocks.ideaBlockFindMany.mock.calls[0] as unknown[])[0] as {
      take?: number;
      orderBy?: unknown;
    };
    expect(blockArg.take).toBe(30);
    expect(blockArg.orderBy).toEqual({ createdAt: 'desc' });
  });
});
