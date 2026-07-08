import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AiUsageLogService } from './ai-usage-log.service';
import { LlmRouterService } from './llm-router.service';

function makePrisma(opts: {
  routes?: Array<Record<string, unknown>>;
  providers?: Array<{ name: string }>;
}) {
  const routeFindMany = vi.fn(async () => opts.routes ?? []);
  const experimentFindMany = vi.fn(async () => []);
  const promptFindMany = vi.fn(async () => []);
  const providerFindMany = vi.fn(async () => opts.providers ?? []);
  const providerCount = vi.fn(async () => (opts.providers ?? []).length);
  const prisma = {
    llmTaskRoute: { findMany: routeFindMany },
    llmModelPrice: { findFirst: vi.fn(async () => null) },
    llmModelExperiment: { findMany: experimentFindMany },
    promptCandidate: { findMany: promptFindMany },
    llmProvider: { findMany: providerFindMany, count: providerCount },
  } as unknown as PrismaService;
  return { prisma, routeFindMany, providerFindMany, providerCount };
}

function makeRouter(prisma: PrismaService, opts: { useRegistry?: boolean } = {}) {
  const usage = { record: vi.fn() } as unknown as AiUsageLogService;
  const metrics = { incLlmRouterDispatch: vi.fn() } as unknown as BusinessMetricsService;
  const cfg = {
    useProtocolAdapterRegistry: opts.useRegistry ?? true,
    getDynamic: vi.fn(async (_key: string, _env: unknown, def: unknown) => def),
  } as unknown as TypedConfigService;
  return new LlmRouterService(prisma, usage, metrics, cfg);
}

