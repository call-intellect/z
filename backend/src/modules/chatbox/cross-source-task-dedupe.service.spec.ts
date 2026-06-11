import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';

import {
  type CrossSourceChatContext,
  type CrossSourceTaskCandidate,
  CrossSourceTaskDedupeService,
} from './cross-source-task-dedupe.service';

/**
 * ТЗ 2026-06-11 chatbox-tasks Ф6 — unit на CrossSourceTaskDedupeService.
 * Контракт NON-LOSSY:
 *   - кандидат совпал с открытой задачей (cosine>=порога) → новой задачи НЕТ,
 *     пишется TaskSource (link); повторный прогон идемпотентен (P2002 → no-op);
 *   - не-дубль → создаётся новая задача (create);
 *   - серая зона + арбитр 'different' (uncertain) → создаётся (non-lossy);
 *   - флаг OFF → дедуп выключен, всегда create.
 *
 * Эмбеддинги детерминированы (заданные векторы по title), cosine считает сам
 * сервис. Порог по умолчанию 0.85, серая зона [0.78, 0.85).
 */

const THRESHOLD = 0.85;

function makeCfg(
  enabled: boolean,
  threshold = THRESHOLD,
): TypedConfigService {
  return {
    get aiFeatures() {
      return {
        tasksCrossSourceDedupeEnabled: enabled,
        crossSourceDedupeThreshold: threshold,
      };
    },
  } as unknown as TypedConfigService;
}

interface OpenTaskRow {
  id: string;
  title: string;
  description: string | null;
  assigneeRaw: string | null;
  evidenceBlockIds: string[];
}

function makePrisma(openTasks: OpenTaskRow[], opts?: { sourceCreateThrows?: 'P2002' }) {
  const taskCreate = vi.fn(async () => ({ id: 'new-task-1' }));
  const taskUpdate = vi.fn(async () => ({}));
  const taskFindMany = vi.fn(async () => openTasks);
  const taskSourceCreate = vi.fn(async () => {
    if (opts?.sourceCreateThrows === 'P2002') {
      const err = new Error('Unique constraint failed') as Error & { code: string };
      err.code = 'P2002';
      throw err;
    }
    return { id: 'ts-1' };
  });
  const prisma = {
    task: { create: taskCreate, update: taskUpdate, findMany: taskFindMany },
    taskSource: { create: taskSourceCreate },
  } as unknown as PrismaService;
  return { prisma, taskCreate, taskUpdate, taskFindMany, taskSourceCreate };
}

function makeMetrics(): BusinessMetricsService {
  return { incTaskDedupe: vi.fn() } as unknown as BusinessMetricsService;
}

/** Эмбеддер: каждый title → заранее заданный вектор (префикс до точки). */
function makeEmbed(vecByTitle: Record<string, number[]>): {
  embed: ReturnType<typeof vi.fn>;
  svc: EmbeddingFallbackService;
} {
  const embed = vi.fn(async (texts: string[]) =>
    texts.map((t) => {
      const key = Object.keys(vecByTitle).find((k) => t.startsWith(k));
      return key ? vecByTitle[key]! : [0, 0, 1];
    }),
  );
  return { embed, svc: { embed } as unknown as EmbeddingFallbackService };
}

const ctx: CrossSourceChatContext = {
  tenantId: 't1',
  ownerUserId: 'owner-1',
  sessionId: 's1',
  chatId: 'chat-1',
};

const openTask = (
  id: string,
  title: string,
  evidenceBlockIds: string[] = [],
): OpenTaskRow => ({
  id,
  title,
  description: null,
  assigneeRaw: null,
  evidenceBlockIds,
});

const candidate = (
  title: string,
  extra?: Partial<CrossSourceTaskCandidate>,
): CrossSourceTaskCandidate => ({
  title,
  description: null,
  assigneeRaw: null,
  assigneeUserId: null,
  sourceQuote: 'цитата',
  confidence: 0.9,
  ...extra,
});

