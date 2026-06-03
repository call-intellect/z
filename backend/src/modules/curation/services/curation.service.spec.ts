import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import type { ConversationalService } from '../../conversational/conversational.service';

import { CurationService, type TriageInput } from './curation.service';
import type { CuratorRoutingService } from './curator-routing.service';

/**
 * Unit-тесты Action Center A1 «лестница доверия» (2026-06-02).
 *
 * Покрытие:
 *   - критический тип + high confidence + AI-судья accept-консенсус →
 *     провизорная канонизация (CardVersion.trustTier='provisional', без
 *     блокирующего CurationItem);
 *   - AI-судья reject/split → deep CurationItem (человек);
 *   - debate недоступен (null) → deep CurationItem (fallback);
 *   - debate.judge бросил → deep CurationItem (fallback);
 *   - аудит-выборка rate=1 → создаётся audit-CurationItem; rate=0 → нет;
 *   - trustTier на auto-пути ('auto') и human-пути (decide) корректен.
 */

interface CardVersionRow {
  id: string;
  version: number;
  trustTier: string;
}

/** Собирает мок PrismaService + наблюдаемые буферы создания записей. */
function buildPrisma(args?: {
  curationSettings?: Record<string, unknown> | null;
}) {
  const createdCardVersions: Array<{ trustTier: string; resourceType: string }> = [];
  const createdCurationItems: Array<{
    level: string;
    status: string;
    triageReason: unknown;
  }> = [];
  let cardVersionSeq = 0;

  const prisma = {
    org: {
      findUnique: vi.fn(async () => ({
        curationSettings: args?.curationSettings ?? null,
      })),
    },
    cardVersion: {
      findFirst: vi.fn(async (): Promise<CardVersionRow | null> => null),
      create: vi.fn(async ({ data }: { data: { trustTier: string; resourceType: string } }) => {
        cardVersionSeq += 1;
        createdCardVersions.push({
          trustTier: data.trustTier,
          resourceType: data.resourceType,
        });
        return { id: `cv-${cardVersionSeq}`, version: 1, trustTier: data.trustTier };
      }),
    },
    curationItem: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { level: string; status: string; triageReason: unknown };
        }) => {
          const id = `ci-${createdCurationItems.length + 1}`;
          createdCurationItems.push({
            level: data.level,
            status: data.status,
            triageReason: data.triageReason,
          });
          return { id, ...data, createdAt: new Date(), expiresAt: null };
        },
      ),
    },
  } as unknown as PrismaService;

  return { prisma, createdCardVersions, createdCurationItems };
}

function buildCfg(overrides?: Partial<Record<string, unknown>>): TypedConfigService {
  return {
    curation: {
      autoThresholdDefault: 0.85,
      deepReviewThresholdDefault: 0.6,
      criticalTypesDefault: ['regulation', 'process', 'decision'],
      itemExpiryDays: 30,
      // A1/A2 «лестница доверия» — платформенные дефолты теперь приходят из
      // cfg.curation (AdminSetting → ENV → default), а не из констант сервиса.
      // Значения совпадают с code-fallback (0.8 / true / 0.05 / false / 0.6 /
      // 0.97 / 0.02 / 20 / 0.2), чтобы существующие A1-тесты не менялись.
      provisionalThresholdDefault: 0.8,
      aiVerifierEnabled: true,
      auditSampleRate: 0.05,
      autotuneEnabled: false,
      thresholdMin: 0.6,
      thresholdMax: 0.97,
      autotuneStep: 0.02,
      minDecisionsForAutotune: 20,
      maxProvisionalOverride: 0.2,
      ...overrides,
    },
  } as unknown as TypedConfigService;
}

function buildMetrics() {
  return {
    incCurationAutoCanonical: vi.fn(),
    incCurationItem: vi.fn(),
    incCurationProvisional: vi.fn(),
    incCurationAuditSample: vi.fn(),
    incCurationVerifierVerdict: vi.fn(),
    incCurationDecision: vi.fn(),
    observeCurationTimeToDecide: vi.fn(),
  } as unknown as BusinessMetricsService;
}

function buildConversational(): ConversationalService {
  return {
    sendNotification: vi.fn(async () => undefined),
  } as unknown as ConversationalService;
}

function buildRouting(): CuratorRoutingService {
  return {
    resolveCurators: vi.fn(async () => ['curator-1']),
  } as unknown as CuratorRoutingService;
}

function buildDebate(verdict: DebateVerdict | Error | null): MultiAgentDebateService | null {
  if (verdict === null) return null;
  return {
    judge: vi.fn(async () => {
      if (verdict instanceof Error) throw verdict;
      return verdict;
    }),
  } as unknown as MultiAgentDebateService;
}

function acceptVerdict(consensus: 'unanimous' | 'majority' | 'split'): DebateVerdict {
  return {
    decision: consensus === 'split' ? 'split_uncertain' : 'accept',
    votes: [],
    consensusType: consensus,
    rounds: 1,
    totalCostUsd: 0.001,
    fallbackUsed: null,
  };
}

