import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { AiQueueService } from '../ai/ai-queue.service';
import type { EntitlementService } from '../entitlements/entitlement.service';

import { MeetingReportsService } from './meeting-reports.service';

interface BuildHarnessOpts {
  meeting?: Record<string, unknown> | null;
  meetingMembership?: { role: 'owner' | 'admin' | 'manager' } | null;
  feature?: boolean;
  tierLimit?: number;
  liveCount?: number;
  template?: Record<string, unknown> | null;
  existingPending?: Record<string, unknown> | null;
  aiResult?: Record<string, unknown> | null;
}

function buildHarness(opts: BuildHarnessOpts = {}): {
  svc: MeetingReportsService;
  enqueue: ReturnType<typeof vi.fn>;
  reportCreate: ReturnType<typeof vi.fn>;
  metricsCreated: ReturnType<typeof vi.fn>;
} {
  const meeting = opts.meeting ?? {
    id: 'meet-1',
    ownerId: 'user-host',
    tenantId: 'org-1',
    type: 'sales',
  };

  const reportCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'mr-new',
    ...args.data,
  }));

  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => meeting),
    },
    aiResult: {
      findUnique: vi.fn(async () => opts.aiResult ?? null),
    },
    meetingReport: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => opts.existingPending ?? null),
      count: vi.fn(async () => opts.liveCount ?? 0),
      create: reportCreate,
      update: vi.fn(),
    },
    promptTemplate: {
      findFirst: vi.fn(
        async () =>
          opts.template ?? {
            id: 'tpl-1',
            name: 'Sales Coach',
            activeVersionId: 'ver-1',
            activeVersion: { id: 'ver-1' },
          },
      ),
      findMany: vi.fn(async () => []),
    },
    promptTemplateVersion: {
      findFirst: vi.fn(async () => null),
    },
    membership: {
      findFirst: vi.fn(async () => opts.meetingMembership ?? null),
    },
  } as unknown as PrismaService;

  const redis = {
    client: {
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    },
  } as unknown as RedisService;

  const enqueue = vi.fn(async () => undefined);
  const queue = {
    enqueueCustomReport: enqueue,
  } as unknown as AiQueueService;

  const entitlements = {
    getEntitlement: vi.fn(async () => ({
      tier: opts.feature === false ? 'tier_basic' : 'tier_pro',
      features: {
        'feature.multi_reports_per_meeting': opts.feature !== false,
      } as Record<string, boolean>,
      quotas: {
        multi_reports_limit_per_meeting: opts.tierLimit ?? 5,
      } as Record<string, number>,
    })),
  } as unknown as EntitlementService;

  const metricsCreated = vi.fn();
  const metrics = {
    incMeetingReportCreated: metricsCreated,
  } as unknown as BusinessMetricsService;

  const svc = new MeetingReportsService(prisma, redis, queue, entitlements, metrics);

  return { svc, enqueue, reportCreate, metricsCreated };
}

describe('MeetingReportsService.create', () => {
  it('Free-тариф (нет фичи) → 403 entitlement_required', async () => {
    const h = buildHarness({ feature: false });
    await expect(
      h.svc.create('meet-1', 'user-host', { templateId: 'tpl-1' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'entitlement_required' }),
      }),
    });
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('Pro-тариф 6-й отчёт при лимите 5 → 403 multi_reports_limit_exceeded', async () => {
    const h = buildHarness({ feature: true, tierLimit: 5, liveCount: 5 });
    await expect(
      h.svc.create('meet-1', 'user-host', { templateId: 'tpl-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('Существующий pending по тому же шаблону → 409 conflict', async () => {
    const h = buildHarness({
      feature: true,
      tierLimit: 5,
      liveCount: 1,
      existingPending: { id: 'mr-existing', status: 'pending' },
    });
    await expect(
      h.svc.create('meet-1', 'user-host', { templateId: 'tpl-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('Happy path: create + enqueueCustomReport + metric created', async () => {
    const h = buildHarness({ feature: true, tierLimit: 5, liveCount: 0 });
    const result = await h.svc.create('meet-1', 'user-host', {
      templateId: 'tpl-1',
    });
    expect(result.status).toBe('pending');
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.reportCreate).toHaveBeenCalledTimes(1);
    expect(h.metricsCreated).toHaveBeenCalledWith({ kind: 'additional' });
  });
});

describe('MeetingReportsService.get', () => {
  it('get primary by aiResult.id → 200 с output (S6-07)', async () => {
    const h = buildHarness({
      aiResult: {
        id: 'ai-1',
        meetingId: 'meet-1',
        summary: 'Краткое саммари',
        structuredData: { tasks: ['t1'], decisions: [] },
        meetingType: 'sales',
        createdAt: new Date('2026-06-06T10:00:00Z'),
        updatedAt: new Date('2026-06-06T10:05:00Z'),
        promptTemplateVersion: null,
      },
    });
    const result = await h.svc.get('meet-1', 'ai-1', 'user-host');
    expect(result.kind).toBe('primary');
    expect(result.id).toBe('ai-1');
    expect(result.output).toEqual({ tasks: ['t1'], decisions: [] });
    expect(result.promptTemplateVersionId).toBeNull();
  });

  it('get неизвестного reportId → NotFoundException', async () => {
    const h = buildHarness({ aiResult: null });
    await expect(h.svc.get('meet-1', 'unknown-id', 'user-host')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
