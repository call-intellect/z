/**
 * Волна 3 — Б5/Б6 [K9] unit-тесты CardRollupV2Service.buildRollup.
 *
 * Б5 — `triage='provisional'` (системно канонизировано AI-судьёй) обновляет
 *      Card так же, как 'auto'. Раньше провижн трактовался как «не auto» →
 *      Card.update с summaryCache не вызывался, и summaryCache/currentVersionId
 *      дрейфовали от CardVersion, созданной внутри triage.
 *
 * Б6 — conflict.report НЕ вызывается, когда новое summary не применено
 *      (light/deep): ложный ConflictItem уходил в очередь.
 *
 * Тестируем через полностью замоканный Prisma + curation + conflicts.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { ConflictService } from '../../curation/services/conflict.service';
import type { CurationService } from '../../curation/services/curation.service';

import { CardRollupV2Service } from './card-rollup-v2.service';
import type { Specialist34ProbeService } from './specialist-3-4-probe.service';

interface MakeArgs {
  triageDecision: 'auto' | 'provisional' | 'light' | 'deep';
  /** Старый summaryCache карточки (для conflict-эвристики). */
  oldSummaryCache: string;
  /** Новый summary, который вернёт LLM. */
  newSummary: string;
}

function makeService(args: MakeArgs): {
  svc: CardRollupV2Service;
  cardUpdate: ReturnType<typeof vi.fn>;
  conflictReport: ReturnType<typeof vi.fn>;
  triage: ReturnType<typeof vi.fn>;
} {
  const cardUpdate = vi.fn(async (callArgs: { data: Record<string, unknown> }) => ({
    id: 'card-1',
    ...callArgs.data,
  }));

  const prisma = {
    card: {
      findUnique: vi.fn(async () => ({
        id: 'card-1',
        kind: 'project',
        name: 'Проект Альфа',
        contactName: null,
        contactEmail: null,
        ownerId: null,
        tenantId: 'org-1',
        entityId: 'ent-1',
        relatedEntityIds: [],
        deletedAt: null,
        summaryCache: args.oldSummaryCache,
      })),
      update: cardUpdate,
    },
    meeting: { findMany: vi.fn(async () => []) },
    ideaBlockEvidence: {
      findMany: vi.fn(async (q: { select?: { quote?: boolean } }) =>
        // Для блоков (без quote-select) — пусто; для quote-выборки — пусто.
        q?.select?.quote ? [] : [],
      ),
    },
    ideaBlockEntity: { findMany: vi.fn(async () => [{ blockId: 'b-1' }]) },
    ideaBlock: {
      findMany: vi.fn(async () => [
        {
          id: 'b-1',
          name: 'Блок 1',
          criticalQuestion: 'Что со статусом?',
          trustedAnswer: 'Проект активен',
          tags: [],
          signalType: 'fact',
          dataClass: 'internal',
          createdAt: new Date('2026-01-01'),
        },
      ]),
    },
    themeIdeaBlock: { findMany: vi.fn(async () => []) },
    theme: { findMany: vi.fn(async () => []) },
    person: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;

  const llm = {
    call: vi.fn(async () => ({
      text: args.newSummary,
      tier: 'primary',
      modelUsed: 'deepseek-v4-pro',
      inputTokens: 10,
      outputTokens: 20,
    })),
  } as unknown as LlmRouterService;

  const triage = vi.fn(async () => ({
    decision: args.triageDecision,
    cardVersionId:
      args.triageDecision === 'auto' || args.triageDecision === 'provisional'
        ? 'cv-1'
        : null,
    curationItemId:
      args.triageDecision === 'light' || args.triageDecision === 'deep'
        ? 'ci-1'
        : null,
  }));
  const curation = { triage } as unknown as CurationService;

  const conflictReport = vi.fn(async () => undefined);
  const conflicts = { report: conflictReport } as unknown as ConflictService;

  const metrics = {
    observeCoreSpecialistPipelineDuration: vi.fn(),
    incCoreSpecialistLlmTokens: vi.fn(),
    incCoreSpecialistConflictEvent: vi.fn(),
  } as unknown as BusinessMetricsService;

  const probes = {
    checkAndEmitProbes: vi.fn(async () => undefined),
  } as unknown as Specialist34ProbeService;

  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    dataClassPolicy: { enforcement: 'off' as const },
  } as unknown as TypedConfigService;

  const svc = new CardRollupV2Service(
    prisma,
    llm,
    curation,
    conflicts,
    metrics,
    probes,
    cfg,
    undefined,
  );

  return { svc, cardUpdate, conflictReport, triage };
}

