import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import type { AnthropicService } from './anthropic.service';
import type { DeepSeekService } from './deepseek.service';
import type { GrsaiService } from './grsai.service';
import type { KieService } from './kie.service';
import {
  type LlmCallParams,
  LlmRouterAllProvidersFailedError,
  LlmRouterService,
  type LlmTaskType,
} from './llm-router.service';
import type { LlmCompleteOutput } from './llm.types';
import type { MinimaxService } from './minimax.service';
import type { OllamaService } from './ollama.service';
import type { OpenAiProxyService } from './openai-proxy.service';
import type { ProviderInfoResolver } from './protocol-adapter/provider-info.resolver';

function makeOutput(provider: LlmCompleteOutput['provider'], model = 'm-test'): LlmCompleteOutput {
  return {
    text: `text-${provider}`,
    inputTokens: 100,
    outputTokens: 20,
    model,
    provider,
  };
}

interface ExperimentFixture {
  id: string;
  tenantId: string | null;
  taskType: string;
  controlModel: string;
  controlProvider: string;
  variantModel: string;
  variantProvider: string;
  splitPercent: number;
  status: string;
  startedAt: Date | null;
  endsAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  notes: string | null;
}

function makeExperiment(
  overrides: Partial<ExperimentFixture> & { taskType: string },
): ExperimentFixture {
  const now = Date.now();
  return {
    id: overrides.id ?? 'exp-1',
    tenantId: overrides.tenantId ?? null,
    taskType: overrides.taskType,
    controlModel: overrides.controlModel ?? 'MiniMax-M2.5',
    controlProvider: overrides.controlProvider ?? 'minimax',
    variantModel: overrides.variantModel ?? 'deepseek-v4-flash',
    variantProvider: overrides.variantProvider ?? 'deepseek',
    splitPercent: overrides.splitPercent ?? 50,
    status: overrides.status ?? 'running',
    startedAt: overrides.startedAt ?? new Date(now - 60_000),
    endsAt: overrides.endsAt ?? new Date(now + 3_600_000),
    createdById: overrides.createdById ?? 'admin-1',
    createdAt: overrides.createdAt ?? new Date(now - 60_000),
    updatedAt: overrides.updatedAt ?? new Date(now - 60_000),
    notes: overrides.notes ?? null,
  };
}

interface GepaCandidateFixture {
  promptKey: string;
  tenantId: string | null;
  promptText: string;
  abTrafficShare: number;
}

interface BuildOpts {
  routes?: Array<{ taskType: string; providers: string[]; isActive: boolean }>;
  experiments?: ExperimentFixture[];
  gepaCandidates?: GepaCandidateFixture[];
  anthropic?: ReturnType<typeof vi.fn>;
  minimax?: ReturnType<typeof vi.fn>;
  openai?: ReturnType<typeof vi.fn>;
  deepseek?: ReturnType<typeof vi.fn>;
  ollama?: ReturnType<typeof vi.fn>;
  cfg?: { getDynamic: ReturnType<typeof vi.fn> };
}