describe('LlmRouterService — БД-driven валидация маршрутов (Р1-Р2)', () => {
  it('loadKnownProviders: подгружает имена из llm_providers (deletedAt=null)', async () => {
    const { prisma, providerFindMany } = makePrisma({
      providers: [{ name: 'minimax' }, { name: 'llm-kora-team' }],
    });
    const router = makeRouter(prisma);
    await router.refreshCache();
    expect(providerFindMany).toHaveBeenCalledTimes(1);
  });

  it('tier-маршрут с провайдером из БД проходит фильтр knownProviderNames', async () => {
    const { prisma } = makePrisma({
      providers: [{ name: 'llm-kora-team' }],
      routes: [
        {
          id: 'r1',
          taskType: 'block-ingest',
          tenantId: null,
          tier: 'primary',
          priority: 0,
          providerName: 'llm-kora-team',
          model: 'gemma4:e4b',
          isActive: true,
          editedByAdmin: false,
          experiment: null,
          updatedAt: new Date(),
        },
      ],
    });
    const router = makeRouter(prisma);
    await router.refreshCache();
    const routes = (router as unknown as { routes: Map<string, Array<{ provider: string }>> }).routes;
    const chosen = routes.get('block-ingest');
    expect(chosen).toHaveLength(1);
    expect(chosen?.[0]?.provider).toBe('llm-kora-team');
  });

  it('tier-маршрут с провайдером НЕ из БД отбрасывается (не попадает в knownProviderNames)', async () => {
    const { prisma } = makePrisma({
      providers: [{ name: 'minimax' }],
      routes: [
        {
          id: 'r1',
          taskType: 'block-ingest',
          tenantId: null,
          tier: 'primary',
          priority: 0,
          providerName: 'unknown-provider',
          model: null,
          isActive: true,
          editedByAdmin: false,
          experiment: null,
          updatedAt: new Date(),
        },
      ],
    });
    const router = makeRouter(prisma);
    await router.refreshCache();
    const routes = (router as unknown as { routes: Map<string, Array<{ provider: string }>> }).routes;
    expect(routes.get('block-ingest')).toBeUndefined();
  });

  it('несколько tier-записей собираются в цепочку primary → secondary → tertiary', async () => {
    const { prisma } = makePrisma({
      providers: [{ name: 'p1' }, { name: 'p2' }, { name: 'p3' }],
      routes: [
        { id: 'r1', taskType: 'x', tenantId: null, tier: 'secondary', priority: 0, providerName: 'p2', model: null, isActive: true, editedByAdmin: false, experiment: null, updatedAt: new Date() },
        { id: 'r2', taskType: 'x', tenantId: null, tier: 'primary', priority: 0, providerName: 'p1', model: null, isActive: true, editedByAdmin: false, experiment: null, updatedAt: new Date() },
        { id: 'r3', taskType: 'x', tenantId: null, tier: 'tertiary', priority: 0, providerName: 'p3', model: null, isActive: true, editedByAdmin: false, experiment: null, updatedAt: new Date() },
      ],
    });
    const router = makeRouter(prisma);
    await router.refreshCache();
    const routes = (router as unknown as { routes: Map<string, Array<{ provider: string }>> }).routes;
    const chosen = routes.get('x')?.map((e) => e.provider);
    expect(chosen).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('LlmRouterService — resolveProviderCapability (Р3)', () => {
  it('реестр выключен → дефолт internal (без хардкод-карты)', async () => {
    const { prisma } = makePrisma({});
    const router = makeRouter(prisma, { useRegistry: false });
    const cap = await (router as unknown as {
      resolveProviderCapability: (p: string) => Promise<{ maxDataClass: string }>;
    }).resolveProviderCapability('any-provider');
    expect(cap).toEqual({ maxDataClass: 'internal' });
  });

  it('реестр активен, провайдер не найден → дефолт internal', async () => {
    const { prisma } = makePrisma({ providers: [] });
    const router = makeRouter(prisma, { useRegistry: true });
    const cap = await (router as unknown as {
      resolveProviderCapability: (p: string) => Promise<{ maxDataClass: string }>;
    }).resolveProviderCapability('unknown');
    expect(cap).toEqual({ maxDataClass: 'internal' });
  });

  it('реестр активен, capability из БД не валиден → дефолт internal', async () => {
    const { prisma } = makePrisma({ providers: [] });
    const router = makeRouter(prisma, { useRegistry: true });
    // providerInfo не заинжекчен → isRegistryActive вернёт false (нет dep) → дефолт internal
    const cap = await (router as unknown as {
      resolveProviderCapability: (p: string) => Promise<{ maxDataClass: string }>;
    }).resolveProviderCapability('unknown');
    expect(cap.maxDataClass).toBe('internal');
  });
});

describe('LlmRouterService — resolveDefaultChain (Р2 БД-валидация)', () => {
  it('defaultChain пустой → throw LlmRouterDefaultChainInvalidError (не молчаливый code-fallback)', async () => {
    const { prisma } = makePrisma({ providers: [{ name: 'minimax' }] });
    const router = makeRouter(prisma, { useRegistry: true });
    // getDynamic с default [] → цепочка пустая → throw
    await expect(
      (router as unknown as {
        resolveDefaultChain: () => Promise<unknown>;
      }).resolveDefaultChain(),
    ).rejects.toThrow(/дефолт-цепочка llm\.router\.defaultChain невалидна/);
  });
});

describe('LlmRouterService — call dispatch error (Р4)', () => {
  it('все провайдеры упали → бросается LlmRouterAllProvidersFailedError', async () => {
    const { prisma } = makePrisma({
      providers: [{ name: 'minimax' }],
      routes: [
        { id: 'r1', taskType: 'x', tenantId: null, tier: 'primary', priority: 0, providerName: 'minimax', model: 'm', isActive: true, editedByAdmin: false, experiment: null, updatedAt: new Date() },
      ],
    });
    // router без providerInfo/adapterRegistry — isRegistryActive=false →
    // dispatch бросит «реестр выключен»
    const router = makeRouter(prisma, { useRegistry: false });
    await router.refreshCache();
    await expect(
      (router as unknown as { call: (p: unknown) => Promise<unknown> }).call({
        taskType: 'x',
        systemPrompt: 's',
        userMessage: 'u',
        dataClass: 'public',
      }),
    ).rejects.toThrow(/реестр протокольных адаптеров выключен/);
  });
});

describe('LlmRouterService — setRoute (Р2)', () => {
  it('валидный провайдер из БД проходит; неизвестный отбрасывается', async () => {
    const { prisma, routeFindMany } = makePrisma({ providers: [{ name: 'minimax' }] });
    const createMock = vi.fn(async (args: { data: { providers: string[] } }) => ({
      id: 'new',
      taskType: args.data.taskType,
      providers: args.data.providers,
      isActive: args.data.isActive,
      tenantId: null,
    }));
    (prisma as unknown as { llmTaskRoute: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } }).llmTaskRoute = {
      findMany: routeFindMany,
      findFirst: vi.fn(async () => null),
      create: createMock,
      update: vi.fn(),
    };
    const router = makeRouter(prisma);
    await router.refreshCache();
    await expect(
      (router as unknown as { setRoute: (a: unknown) => Promise<unknown> }).setRoute({
        taskType: 'x',
        providers: ['minimax', 'unknown-provider'],
        isActive: true,
      }),
    ).resolves.toBeDefined();
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0]?.[0] as { data: { providers: string[] } };
    expect(arg.data.providers).toEqual(['minimax']);
  });

  it('пустой список валидных → throw с понятным сообщением', async () => {
    const { prisma } = makePrisma({ providers: [{ name: 'minimax' }] });
    const router = makeRouter(prisma);
    await router.refreshCache();
    await expect(
      (router as unknown as { setRoute: (a: unknown) => Promise<unknown> }).setRoute({
        taskType: 'x',
        providers: ['unknown1', 'unknown2'],
        isActive: true,
      }),
    ).rejects.toThrow(/пустой список валидных провайдеров/);
  });
});