function rejectVerdict(): DebateVerdict {
  return {
    decision: 'reject',
    votes: [],
    consensusType: 'unanimous',
    rounds: 1,
    totalCostUsd: 0.001,
    fallbackUsed: null,
  };
}

function makeService(opts: {
  prisma: PrismaService;
  metrics: BusinessMetricsService;
  routing: CuratorRoutingService;
  debate: MultiAgentDebateService | null;
  conversational?: ConversationalService;
  cfg?: TypedConfigService;
}): CurationService {
  return new CurationService(
    opts.prisma,
    opts.cfg ?? buildCfg(),
    opts.metrics,
    opts.conversational ?? buildConversational(),
    opts.routing,
    null, // skillCategories
    null, // events
    opts.debate,
  );
}

const criticalInput: TriageInput = {
  tenantId: 'tenant-A',
  resourceType: 'decision',
  resourceId: 'res-1',
  confidence: 0.95,
  proposedPayload: { statement: 'Переходим на недельные спринты' },
  conflictSignal: 'none',
};

describe('CurationService — A1 «лестница доверия»', () => {
  let metrics: BusinessMetricsService;
  let routing: CuratorRoutingService;

  beforeEach(() => {
    metrics = buildMetrics();
    routing = buildRouting();
  });

  it('критический тип + high confidence + AI-судья accept → провизорная канонизация (trustTier=provisional, без блокирующего CurationItem)', async () => {
    const { prisma, createdCardVersions, createdCurationItems } = buildPrisma({
      curationSettings: { auditSampleRate: 0 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: buildDebate(acceptVerdict('unanimous')),
    });

    const res = await service.triage(criticalInput);

    expect(res.decision).toBe('provisional');
    expect(res.cardVersionId).toBe('cv-1');
    expect(res.curationItemId).toBeNull();
    expect(createdCardVersions).toHaveLength(1);
    expect(createdCardVersions[0]?.trustTier).toBe('provisional');
    // Аудит rate=0 → CurationItem НЕ создан вовсе.
    expect(createdCurationItems).toHaveLength(0);
    expect(metrics.incCurationProvisional).toHaveBeenCalledWith({
      resourceType: 'decision',
    });
  });

  it('AI-судья reject → deep CurationItem (человек), карточка НЕ канонизирована', async () => {
    const { prisma, createdCardVersions, createdCurationItems } = buildPrisma({
      curationSettings: { auditSampleRate: 0 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: buildDebate(rejectVerdict()),
    });

    const res = await service.triage(criticalInput);

    expect(res.decision).toBe('deep');
    expect(res.cardVersionId).toBeNull();
    expect(res.curationItemId).not.toBeNull();
    expect(createdCardVersions).toHaveLength(0);
    expect(createdCurationItems).toHaveLength(1);
    expect(createdCurationItems[0]?.level).toBe('deep');
  });

  it('AI-судья split → deep CurationItem (человек)', async () => {
    const { prisma, createdCardVersions, createdCurationItems } = buildPrisma({
      curationSettings: { auditSampleRate: 0 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: buildDebate(acceptVerdict('split')),
    });

    const res = await service.triage(criticalInput);

    expect(res.decision).toBe('deep');
    expect(createdCardVersions).toHaveLength(0);
    expect(createdCurationItems[0]?.level).toBe('deep');
  });

  it('debate недоступен (null) → deep CurationItem (безопасный fallback)', async () => {
    const { prisma, createdCardVersions, createdCurationItems } = buildPrisma({
      curationSettings: { auditSampleRate: 0 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: null,
    });

    const res = await service.triage(criticalInput);

    expect(res.decision).toBe('deep');
    expect(createdCardVersions).toHaveLength(0);
    expect(createdCurationItems[0]?.level).toBe('deep');
  });

  it('debate.judge бросил → deep CurationItem (fallback)', async () => {
    const { prisma, createdCardVersions, createdCurationItems } = buildPrisma({
      curationSettings: { auditSampleRate: 0 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: buildDebate(new Error('all providers down')),
    });

    const res = await service.triage(criticalInput);

    expect(res.decision).toBe('deep');
    expect(createdCardVersions).toHaveLength(0);
    expect(createdCurationItems[0]?.level).toBe('deep');
  });

  it('аудит-выборка rate=1 → создаётся audit-CurationItem поверх провизорной канонизации', async () => {
    const { prisma, createdCardVersions, createdCurationItems } = buildPrisma({
      curationSettings: { auditSampleRate: 1 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: buildDebate(acceptVerdict('majority')),
    });

    const res = await service.triage(criticalInput);

    expect(res.decision).toBe('provisional');
    expect(createdCardVersions[0]?.trustTier).toBe('provisional');
    // rate=1 → ровно один лёгкий аудит-item (не блокирующий).
    expect(createdCurationItems).toHaveLength(1);
    expect(createdCurationItems[0]?.level).toBe('light');
    expect(createdCurationItems[0]?.status).toBe('pending');
    expect(res.curationItemId).toBe(createdCurationItems[0] ? 'ci-1' : null);
    expect(metrics.incCurationAuditSample).toHaveBeenCalledWith({
      resourceType: 'decision',
    });
  });

  it('аудит-выборка rate=0 → audit-CurationItem НЕ создаётся', async () => {
    const { prisma, createdCurationItems } = buildPrisma({
      curationSettings: { auditSampleRate: 0 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: buildDebate(acceptVerdict('unanimous')),
    });

    await service.triage(criticalInput);
    expect(createdCurationItems).toHaveLength(0);
    expect(metrics.incCurationAuditSample).not.toHaveBeenCalled();
  });

  it('некритический тип + high confidence → auto-canonical (trustTier=auto)', async () => {
    const { prisma, createdCardVersions } = buildPrisma({
      curationSettings: { auditSampleRate: 0 },
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: buildDebate(acceptVerdict('unanimous')),
    });

    const res = await service.triage({
      ...criticalInput,
      resourceType: 'insight',
      confidence: 0.95,
    });

    expect(res.decision).toBe('auto');
    expect(createdCardVersions[0]?.trustTier).toBe('auto');
    expect(metrics.incCurationAutoCanonical).toHaveBeenCalled();
  });

  it('aiVerifierEnabled=false → критический тип идёт к человеку (deep), AI-судья не вызывается', async () => {
    const { prisma, createdCardVersions, createdCurationItems } = buildPrisma({
      curationSettings: { aiVerifierEnabled: false, auditSampleRate: 0 },
    });
    const debate = buildDebate(acceptVerdict('unanimous'));
    const service = makeService({ prisma, metrics, routing, debate });

    const res = await service.triage(criticalInput);

    expect(res.decision).toBe('deep');
    expect(createdCardVersions).toHaveLength(0);
    expect(createdCurationItems[0]?.level).toBe('deep');
    expect(debate?.judge).not.toHaveBeenCalled();
  });
});

/**
 * C2 «курация» — дефолты «лестницы доверия» вынесены из code-констант в
 * AdminSetting (cfg.curation, через resolveSync). Доказываем, что при
 * отсутствии per-Org override (`curationSettings === null`) платформенные
 * дефолты `getSettings` приходят ИЗ cfg, а не из захардкоженных DEFAULT_*.
 *
 * Детерминизм: только моки Prisma + cfg, без системного времени/сети.
 */
describe('CurationService.getSettings — дефолты курации из cfg/AdminSetting', () => {
  let metrics: BusinessMetricsService;
  let routing: CuratorRoutingService;

  beforeEach(() => {
    metrics = buildMetrics();
    routing = buildRouting();
  });

  it('curationSettings=null → дефолты A1/A2 берутся из cfg.curation, не из констант', async () => {
    const { prisma } = buildPrisma({ curationSettings: null });
    // Кастомные значения, отличные от code-fallback: если бы дефолты были
    // захардкожены — тест бы поймал регресс.
    const cfg = buildCfg({
      provisionalThresholdDefault: 0.91,
      aiVerifierEnabled: false,
      auditSampleRate: 0.11,
      autotuneEnabled: true,
      thresholdMin: 0.42,
      thresholdMax: 0.93,
      autotuneStep: 0.07,
      minDecisionsForAutotune: 33,
      maxProvisionalOverride: 0.27,
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: null,
      cfg,
    });

    const settings = await service.getSettings('tenant-A');

    // A1.
    expect(settings.provisionalThreshold).toBe(0.91);
    expect(settings.aiVerifierEnabled).toBe(false);
    expect(settings.auditSampleRate).toBe(0.11);
    // A2.
    expect(settings.autotuneEnabled).toBe(true);
    expect(settings.thresholdMin).toBe(0.42);
    expect(settings.thresholdMax).toBe(0.93);
    expect(settings.autotuneStep).toBe(0.07);
    expect(settings.minDecisionsForAutotune).toBe(33);
    expect(settings.maxProvisionalOverride).toBe(0.27);
  });

  it('per-Org override перекрывает дефолт cfg пофайлово, остальное — из cfg', async () => {
    const { prisma } = buildPrisma({
      curationSettings: { provisionalThreshold: 0.5 },
    });
    const cfg = buildCfg({
      provisionalThresholdDefault: 0.91,
      aiVerifierEnabled: false,
      autotuneEnabled: true,
    });
    const service = makeService({
      prisma,
      metrics,
      routing,
      debate: null,
      cfg,
    });

    const settings = await service.getSettings('tenant-A');

    expect(settings.provisionalThreshold).toBe(0.5); // per-Org override
    expect(settings.aiVerifierEnabled).toBe(false); // дефолт из cfg
    expect(settings.autotuneEnabled).toBe(true); // дефолт из cfg
  });
});