function build(opts: BuildOpts) {
  const findMany = vi.fn(async () =>
    (opts.routes ?? []).map((r, i) => ({
      id: `r-${i}`,
      taskType: r.taskType,
      providers: r.providers,
      isActive: r.isActive,
      tenantId: null,
      experiment: null,
      updatedAt: new Date(),
    })),
  );
  const findFirst = vi.fn(async () => null);
  const create = vi.fn(
    async (args: { data: { taskType: string; providers: string[]; isActive: boolean } }) => ({
      id: 'r-new',
      taskType: args.data.taskType,
      providers: args.data.providers,
      isActive: args.data.isActive,
      tenantId: null,
      experiment: null,
      updatedAt: new Date(),
    }),
  );
  const update = vi.fn();
  const priceFindFirst = vi.fn(async () => null);
  const experimentFindMany = vi.fn(
    async (args?: { where?: { tenantId?: string | null; status?: string } }) =>
      (opts.experiments ?? []).filter((e) => {
        if (args?.where?.tenantId !== undefined && (e.tenantId ?? null) !== args.where.tenantId) {
          return false;
        }
        if (args?.where?.status !== undefined && e.status !== args.where.status) {
          return false;
        }
        return true;
      }),
  );
  const promptCandidateFindMany = vi.fn(async () => opts.gepaCandidates ?? []);
  const prisma = {
    llmTaskRoute: { findMany, findFirst, create, update },
    llmModelPrice: { findFirst: priceFindFirst },
    llmModelExperiment: { findMany: experimentFindMany },
    promptCandidate: { findMany: promptCandidateFindMany },
  } as unknown as PrismaService;

  const anthropic = {
    complete: opts.anthropic ?? vi.fn(async () => makeOutput('anthropic', 'claude-sonnet-4-6')),
  } as unknown as AnthropicService;
  const minimax = {
    complete: opts.minimax ?? vi.fn(async () => makeOutput('minimax', 'MiniMax-M2.5')),
  } as unknown as MinimaxService;
  const openai = {
    complete: opts.openai ?? vi.fn(async () => makeOutput('openai-via-proxy', 'gpt-5-mini')),
  } as unknown as OpenAiProxyService;
  const deepseek = {
    complete: opts.deepseek ?? vi.fn(async () => makeOutput('deepseek', 'deepseek-v4-flash')),
  } as unknown as DeepSeekService;
  const ollama = {
    complete: opts.ollama ?? vi.fn(async () => makeOutput('ollama', 'qwen3:30b-a3b-instruct-2507')),
  } as unknown as OllamaService;
  const kie = {
    complete: vi.fn(async () => makeOutput('kie', 'gemini-3-pro')),
  } as unknown as KieService;
  const grsai = {
    complete: vi.fn(async () => makeOutput('grsai', 'gemini-3-pro')),
  } as unknown as GrsaiService;

  const usageRecord = vi.fn();
  const usage = { record: usageRecord } as unknown as AiUsageLogService;
  const incLlmRouterDispatch = vi.fn();
  const incCoreDataClassViolation = vi.fn();
  const metrics = {
    incLlmRouterDispatch,
    incCoreDataClassViolation,
  } as unknown as BusinessMetricsService;

  const router = new LlmRouterService(
    prisma,
    anthropic,
    minimax,
    openai,
    deepseek,
    ollama,
    kie,
    grsai,
    usage,
    metrics,
    opts.cfg as unknown as TypedConfigService | undefined,
  );
  return {
    router,
    findMany,
    findFirst,
    create,
    update,
    experimentFindMany,
    anthropic,
    minimax,
    openai,
    deepseek,
    ollama,
    usageRecord,
    incLlmRouterDispatch,
  };
}

/**
 * `chooseProviders` — приватный метод; для юнит-теста sticky-split обходим
 * TS-приватность прямым вызовом (route всегда `undefined` — легаси-ветка
 * удалена в Фазе 1 ТЗ 2026-07-03, chooseProviders больше не читает route).
 */
async function callChooseProviders(
  router: LlmRouterService,
  params: Partial<LlmCallParams> & { taskType: LlmTaskType },
): Promise<{ providers: Array<{ provider: string; model?: string }>; experimentGroup: 'A' | 'B' | null }> {
  const fn = (
    router as unknown as {
      chooseProviders: (
        route: undefined,
        params: LlmCallParams,
      ) => Promise<{
        providers: Array<{ provider: string; model?: string }>;
        experimentGroup: 'A' | 'B' | null;
      }>;
    }
  ).chooseProviders.bind(router);
  return fn(undefined, {
    systemPrompt: '',
    userMessage: '',
    tenantId: null,
    ...params,
  } as LlmCallParams);
}

