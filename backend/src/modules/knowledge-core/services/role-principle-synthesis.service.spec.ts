/**
 * TZ clone-method Э1.2 (2026-06-12) — RolePrincipleSynthesisService
 * (Reflection-слой принципов роли).
 *
 * Паттерн моков — фабрика как в `clones-query-log.spec.ts`: prisma / llm /
 * embedder / metrics / cfg подменяются vi.fn-заглушками, сервис собирается
 * напрямую через `new`.
 *
 * Кейсы:
 *   1. ≥ порога блоков → LLM вызван, принцип создан, sourceBlockIds ⊆
 *      входных, embedding записан raw-апдейтом;
 *   2. < порога → skipped='below_threshold', LLM НЕ вызван;
 *   3. повторный прогон: ближайший existing с cosine ≥ 0.85 → merge
 *      (UPDATE в транзакции), create НЕ вызван — «второй прогон = no-op
 *      по количеству»;
 *   4. principle с sourceBlockIds вне входа → отброшен;
 *   5. principle с диагностической лексикой («избегает решений») →
 *      отброшен + warn + метрика rejected_guard;
 *   6. ошибка LLM → skipped='llm_error', не throw.
 */

import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import type { KnowledgeEmbeddingService } from './embedding.service';
import { RolePrincipleSynthesisService } from './role-principle-synthesis.service';

const TENANT_ID = 'tenant-1';
const ROLE_ID = 'role-1';

const VALID_PRINCIPLE = {
  situation: 'срыв срока',
  statement:
    'Обычно при срыве срока сначала эскалирует владельцу с 2 вариантами, затем режет scope.',
  sourceBlockIds: ['b1', 'b2', 'b3'],
  observationCount: 3,
  confidence: 'medium',
};

/**
 * Собирает RolePrincipleSynthesisService с управляемыми: числом блоков,
 * текстом/ошибкой LLM и результатом KNN-поиска ближайшего принципа.
 */
