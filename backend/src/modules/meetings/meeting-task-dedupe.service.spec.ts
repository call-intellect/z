import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';

import { MeetingTaskDedupeService } from './meeting-task-dedupe.service';

/**
 * Ф5 Р2 — unit на `MeetingTaskDedupeService`. Контракт NON-LOSSY:
 *   - флаг OFF → no-op (merged:0, embed не звался);
 *   - флаг ON, draft с cosine>=порога к canonical → черновик удалён (merged:1);
 *   - draft без близкого canonical → kept (deleteMany не звался);
 *   - серая зона → LLM-арбитр зван, verdict='different' → kept.
 *
 * Эмбеддинги детерминированы (ортогональные/совпадающие векторы), cosine
 * считает сам сервис. Порог по умолчанию 0.85, серая зона [0.78, 0.85).
 */

// Порог по умолчанию; серая зона сервиса = [THRESHOLD - 0.07, THRESHOLD).
const THRESHOLD = 0.85;

function makeCfg(enabled: boolean, threshold = THRESHOLD): TypedConfigService {
  return {
    get knowledgeCore() {
      return {
        taskDedupeEnabled: enabled,
        taskDedupeThreshold: threshold,
      };
    },
  } as unknown as TypedConfigService;
}

function makePrisma(rows: unknown[]): {
  prisma: PrismaService;
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => rows);
  const deleteMany = vi.fn(async () => ({ count: 0 }));
  const prisma = {
    task: { findMany, deleteMany },
  } as unknown as PrismaService;
  return { prisma, findMany, deleteMany };
}

function makeMetrics(): BusinessMetricsService {
  return {
    incTaskDedupe: vi.fn(),
  } as unknown as BusinessMetricsService;
}

/** Каждая строка задачи отдаёт заранее заданный вектор по своему title. */
function makeEmbed(
  vecByTitle: Record<string, number[]>,
): { embed: ReturnType<typeof vi.fn>; svc: EmbeddingFallbackService } {
  const embed = vi.fn(async (texts: string[]) =>
    texts.map((t) => {
      // titleText = `${title}. ${desc}` либо `${title}` — берём префикс до точки.
      const key = Object.keys(vecByTitle).find((k) => t.startsWith(k));
      return key ? vecByTitle[key]! : [0, 0, 1];
    }),
  );
  return { embed, svc: { embed } as unknown as EmbeddingFallbackService };
}

const canon = (id: string, title: string) => ({
  id,
  title,
  description: null,
  assigneeRaw: null,
  assigneeUserId: 'u1',
  extractorVersion: null,
});
const draft = (id: string, title: string) => ({
  id,
  title,
  description: null,
  assigneeRaw: null,
  assigneeUserId: null,
  extractorVersion: 'fast',
});

describe('MeetingTaskDedupeService.dedupeForMeeting', () => {
  it('флаг OFF → no-op, embed не звался', async () => {
    const { prisma, findMany } = makePrisma([]);
    const { embed, svc } = makeEmbed({});
    const svcUnit = new MeetingTaskDedupeService(
      prisma,
      svc,
      {} as unknown as LlmRouterService,
      makeCfg(false),
      makeMetrics(),
    );

    const res = await svcUnit.dedupeForMeeting({ tenantId: 't1', meetingId: 'm1' });
    expect(res).toEqual({ merged: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('флаг ON, draft cosine>=порога → черновик удалён, merged:1', async () => {
    const rows = [canon('c1', 'Подготовить смету'), draft('d1', 'Сделать смету')];
    const { prisma, deleteMany } = makePrisma(rows);
    // c1 и d1 — один и тот же вектор → cosine = 1.0 >= 0.85.
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0, 0],
      'Сделать смету': [1, 0, 0],
    });
    const metrics = makeMetrics();
    const svcUnit = new MeetingTaskDedupeService(
      prisma,
      svc,
      { call: vi.fn() } as unknown as LlmRouterService,
      makeCfg(true),
      metrics,
    );

    const res = await svcUnit.dedupeForMeeting({ tenantId: 't1', meetingId: 'm1' });
    expect(res).toEqual({ merged: 1 });
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['d1'] },
          meetingId: 'm1',
        }),
      }),
    );
    expect(metrics.incTaskDedupe).toHaveBeenCalledWith({ result: 'knn_merged' });
  });

  it('draft без близкого canonical → kept, deleteMany не звался', async () => {
    const rows = [canon('c1', 'Подготовить смету'), draft('d1', 'Купить кофе')];
    const { prisma, deleteMany } = makePrisma(rows);
    // ортогональные векторы → cosine = 0 < 0.78 (вне серой зоны).
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0, 0],
      'Купить кофе': [0, 1, 0],
    });
    const llmCall = vi.fn();
    const svcUnit = new MeetingTaskDedupeService(
      prisma,
      svc,
      { call: llmCall } as unknown as LlmRouterService,
      makeCfg(true),
      makeMetrics(),
    );

    const res = await svcUnit.dedupeForMeeting({ tenantId: 't1', meetingId: 'm1' });
    expect(res).toEqual({ merged: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('серая зона → LLM-арбитр зван, verdict=different → kept', async () => {
    const rows = [canon('c1', 'Подготовить смету'), draft('d1', 'Серая задача')];
    const { prisma, deleteMany } = makePrisma(rows);
    // Подберём векторы с cosine ∈ [0.78, 0.85): [1,0] и [cosθ, sinθ].
    // cos = 0.82 → угол ~ 34.9°. Вектор = [0.82, sqrt(1-0.82^2)].
    const cos = 0.82;
    const sin = Math.sqrt(1 - cos * cos);
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0],
      'Серая задача': [cos, sin],
    });
    const metrics = makeMetrics();
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({ verdict: 'different', confidence: 0.7 }),
    }));
    const svcUnit = new MeetingTaskDedupeService(
      prisma,
      svc,
      { call: llmCall } as unknown as LlmRouterService,
      makeCfg(true),
      metrics,
    );

    const res = await svcUnit.dedupeForMeeting({ tenantId: 't1', meetingId: 'm1' });
    expect(res).toEqual({ merged: 0 });
    expect(llmCall).toHaveBeenCalledTimes(1);
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'task-dedupe' }),
    );
    expect(deleteMany).not.toHaveBeenCalled();
    expect(metrics.incTaskDedupe).toHaveBeenCalledWith({ result: 'kept' });
  });

  it('серая зона → verdict=same → черновик удалён (llm_merged)', async () => {
    const rows = [canon('c1', 'Подготовить смету'), draft('d1', 'Серая задача')];
    const { prisma, deleteMany } = makePrisma(rows);
    const cos = 0.82;
    const sin = Math.sqrt(1 - cos * cos);
    const { svc } = makeEmbed({
      'Подготовить смету': [1, 0],
      'Серая задача': [cos, sin],
    });
    const metrics = makeMetrics();
    const llmCall = vi.fn(async () => ({
      text: JSON.stringify({ verdict: 'same', confidence: 0.9 }),
    }));
    const svcUnit = new MeetingTaskDedupeService(
      prisma,
      svc,
      { call: llmCall } as unknown as LlmRouterService,
      makeCfg(true),
      metrics,
    );

    const res = await svcUnit.dedupeForMeeting({ tenantId: 't1', meetingId: 'm1' });
    expect(res).toEqual({ merged: 1 });
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['d1'] } }) }),
    );
    expect(metrics.incTaskDedupe).toHaveBeenCalledWith({ result: 'llm_merged' });
  });
});