describe('LlmRouterService', () => {
  const baseParams = {
    systemPrompt: 'sys',
    userMessage: 'u',
    tenantId: null as string | null,
  };

  it('использует первый provider из route, если он есть', async () => {
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['minimax', 'anthropic'], isActive: true }],
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'chapters' as LlmTaskType,
    });

    expect(ctx.minimax.complete).toHaveBeenCalledOnce();
    expect(ctx.anthropic.complete).not.toHaveBeenCalled();
    expect(out.modelUsed).toBe('minimax:MiniMax-M2.5');
    expect(ctx.usageRecord).toHaveBeenCalledOnce();
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'minimax', status: 'success' }),
    );
  });

  it('fallback: первый упал → второй сработал', async () => {
    const failingMinimax = vi.fn(async () => {
      throw new Error('boom-minimax');
    });
    const ctx = build({
      routes: [
        { taskType: 'chapters', providers: ['minimax', 'openai-via-proxy'], isActive: true },
      ],
      minimax: failingMinimax,
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'chapters' as LlmTaskType,
    });

    expect(ctx.minimax.complete).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('openai-via-proxy:gpt-5-mini');
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'minimax', status: 'fallback' }),
    );
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai-via-proxy', status: 'success' }),
    );
  });

  it('все упали → LlmRouterAllProvidersFailedError + status=failed на последнем', async () => {
    const fail = vi.fn(async () => {
      throw new Error('boom');
    });
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['anthropic', 'minimax'], isActive: true }],
      anthropic: fail,
      minimax: fail,
    });
    await ctx.router.refreshCache();

    await expect(
      ctx.router.call({ ...baseParams, taskType: 'chapters' as LlmTaskType }),
    ).rejects.toBeInstanceOf(LlmRouterAllProvidersFailedError);
    const failedCall = ctx.incLlmRouterDispatch.mock.calls.find(
      (c) => (c[0] as { status: string }).status === 'failed',
    );
    expect(failedCall?.[0]).toMatchObject({ provider: 'minimax', status: 'failed' });
  });

  it('validate=false для primary → переключение на secondary (ТЗ-3 Ф2)', async () => {
    const ctx = build({
      routes: [
        { taskType: 'chapters', providers: ['minimax', 'openai-via-proxy'], isActive: true },
      ],
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'chapters' as LlmTaskType,
      validate: (text) => text === 'text-openai-via-proxy',
    });

    expect(ctx.minimax.complete).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('openai-via-proxy:gpt-5-mini');
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'minimax', status: 'invalid_output' }),
    );
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai-via-proxy', status: 'success' }),
    );
    expect(ctx.usageRecord).toHaveBeenCalledOnce();
    expect(ctx.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai-via-proxy', success: true }),
    );
  });

  it('validate=false для всех → call() бросает (как при падении всех провайдеров)', async () => {
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['anthropic', 'minimax'], isActive: true }],
    });
    await ctx.router.refreshCache();

    await expect(
      ctx.router.call({
        ...baseParams,
        taskType: 'chapters' as LlmTaskType,
        validate: () => false,
      }),
    ).rejects.toBeInstanceOf(LlmRouterAllProvidersFailedError);

    expect(ctx.anthropic.complete).toHaveBeenCalledOnce();
    expect(ctx.minimax.complete).toHaveBeenCalledOnce();
    const invalidCalls = ctx.incLlmRouterDispatch.mock.calls.filter(
      (c) => (c[0] as { status: string }).status === 'invalid_output',
    );
    expect(invalidCalls).toHaveLength(2);
    const successCalls = ctx.incLlmRouterDispatch.mock.calls.filter(
      (c) => (c[0] as { status: string }).status === 'success',
    );
    expect(successCalls).toHaveLength(0);
  });

  it('нет route → используется дефолтная цепочка [deepseek, openai-via-proxy, kie:gemini-3.1-pro]', async () => {
    const ctx = build({ routes: [] });
    await ctx.router.refreshCache();
    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'tasks' as LlmTaskType,
    });
    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
    expect(out.modelUsed).toBe('deepseek:deepseek-v4-flash');
  });

  it('Ф6: нет route + llm.router.defaultChain задан через AdminSetting → используется он, не DEFAULT_FALLBACK_CHAIN', async () => {
    const getDynamic = vi.fn(async () => [{ provider: 'ollama' }]);
    const ctx = build({ routes: [], cfg: { getDynamic } });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'tasks' as LlmTaskType,
    });

    expect(getDynamic).toHaveBeenCalledWith(
      'llm.router.defaultChain',
      undefined,
      expect.any(Array),
    );
    expect(ctx.ollama.complete).toHaveBeenCalledOnce();
    expect(ctx.deepseek.complete).not.toHaveBeenCalled();
    expect(out.modelUsed).toBe('ollama:qwen3:30b-a3b-instruct-2507');
  });

  it('isActive=false → route игнорируется, используется дефолт', async () => {
    const ctx = build({
      routes: [{ taskType: 'chapters', providers: ['minimax'], isActive: false }],
    });
    await ctx.router.refreshCache();
    await ctx.router.call({
      ...baseParams,
      taskType: 'chapters' as LlmTaskType,
    });
    expect(ctx.minimax.complete).not.toHaveBeenCalled();
    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
  });

  it('AiUsageLog пишется на success', async () => {
    const ctx = build({});
    await ctx.router.refreshCache();
    await ctx.router.call({
      ...baseParams,
      taskType: 'summary' as LlmTaskType,
      meetingId: 'm-1',
      userId: 'u-1',
      jobId: 'j-1',
    });
    expect(ctx.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'm-1',
        agentType: 'summary',
        provider: 'deepseek',
        success: true,
        inputTokens: 100,
        outputTokens: 20,
      }),
    );
  });

  it('setRoute: создаёт новую запись + инвалидация кэша', async () => {
    const ctx = build({});
    await ctx.router.refreshCache();
    await ctx.router.setRoute({
      taskType: 'tasks' as LlmTaskType,
      providers: ['minimax'],
      isActive: true,
    });
    expect(ctx.findFirst).toHaveBeenCalledOnce();
    expect(ctx.create).toHaveBeenCalledOnce();
    expect(ctx.findMany).toHaveBeenCalledTimes(2);
  });

  it('setRoute: без валидных провайдеров → ошибка', async () => {
    const ctx = build({});
    await expect(
      ctx.router.setRoute({
        taskType: 'tasks' as LlmTaskType,
        providers: ['unknown' as never],
        isActive: true,
      }),
    ).rejects.toThrow();
  });

  it('dataClass=private: deepseek eligible и диспатчится первым (Б1 — поднят до private)', async () => {
    const ctx = build({
      routes: [
        {
          taskType: 'chat-v2',
          providers: ['deepseek', 'openai-via-proxy', 'kie'],
          isActive: true,
        },
      ],
    });
    await ctx.router.refreshCache();

    const out = await ctx.router.call({
      ...baseParams,
      taskType: 'chat-v2' as LlmTaskType,
      dataClass: 'private',
    });

    expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
    expect(ctx.openai.complete).not.toHaveBeenCalled();
    expect(out.modelUsed.startsWith('deepseek:')).toBe(true);
    expect(ctx.incLlmRouterDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'deepseek', status: 'success' }),
    );
  });

  // Ф3 (2026-07-02): dataClass-фильтр перешёл с providers.filter(...) на
  // асинхронный for-цикл (resolveProviderCapability читает DB при включённом
  // реестре). Роутер в этих тестах строится БЕЗ cfg/adapterRegistry/providerInfo
  // (isRegistryActive()===false) — поведение должно остаться байт-в-байт
  // идентичным старому синхронному .filter() по хардкод-карте PROVIDER_CAPABILITY.
  describe('dataClass-фильтр: filter→for-loop не меняет состав/порядок (регресс, реестр выключен)', () => {
    it('dataClass=sensitive: только anthropic проходит (minimax=internal отсекается)', async () => {
      const ctx = build({
        routes: [
          {
            taskType: 'chapters',
            providers: ['minimax', 'anthropic'],
            isActive: true,
          },
        ],
      });
      await ctx.router.refreshCache();

      const out = await ctx.router.call({
        ...baseParams,
        taskType: 'chapters' as LlmTaskType,
        dataClass: 'sensitive',
      });

      expect(ctx.anthropic.complete).toHaveBeenCalledOnce();
      expect(ctx.minimax.complete).not.toHaveBeenCalled();
      expect(out.modelUsed.startsWith('anthropic:')).toBe(true);
    });

    it('dataClass=private без покрывающего провайдера: гейт НЕ блокирует — dispatch по всей цепочке', async () => {
      const ctx = build({
        routes: [{ taskType: 'chapters', providers: ['minimax'], isActive: true }],
      });
      await ctx.router.refreshCache();

      const out = await ctx.router.call({
        ...baseParams,
        taskType: 'chapters' as LlmTaskType,
        dataClass: 'private',
      });

      expect(ctx.minimax.complete).toHaveBeenCalledOnce();
      expect(out.modelUsed.startsWith('minimax:')).toBe(true);
    });

    it('dataClass не задан (internal по умолчанию): порядок providers сохраняется как раньше', async () => {
      const ctx = build({
        routes: [
          {
            taskType: 'chapters',
            providers: ['minimax', 'anthropic', 'ollama'],
            isActive: true,
          },
        ],
      });
      await ctx.router.refreshCache();

      const out = await ctx.router.call({
        ...baseParams,
        taskType: 'chapters' as LlmTaskType,
      });

      // Все 3 капабилити (internal/sensitive/private) >= public — первый в
      // цепочке (minimax) должен диспатчиться первым, без переупорядочивания.
      expect(ctx.minimax.complete).toHaveBeenCalledOnce();
      expect(ctx.anthropic.complete).not.toHaveBeenCalled();
      expect(out.modelUsed.startsWith('minimax:')).toBe(true);
    });
  });

  // ТЗ 2026-07-03 Фаза 1 — `chooseProviders()` читает `LlmModelExperiment`
  // вместо `LlmTaskRoute.experiment`, sticky-split по meetingId.
  describe('LlmModelExperiment sticky-split (ТЗ 2026-07-03, Фаза 1)', () => {
    it('R1: активный эксперимент переопределяет обычную цепочку LlmTaskRoute', async () => {
      const ctx = build({
        routes: [{ taskType: 'chapters', providers: ['anthropic'], isActive: true }],
        experiments: [
          makeExperiment({
            taskType: 'chapters',
            controlProvider: 'minimax',
            controlModel: 'MiniMax-M2.5',
            variantProvider: 'deepseek',
            variantModel: 'deepseek-v4-flash',
            splitPercent: 0,
          }),
        ],
      });
      await ctx.router.refreshCache();

      const out = await ctx.router.call({
        ...baseParams,
        taskType: 'chapters' as LlmTaskType,
        meetingId: 'm-1',
      });

      expect(ctx.minimax.complete).toHaveBeenCalledOnce();
      expect(ctx.anthropic.complete).not.toHaveBeenCalled();
      expect(out.modelUsed).toBe('minimax:MiniMax-M2.5');
      expect(ctx.usageRecord).toHaveBeenCalledWith(
        expect.objectContaining({ experimentGroup: 'A' }),
      );
    });

    it('R2: детерминированность — тот же meetingId даёт ту же группу при повторных вызовах', async () => {
      const ctx = build({
        experiments: [makeExperiment({ taskType: 'chapters', splitPercent: 50 })],
      });
      await ctx.router.refreshCache();

      const first = await callChooseProviders(ctx.router, {
        taskType: 'chapters' as LlmTaskType,
        meetingId: 'm-fixed',
      });
      const second = await callChooseProviders(ctx.router, {
        taskType: 'chapters' as LlmTaskType,
        meetingId: 'm-fixed',
      });
      const third = await callChooseProviders(ctx.router, {
        taskType: 'chapters' as LlmTaskType,
        meetingId: 'm-fixed',
      });

      expect(first.experimentGroup).not.toBeNull();
      expect(second.experimentGroup).toBe(first.experimentGroup);
      expect(third.experimentGroup).toBe(first.experimentGroup);
      expect(second.providers).toEqual(first.providers);
      expect(third.providers).toEqual(first.providers);
    });

    it('R3: распределение ~30% на 1000 разных meetingId (допуск 20-40%)', async () => {
      const ctx = build({
        experiments: [makeExperiment({ taskType: 'chapters', splitPercent: 30 })],
      });
      await ctx.router.refreshCache();

      let groupBCount = 0;
      for (let i = 0; i < 1000; i++) {
        const { experimentGroup } = await callChooseProviders(ctx.router, {
          taskType: 'chapters' as LlmTaskType,
          meetingId: `meeting-${i}`,
        });
        if (experimentGroup === 'B') groupBCount++;
      }

      const fraction = groupBCount / 1000;
      expect(fraction).toBeGreaterThanOrEqual(0.2);
      expect(fraction).toBeLessThanOrEqual(0.4);
    });

    it('R4 (regression): активный GEPA PromptCandidate перекрывает experimentGroup даже при активном LlmModelExperiment', async () => {
      const ctx = build({
        experiments: [
          makeExperiment({ taskType: 'chapters', splitPercent: 100, variantProvider: 'deepseek' }),
        ],
        gepaCandidates: [
          { promptKey: 'chapters', tenantId: null, promptText: 'GEPA-PROMPT', abTrafficShare: 1 },
        ],
      });
      await ctx.router.refreshCache();

      await ctx.router.call({
        ...baseParams,
        taskType: 'chapters' as LlmTaskType,
        meetingId: 'm-1',
      });

      expect(ctx.deepseek.complete).toHaveBeenCalledOnce();
      expect(ctx.usageRecord).toHaveBeenCalledWith(
        expect.objectContaining({ experimentGroup: 'gepa_candidate' }),
      );
    });

    it('без активного эксперимента для taskType — используется обычная цепочка LlmTaskRoute', async () => {
      const ctx = build({
        routes: [{ taskType: 'summary', providers: ['minimax'], isActive: true }],
        experiments: [makeExperiment({ taskType: 'chapters', splitPercent: 100 })],
      });
      await ctx.router.refreshCache();

      const out = await ctx.router.call({
        ...baseParams,
        taskType: 'summary' as LlmTaskType,
      });

      expect(ctx.minimax.complete).toHaveBeenCalledOnce();
      expect(ctx.deepseek.complete).not.toHaveBeenCalled();
      expect(out.modelUsed).toBe('minimax:MiniMax-M2.5');
      expect(ctx.usageRecord).toHaveBeenCalledWith(
        expect.objectContaining({ experimentGroup: null }),
      );
    });

    it('эксперимент вне окна [startedAt, endsAt) игнорируется', async () => {
      const ctx = build({
        routes: [{ taskType: 'chapters', providers: ['anthropic'], isActive: true }],
        experiments: [
          makeExperiment({
            taskType: 'chapters',
            startedAt: new Date(Date.now() - 2 * 3_600_000),
            endsAt: new Date(Date.now() - 3_600_000),
          }),
        ],
      });
      await ctx.router.refreshCache();

      const out = await ctx.router.call({
        ...baseParams,
        taskType: 'chapters' as LlmTaskType,
        meetingId: 'm-1',
      });

      expect(ctx.anthropic.complete).toHaveBeenCalledOnce();
      expect(ctx.minimax.complete).not.toHaveBeenCalled();
      expect(ctx.deepseek.complete).not.toHaveBeenCalled();
      expect(out.modelUsed.startsWith('anthropic:')).toBe(true);
    });
  });

  describe('taskTypeToAgentType (ТЗ 2026-07-03 analyze-worker-llm-router-migration, Фаза 1)', () => {
    function callTaskTypeToAgentType(router: LlmRouterService, taskType: LlmTaskType): string {
      const fn = (
        router as unknown as {
          taskTypeToAgentType: (taskType: LlmTaskType) => string;
        }
      ).taskTypeToAgentType.bind(router);
      return fn(taskType);
    }

    it('report-by-type → report-by-type', () => {
      const { router } = build({});
      expect(callTaskTypeToAgentType(router, 'report-by-type' as LlmTaskType)).toBe(
        'report-by-type',
      );
    });

    it('custom-prompt → custom', () => {
      const { router } = build({});
      expect(callTaskTypeToAgentType(router, 'custom-prompt' as LlmTaskType)).toBe('custom');
    });

    it('client-meeting-split → client_protocol', () => {
      const { router } = build({});
      expect(callTaskTypeToAgentType(router, 'client-meeting-split' as LlmTaskType)).toBe(
        'client_protocol',
      );
    });

    it('summary → summary (regression)', () => {
      const { router } = build({});
      expect(callTaskTypeToAgentType(router, 'summary' as LlmTaskType)).toBe('summary');
    });

    it('tasks → tasks (regression)', () => {
      const { router } = build({});
      expect(callTaskTypeToAgentType(router, 'tasks' as LlmTaskType)).toBe('tasks');
    });

    it('follow-up → follow-up (regression)', () => {
      const { router } = build({});
      expect(callTaskTypeToAgentType(router, 'follow-up' as LlmTaskType)).toBe('follow-up');
    });

    it('неизвестный taskType → custom (default)', () => {
      const { router } = build({});
      expect(callTaskTypeToAgentType(router, 'chapters' as LlmTaskType)).toBe('custom');
    });
  });

  describe('computeCostUsd — billingMode=subscription bypass (ТЗ 2026-07-06 llm-provider-subscription-billing)', () => {
    function callComputeCostUsd(
      router: LlmRouterService,
      provider: string,
      model: string,
      inputTokens: number,
      outputTokens: number,
      cachedTokens: number,
    ): Promise<number> {
      const fn = (
        router as unknown as {
          computeCostUsd: (
            provider: string,
            model: string,
            inputTokens: number,
            outputTokens: number,
            cachedTokens: number,
          ) => Promise<number>;
        }
      ).computeCostUsd.bind(router);
      return fn(provider, model, inputTokens, outputTokens, cachedTokens);
    }

    function buildWithProviderInfo(billingMode: string) {
      const priceFindFirst = vi.fn(async () => null);
      const prisma = { llmModelPrice: { findFirst: priceFindFirst } } as unknown as PrismaService;
      const incLlmCostUnpriced = vi.fn();
      const metrics = { incLlmCostUnpriced } as unknown as BusinessMetricsService;
      const resolveByName = vi.fn(async () => ({
        info: { name: 'p', baseUrl: 'https://x', apiKey: 'k', billingMode },
        protocolKind: 'openai-chat' as const,
      }));
      const providerInfo = { resolveByName } as unknown as ProviderInfoResolver;
      const router = new LlmRouterService(
        prisma,
        {} as AnthropicService,
        {} as MinimaxService,
        {} as OpenAiProxyService,
        {} as DeepSeekService,
        {} as OllamaService,
        {} as KieService,
        {} as GrsaiService,
        {} as AiUsageLogService,
        metrics,
        undefined,
        undefined,
        providerInfo,
      );
      return { router, resolveByName, incLlmCostUnpriced, priceFindFirst };
    }

    it('billingMode=subscription → costUsd=0 без похода в LlmModelPrice и без incLlmCostUnpriced (модель нигде не прайсована)', async () => {
      const { router, resolveByName, incLlmCostUnpriced, priceFindFirst } =
        buildWithProviderInfo('subscription');

      const cost = await callComputeCostUsd(
        router,
        'minimaxio2',
        'totally-unknown-model',
        1000,
        500,
        0,
      );

      expect(cost).toBe(0);
      expect(resolveByName).toHaveBeenCalledWith('minimaxio2');
      expect(priceFindFirst).not.toHaveBeenCalled();
      expect(incLlmCostUnpriced).not.toHaveBeenCalled();
    });

    it('billingMode=per_token (обычный провайдер) — считает по MODEL_PRICES как раньше (регрессия)', async () => {
      const { router } = buildWithProviderInfo('per_token');

      const cost = await callComputeCostUsd(
        router,
        'deepseek',
        'deepseek-chat',
        1_000_000,
        1_000_000,
        0,
      );

      expect(cost).toBeCloseTo(0.14 + 0.28, 5);
    });
  });
});