describe('CardRollupV2Service.buildRollup — Б5/Б6 [K9]', () => {
  it('Б5: triage=provisional применяет Card (summaryCache + currentVersionId)', async () => {
    const { svc, cardUpdate } = makeService({
      triageDecision: 'provisional',
      oldSummaryCache: 'Проект активен',
      newSummary: 'Проект активен, всё идёт по плану',
    });

    const res = await svc.buildRollup({ tenantId: 'org-1', cardId: 'card-1' });

    expect(res.applied).toBe(true);
    expect(res.triageDecision).toBe('provisional');
    // Был вызван «полный» update с summaryCache (а не только summaryUpdatedAt).
    const fullUpdate = cardUpdate.mock.calls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data.summaryCache,
    );
    expect(fullUpdate).toBeDefined();
    const data = (fullUpdate![0] as { data: Record<string, unknown> }).data;
    expect(data.summaryCache).toBe('Проект активен, всё идёт по плану');
    expect(data.currentVersionId).toBe('cv-1');
  });

  it('Б6: light (не applied) НЕ вызывает conflict.report даже при флипе статуса', async () => {
    const { svc, cardUpdate, conflictReport } = makeService({
      triageDecision: 'light',
      // флип «активен» → «закрыт» (эвристика сработала бы)
      oldSummaryCache: 'Проект активен',
      newSummary: 'Проект закрыт',
    });

    const res = await svc.buildRollup({ tenantId: 'org-1', cardId: 'card-1' });

    expect(res.applied).toBe(false);
    expect(res.conflictReported).toBe(false);
    expect(conflictReport).not.toHaveBeenCalled();
    // Освежён только summaryUpdatedAt (без summaryCache).
    const onlyTouch = cardUpdate.mock.calls.find(
      (c) =>
        (c[0] as { data: Record<string, unknown> }).data.summaryUpdatedAt &&
        !(c[0] as { data: Record<string, unknown> }).data.summaryCache,
    );
    expect(onlyTouch).toBeDefined();
  });

  it('Б6 (контроль): auto + обнаружено противоречие ВЫЗЫВАЕТ conflict.report (applied не блокирует)', async () => {
    const { svc, conflictReport } = makeService({
      triageDecision: 'auto',
      oldSummaryCache: 'Старое summary',
      newSummary: 'Новое summary',
    });
    // detectStatusContradiction опирается на ASCII-`\b`-regex, который не ловит
    // кириллицу детерминированно — поэтому форсируем сигнал противоречия, чтобы
    // изолированно проверить именно гейт `applied` (Б6), а не саму эвристику.
    vi.spyOn(
      svc as unknown as {
        detectStatusContradiction: (a: string, b: string) => boolean;
      },
      'detectStatusContradiction',
    ).mockReturnValue(true);

    const res = await svc.buildRollup({ tenantId: 'org-1', cardId: 'card-1' });

    expect(res.applied).toBe(true);
    expect(res.conflictReported).toBe(true);
    expect(conflictReport).toHaveBeenCalledTimes(1);
  });

  it('Б6 (контроль-2): light + форсированное противоречие всё равно НЕ репортит (гейт applied)', async () => {
    const { svc, conflictReport } = makeService({
      triageDecision: 'light',
      oldSummaryCache: 'Старое summary',
      newSummary: 'Новое summary',
    });
    vi.spyOn(
      svc as unknown as {
        detectStatusContradiction: (a: string, b: string) => boolean;
      },
      'detectStatusContradiction',
    ).mockReturnValue(true);

    const res = await svc.buildRollup({ tenantId: 'org-1', cardId: 'card-1' });

    expect(res.applied).toBe(false);
    expect(res.conflictReported).toBe(false);
    // Гейт `if (applied)` короткозамыкает до detectStatusContradiction.
    expect(conflictReport).not.toHaveBeenCalled();
  });
});