describe('CrossSourceTaskDedupeService.processCandidates', () => {
  it('кандидат совпал с открытой задачей → link (TaskSource), новой задачи НЕТ', async () => {
    const { prisma, taskCreate, taskSourceCreate } = makePrisma([
      openTask('open-1', 'Подготовить смету'),
    ]);
    // open-1 и кандидат — один вектор → cosine=1.0 >= 0.85.
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0, 0],
      'Сделать смету': [1, 0, 0],
    });
    const metrics = makeMetrics();
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: vi.fn() } as unknown as LlmRouterService,
      makeCfg(true),
      metrics,
    );

    const res = await svcUnit.processCandidates([candidate('Сделать смету')], ctx);

    expect(res).toEqual({ created: 0, linked: 1 });
    expect(taskCreate).not.toHaveBeenCalled();
    expect(taskSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: 'open-1',
          sourceType: 'chatbox',
          sourceRefId: 's1',
          chatId: 'chat-1',
        }),
      }),
    );
    expect(metrics.incTaskDedupe).toHaveBeenCalledWith({ result: 'cross_linked' });
  });

  it('идемпотентность привязки: TaskSource P2002 → no-op, не падает (linked)', async () => {
    const { prisma, taskCreate, taskSourceCreate } = makePrisma(
      [openTask('open-1', 'Подготовить смету')],
      { sourceCreateThrows: 'P2002' },
    );
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0, 0],
      'Сделать смету': [1, 0, 0],
    });
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: vi.fn() } as unknown as LlmRouterService,
      makeCfg(true),
      makeMetrics(),
    );

    const res = await svcUnit.processCandidates([candidate('Сделать смету')], ctx);

    expect(res).toEqual({ created: 0, linked: 1 });
    expect(taskCreate).not.toHaveBeenCalled();
    expect(taskSourceCreate).toHaveBeenCalledTimes(1); // вызвали, поймали P2002
  });

  it('не-дубль → создаётся новая задача (create)', async () => {
    const { prisma, taskCreate, taskSourceCreate } = makePrisma([
      openTask('open-1', 'Подготовить смету'),
    ]);
    // ортогональные → cosine=0 < 0.78 (вне серой зоны).
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0, 0],
      'Купить кофе': [0, 1, 0],
    });
    const llmCall = vi.fn();
    const metrics = makeMetrics();
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: llmCall } as unknown as LlmRouterService,
      makeCfg(true),
      metrics,
    );

    const res = await svcUnit.processCandidates([candidate('Купить кофе')], ctx);

    expect(res).toEqual({ created: 1, linked: 0 });
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meetingId: null,
          sourceType: 'chatbox',
          sourceChatSessionId: 's1',
          sourceChatId: 'chat-1',
          tenantId: 't1',
          userId: 'owner-1',
          title: 'Купить кофе',
        }),
      }),
    );
    // create тоже пишет TaskSource (единый след) для новой задачи.
    expect(taskSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taskId: 'new-task-1' }) }),
    );
    expect(llmCall).not.toHaveBeenCalled();
    expect(metrics.incTaskDedupe).toHaveBeenCalledWith({ result: 'cross_created' });
  });

  it('серая зона + арбитр different (uncertain) → создаётся (non-lossy)', async () => {
    const { prisma, taskCreate } = makePrisma([openTask('open-1', 'Подготовить смету')]);
    // cosine ∈ [0.78, 0.85): [1,0] и [cos,sin], cos=0.82.
    const cos = 0.82;
    const sin = Math.sqrt(1 - cos * cos);
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0],
      'Серая задача': [cos, sin],
    });
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({ verdict: 'different', confidence: 0.6 }),
    }));
    const metrics = makeMetrics();
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: llmCall } as unknown as LlmRouterService,
      makeCfg(true),
      metrics,
    );

    const res = await svcUnit.processCandidates([candidate('Серая задача')], ctx);

    expect(res).toEqual({ created: 1, linked: 0 });
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'task-dedupe' }),
    );
    expect(taskCreate).toHaveBeenCalledTimes(1);
    expect(metrics.incTaskDedupe).toHaveBeenCalledWith({ result: 'cross_created' });
  });

  it('серая зона + арбитр same → link', async () => {
    const { prisma, taskCreate, taskSourceCreate } = makePrisma([
      openTask('open-1', 'Подготовить смету'),
    ]);
    const cos = 0.82;
    const sin = Math.sqrt(1 - cos * cos);
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0],
      'Серая задача': [cos, sin],
    });
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({ verdict: 'same', confidence: 0.9 }),
    }));
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: llmCall } as unknown as LlmRouterService,
      makeCfg(true),
      makeMetrics(),
    );

    const res = await svcUnit.processCandidates([candidate('Серая задача')], ctx);

    expect(res).toEqual({ created: 0, linked: 1 });
    expect(taskCreate).not.toHaveBeenCalled();
    expect(taskSourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ taskId: 'open-1' }) }),
    );
  });

  it('флаг OFF → дедуп выключен, всегда create (embed не звался)', async () => {
    const { prisma, taskCreate, taskFindMany } = makePrisma([
      openTask('open-1', 'Подготовить смету'),
    ]);
    const { embed, svc } = makeEmbed({});
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: vi.fn() } as unknown as LlmRouterService,
      makeCfg(false),
      makeMetrics(),
    );

    const res = await svcUnit.processCandidates([candidate('Любая задача')], ctx);

    expect(res).toEqual({ created: 1, linked: 0 });
    expect(taskCreate).toHaveBeenCalledTimes(1);
    expect(embed).not.toHaveBeenCalled();
    expect(taskFindMany).not.toHaveBeenCalled();
  });

  it('нет открытых задач tenant → создаётся как новая', async () => {
    const { prisma, taskCreate } = makePrisma([]);
    const { svc } = makeEmbed({ 'Новая задача': [1, 0, 0] });
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: vi.fn() } as unknown as LlmRouterService,
      makeCfg(true),
      makeMetrics(),
    );

    const res = await svcUnit.processCandidates([candidate('Новая задача')], ctx);

    expect(res).toEqual({ created: 1, linked: 0 });
    expect(taskCreate).toHaveBeenCalledTimes(1);
  });

  it('link дописывает новые evidenceBlockIds (union, не теряя старые)', async () => {
    const { prisma, taskUpdate } = makePrisma([
      openTask('open-1', 'Подготовить смету', ['b1']),
    ]);
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0, 0],
      'Сделать смету': [1, 0, 0],
    });
    const svcUnit = new CrossSourceTaskDedupeService(
      prisma,
      svc,
      { call: vi.fn() } as unknown as LlmRouterService,
      makeCfg(true),
      makeMetrics(),
    );

    await svcUnit.processCandidates(
      [candidate('Сделать смету', { evidenceBlockIds: ['b1', 'b2'] })],
      ctx,
    );

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'open-1' },
        data: { evidenceBlockIds: ['b1', 'b2'] },
      }),
    );
  });
});