function buildService(opts?: {
  /** Сколько subject-reasoning блоков вернёт ideaBlockEntity (default 6). */
  blockCount?: number;
  llmText?: string;
  llmThrows?: boolean;
  /** Строки top-1 KNN ($queryRawUnsafe). Default [] → путь create. */
  closestRows?: Array<{ id: string; distance: number }>;
}) {
  const blockCount = opts?.blockCount ?? 6;
  const blockIds = Array.from({ length: blockCount }, (_, i) => `b${i + 1}`);

  const txUpdate = vi.fn(async () => ({ id: 'rp-old' }));
  const txExecuteRawUnsafe = vi.fn(async () => 1);
  const tx = {
    rolePrinciple: { update: txUpdate },
    $executeRawUnsafe: txExecuteRawUnsafe,
  };

  const rolePrincipleCreate = vi.fn(async (args: { data: object }) => ({
    id: 'rp-new',
    ...args.data,
  }));
  const rolePrincipleFindUnique = vi.fn(async () => ({
    id: 'rp-old',
    sourceBlockIds: ['b1', 'b9'],
    observationCount: 2,
    confidence: 'low' as const,
  }));
  const executeRawUnsafe = vi.fn(async () => 1);
  const queryRawUnsafe = vi.fn(async () => opts?.closestRows ?? []);

  const prisma = {
    role: {
      findUnique: vi.fn(async () => ({
        id: ROLE_ID,
        name: 'Руководитель проектов',
        tenantId: TENANT_ID,
        deletedAt: null,
      })),
    },
    personRole: {
      findMany: vi.fn(async () => [{ personId: 'p1' }]),
    },
    appointment: {
      findMany: vi.fn(async () => [{ personId: 'p1' }, { personId: 'p2' }]),
    },
    person: {
      findMany: vi.fn(async () => [{ entityId: 'e1' }, { entityId: 'e2' }]),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async () => blockIds.map((id) => ({ blockId: id }))),
    },
    ideaBlock: {
      findMany: vi.fn(async () =>
        blockIds.map((id, i) => ({
          id,
          name: `блок ${id}`,
          trustedAnswer: `ответ ${id}`,
          createdAt: new Date(Date.UTC(2026, 4, 1 + i)),
          evidence: [{ quote: `цитата про срыв срока ${id}` }],
        })),
      ),
    },
    rolePrinciple: {
      create: rolePrincipleCreate,
      findUnique: rolePrincipleFindUnique,
    },
    // Embeddings блоков (tagged template $queryRaw): все блоки в одной
    // группе (cosine=1 ≥ 0.78) — гарантирует eligible-группу size ≥ 2.
    $queryRaw: vi.fn(async () => blockIds.map((id) => ({ id, emb: '[1,0,0]' }))),
    $queryRawUnsafe: queryRawUnsafe,
    $executeRawUnsafe: executeRawUnsafe,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const getDynamic = vi.fn(
    async (_key: string, _env?: string, def?: unknown) => def,
  );
  const cfg = {
    skill: { lookbackMonths: 12 },
    getDynamic,
  } as unknown as TypedConfigService;

  const llmCall = opts?.llmThrows
    ? vi.fn(async () => {
        throw new Error('all providers failed');
      })
    : vi.fn(async () => ({
        text:
          opts?.llmText ?? JSON.stringify({ principles: [VALID_PRINCIPLE] }),
        modelUsed: 'deepseek:deepseek-v4-pro',
        tier: 'primary' as const,
        inputTokens: 100,
        outputTokens: 50,
      }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const embedQuery = vi.fn(async () => [0.5, 0.5, 0]);
  const embedder = { embedQuery } as unknown as KnowledgeEmbeddingService;

  const incRolePrincipleSynthesized = vi.fn();
  const incCoreSpecialistLlmTokens = vi.fn();
  const metrics = {
    incRolePrincipleSynthesized,
    incCoreSpecialistLlmTokens,
  } as unknown as BusinessMetricsService;

  const svc = new RolePrincipleSynthesisService(
    prisma,
    cfg,
    llm,
    embedder,
    metrics,
  );

  // Приватный logger — подменяем для assert'ов warn (runtime-присвоение,
  // readonly только compile-time; паттерн any-cast соседних спеков).
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
      embedQuery,
      rolePrincipleCreate,
      rolePrincipleFindUnique,
      executeRawUnsafe,
      queryRawUnsafe,
      txUpdate,
      txExecuteRawUnsafe,
      getDynamic,
      incRolePrincipleSynthesized,
      incCoreSpecialistLlmTokens,
      warnSpy,
    },
  };
}

function run(svc: RolePrincipleSynthesisService) {
  return svc.synthesizeForRole({ tenantId: TENANT_ID, roleId: ROLE_ID });
}

