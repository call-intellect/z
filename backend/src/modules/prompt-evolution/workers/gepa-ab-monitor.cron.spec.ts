/**
 * Agents v2 Фаза C2 (2026-05-30) — Unit-тесты `GepaAbMonitorCron`.
 *
 * Сценарии (с fixture данными):
 *   1. B заметно хуже A → status='rejected' с reason='ab_deg_detected'.
 *   2. B заметно лучше A + достаточно invocations → promote (LlmTaskRoute.promptOverride).
 *   3. B лучше A, но invocations < min → continue (no decision).
 *   4. cfg.gepa.enabled=false → no-op.
 *   5. Нет A control data → skip без падения.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { GepaAbMonitorCron } from './gepa-ab-monitor.cron';

function makeCfg(enabled = true): Partial<TypedConfigService> {
  return {
    get gepa() {
      return {
        enabled,
        maxMetricCalls: 150,
        reflectionLm: 'deepseek-v4-pro',
        taskLm: 'deepseek-v4-pro',
        abTrafficShare: 0.1,
        abMinInvocationsBeforeDecision: 100,
        abPromoteThreshold: 0.05,
        abRejectThreshold: 0.1,
        serviceUrl: 'http://gepa:8000',
        timeoutMs: 3_600_000,
      } as const;
    },
  } as Partial<TypedConfigService>;
}

function makeMetrics() {
  return {
    incGepaPromoted: vi.fn(),
    incGepaRejected: vi.fn(),
    incGepaRollback: vi.fn(),
    setGepaAbActive: vi.fn(),
  } as unknown as BusinessMetricsService;
}

interface CandidateRow {
  id: string;
  tenantId: string | null;
  promptKey: string;
  promptText: string;
  status: string;
  compositeScore: number | null;
  evaluations: number;
}

interface GroupRow {
  grp: 'A' | 'B';
  cnt: bigint;
  avg_dist: number | null;
}

function makePrisma(args: {
  testing: CandidateRow[];
  groupRows: GroupRow[];
  routes?: Array<{ id: string; promptOverride: string | null }>;
}) {
  const updateCandidate = vi.fn().mockResolvedValue({});
  const updateRoute = vi.fn().mockResolvedValue({});
  const createRoute = vi.fn().mockResolvedValue({});
  return {
    prisma: {
      promptCandidate: {
        findMany: vi.fn().mockResolvedValue(args.testing),
        update: updateCandidate,
        count: vi.fn().mockResolvedValue(args.testing.length),
      },
      llmTaskRoute: {
        findMany: vi.fn().mockResolvedValue(args.routes ?? []),
        update: updateRoute,
        create: createRoute,
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue(args.groupRows),
    } as unknown as PrismaService,
    updateCandidate,
    updateRoute,
    createRoute,
  };
}

describe('GepaAbMonitorCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1) B заметно хуже A → reject с ab_deg_detected', async () => {
    const { prisma, updateCandidate } = makePrisma({
      testing: [
        {
          id: 'c1',
          tenantId: 'org-1',
          promptKey: 'meeting-report-fast',
          promptText: 'new prompt',
          status: 'testing',
          compositeScore: null,
          evaluations: 0,
        },
      ],
      groupRows: [
        // A: 200 invocations, avg edit_distance=0.2 → composite=0.8.
        { grp: 'A', cnt: 200n, avg_dist: 0.2 },
        // B: 50 invocations, avg edit_distance=0.5 → composite=0.5 (Δ=-0.3, > 0.1 порог).
        { grp: 'B', cnt: 50n, avg_dist: 0.5 },
      ],
    });
    const metrics = makeMetrics();
    const cron = new GepaAbMonitorCron(prisma, makeCfg() as TypedConfigService, metrics);

    await cron.tick();

    // Найдём update'ы кандидата (один может быть на eval-snapshot, второй — на rejected).
    const calls = updateCandidate.mock.calls.map((c) => c[0] as { data: Record<string, unknown> });
    const rejectCall = calls.find((c) => c.data.status === 'rejected');
    expect(rejectCall).toBeDefined();
    expect(rejectCall!.data.rejectedReason).toBe('ab_deg_detected');
    expect(metrics.incGepaRejected).toHaveBeenCalledWith({
      reason: 'ab_deg_detected',
    });
    expect(metrics.incGepaRollback).toHaveBeenCalledWith({ reason: 'ab_deg' });
  });

  it('2) B заметно лучше A + >100 invocations → PROMOTE', async () => {
    const { prisma, updateCandidate, updateRoute, createRoute } = makePrisma({
      testing: [
        {
          id: 'c2',
          tenantId: 'org-1',
          promptKey: 'meeting-report-fast',
          promptText: 'better prompt',
          status: 'testing',
          compositeScore: null,
          evaluations: 0,
        },
      ],
      groupRows: [
        // A: 200 inv, avg=0.5 → composite=0.5.
        { grp: 'A', cnt: 200n, avg_dist: 0.5 },
        // B: 120 inv, avg=0.3 → composite=0.7 (Δ=+0.2, > 0.05 порог).
        { grp: 'B', cnt: 120n, avg_dist: 0.3 },
      ],
      routes: [
        { id: 'r1', promptOverride: 'old-text' },
      ],
    });
    const metrics = makeMetrics();
    const cron = new GepaAbMonitorCron(prisma, makeCfg() as TypedConfigService, metrics);

    await cron.tick();

    const calls = updateCandidate.mock.calls.map((c) => c[0] as { data: Record<string, unknown> });
    const promoteCall = calls.find((c) => c.data.status === 'promoted');
    expect(promoteCall).toBeDefined();
    expect(promoteCall!.data.promotedAt).toBeInstanceOf(Date);

    expect(updateRoute).toHaveBeenCalled();
    const routeData = updateRoute.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(routeData.data.promptOverride).toBe('better prompt');
    expect(String(routeData.data.pinnedVersionNote)).toContain('Auto-promoted by GEPA');

    expect(metrics.incGepaPromoted).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
    });
    expect(createRoute).not.toHaveBeenCalled();
  });

  it('3) B лучше, но invocations < min → продолжаем (no decision)', async () => {
    const { prisma, updateCandidate, updateRoute } = makePrisma({
      testing: [
        {
          id: 'c3',
          tenantId: 'org-1',
          promptKey: 'meeting-report-fast',
          promptText: 'maybe-better',
          status: 'testing',
          compositeScore: null,
          evaluations: 0,
        },
      ],
      groupRows: [
        { grp: 'A', cnt: 200n, avg_dist: 0.5 },
        { grp: 'B', cnt: 50n, avg_dist: 0.3 }, // 50 < 100 min
      ],
    });
    const metrics = makeMetrics();
    const cron = new GepaAbMonitorCron(prisma, makeCfg() as TypedConfigService, metrics);

    await cron.tick();

    // Только snapshot-update (evaluations + compositeScore), без promote/reject.
    const calls = updateCandidate.mock.calls.map((c) => c[0] as { data: Record<string, unknown> });
    expect(calls.some((c) => c.data.status === 'promoted')).toBe(false);
    expect(calls.some((c) => c.data.status === 'rejected')).toBe(false);
    expect(updateRoute).not.toHaveBeenCalled();
    expect(metrics.incGepaPromoted).not.toHaveBeenCalled();
    expect(metrics.incGepaRejected).not.toHaveBeenCalled();
  });

  it('4) cfg.gepa.enabled=false → no-op (findMany не вызывался)', async () => {
    const { prisma } = makePrisma({ testing: [], groupRows: [] });
    const cfg = makeCfg(false);
    const metrics = makeMetrics();
    const cron = new GepaAbMonitorCron(prisma, cfg as TypedConfigService, metrics);

    await cron.tick();

    expect(prisma.promptCandidate.findMany).not.toHaveBeenCalled();
  });

  it('5) нет A control data → skip без падения', async () => {
    const { prisma, updateCandidate } = makePrisma({
      testing: [
        {
          id: 'c5',
          tenantId: 'org-1',
          promptKey: 'meeting-report-fast',
          promptText: 'p',
          status: 'testing',
          compositeScore: null,
          evaluations: 0,
        },
      ],
      groupRows: [
        // только B, A=0
        { grp: 'B', cnt: 30n, avg_dist: 0.4 },
      ],
    });
    const metrics = makeMetrics();
    const cron = new GepaAbMonitorCron(prisma, makeCfg() as TypedConfigService, metrics);

    await cron.tick();

    const calls = updateCandidate.mock.calls.map((c) => c[0] as { data: Record<string, unknown> });
    // Только snapshot update, без promote/reject.
    expect(calls.some((c) => c.data.status === 'promoted')).toBe(false);
    expect(calls.some((c) => c.data.status === 'rejected')).toBe(false);
    expect(metrics.incGepaPromoted).not.toHaveBeenCalled();
    expect(metrics.incGepaRejected).not.toHaveBeenCalled();
  });
});