describe('RolePrincipleSynthesisService Э1.2 — синтез принципов роли', () => {
  it('≥ порога блоков → LLM вызван, принцип создан, sourceBlockIds ⊆ входных, embedding записан raw-апдейтом', async () => {
    const { svc, mocks } = buildService();

    const res = await run(svc);

    expect(res).toEqual({ created: 1, merged: 0, skipped: null });
    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    expect(mocks.llmCall).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'role-principle-synthesize',
        tenantId: TENANT_ID,
        dataClass: 'internal',
        maxTokens: 8_000,
        sourceRef: { type: 'role_principle', id: ROLE_ID },
        responseFormat: expect.objectContaining({
          type: 'json_schema',
          name: 'role_principle_synthesize_v1',
          strict: true,
        }),
      }),
    );
    // Создан принцип с sourceBlockIds ⊆ входных (b1..b6).
    expect(mocks.rolePrincipleCreate).toHaveBeenCalledTimes(1);
    const createArgs = mocks.rolePrincipleCreate.mock.calls[0]?.[0] as {
      data: { sourceBlockIds: string[]; situation: string; status: string };
    };
    expect(createArgs.data.situation).toBe('срыв срока');
    expect(createArgs.data.status).toBe('active');
    for (const id of createArgs.data.sourceBlockIds) {
      expect(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']).toContain(id);
    }
    // Вектор записан raw-апдейтом в role_principles.
    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "role_principles" SET "embedding"'),
      '[0.5,0.5,0]',
      'rp-new',
    );
    // Учёт токенов метрикой специалиста + outcome=created.
    expect(mocks.incCoreSpecialistLlmTokens).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'role_principle', tokens: 150 }),
    );
    expect(mocks.incRolePrincipleSynthesized).toHaveBeenCalledWith({
      outcome: 'created',
    });
  });

  it('< порога (2 блока при minObs=5) → skipped=below_threshold, LLM НЕ вызван', async () => {
    const { svc, mocks } = buildService({ blockCount: 2 });

    const res = await run(svc);

    expect(res).toEqual({ created: 0, merged: 0, skipped: 'below_threshold' });
    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.rolePrincipleCreate).not.toHaveBeenCalled();
    // Порог читался из AdminSetting-крутилки.
    expect(mocks.getDynamic).toHaveBeenCalledWith(
      'knowledge.rolePrincipleMinObservations',
      undefined,
      5,
    );
  });

  it('повторный прогон: existing с cosine ≥ 0.85 → UPDATE (merged), НЕ create — второй прогон = no-op по количеству', async () => {
    // distance 0.1 → similarity 0.9 ≥ 0.85 (maxDistance 0.15).
    const { svc, mocks } = buildService({
      closestRows: [{ id: 'rp-old', distance: 0.1 }],
    });

    const res = await run(svc);

    expect(res).toEqual({ created: 0, merged: 1, skipped: null });
    expect(mocks.rolePrincipleCreate).not.toHaveBeenCalled();
    // UPDATE существующего: union sourceBlockIds + max-confidence + новый
    // statement + lastSynthesizedAt (в транзакции с raw-апдейтом вектора).
    expect(mocks.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rp-old' },
        data: expect.objectContaining({
          sourceBlockIds: expect.arrayContaining(['b1', 'b9', 'b2', 'b3']),
          observationCount: 4,
          confidence: 'medium',
          statement: VALID_PRINCIPLE.statement,
          lastSynthesizedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.txExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE "role_principles" SET "embedding"'),
      '[0.5,0.5,0]',
      'rp-old',
    );
    expect(mocks.incRolePrincipleSynthesized).toHaveBeenCalledWith({
      outcome: 'merged',
    });
  });

  it('principle с sourceBlockIds вне входа → отброшен (ни create, ни merge)', async () => {
    const { svc, mocks } = buildService({
      llmText: JSON.stringify({
        principles: [
          {
            ...VALID_PRINCIPLE,
            sourceBlockIds: ['b1', 'zz-вне-входа'],
          },
        ],
      }),
    });

    const res = await run(svc);

    expect(res).toEqual({ created: 0, merged: 0, skipped: null });
    expect(mocks.rolePrincipleCreate).not.toHaveBeenCalled();
    expect(mocks.txUpdate).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalled();
  });

  it('principle с диагностической лексикой («избегает решений») → отброшен + warn + метрика rejected_guard', async () => {
    const { svc, mocks } = buildService({
      llmText: JSON.stringify({
        principles: [
          {
            ...VALID_PRINCIPLE,
            statement: 'Носитель избегает решений и ждёт указаний сверху.',
          },
        ],
      }),
    });

    const res = await run(svc);

    expect(res).toEqual({ created: 0, merged: 0, skipped: null });
    expect(mocks.rolePrincipleCreate).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalled();
    expect(mocks.incRolePrincipleSynthesized).toHaveBeenCalledWith({
      outcome: 'rejected_guard',
    });
    expect(mocks.incRolePrincipleSynthesized).not.toHaveBeenCalledWith({
      outcome: 'created',
    });
  });

  it('ошибка LLM → skipped=llm_error, не throw', async () => {
    const { svc, mocks } = buildService({ llmThrows: true });

    const res = await run(svc);

    expect(res).toEqual({ created: 0, merged: 0, skipped: 'llm_error' });
    expect(mocks.rolePrincipleCreate).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalled();
  });
});
