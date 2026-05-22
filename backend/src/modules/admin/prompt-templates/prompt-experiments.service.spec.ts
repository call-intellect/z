/**
 * Фаза A.3 — unit-тесты для PromptExperimentsService.
 *
 * Покрываем (≥3 сценария из DoD):
 *   1) stickyAllocate() — детерминированный hash, сохраняет группу при retry.
 *   2) create() — Free-тариф (нет feature.prompt_experiments) → ForbiddenException.
 *   3) create() — несовпадение taskType между templateAId и templateBId → BadRequest.
 *   4) start() — лимит одновременных экспериментов (3) enforced.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { EntitlementService } from '../../entitlements/entitlement.service';

import {
  PromptExperimentsService,
  stickyAllocate,
} from './prompt-experiments.service';

function inHours(h: number): string {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

describe('stickyAllocate', () => {
  it('splitPercent=0 → всегда A', () => {
    for (let i = 0; i < 100; i++) {
      expect(stickyAllocate(`m-${i}`, 'e-1', 0)).toBe('A');
    }
  });

  it('splitPercent=100 → всегда B', () => {
    for (let i = 0; i < 100; i++) {
      expect(stickyAllocate(`m-${i}`, 'e-1', 100)).toBe('B');
    }
  });

  it('один и тот же meetingId + experimentId → одна и та же группа (sticky)', () => {
    const g1 = stickyAllocate('m-42', 'e-7', 50);
    const g2 = stickyAllocate('m-42', 'e-7', 50);
    const g3 = stickyAllocate('m-42', 'e-7', 50);
    expect(g1).toBe(g2);
    expect(g2).toBe(g3);
  });

  it('splitPercent=50 — распределение примерно поровну на большой выборке', () => {
    let countA = 0;
    let countB = 0;
    for (let i = 0; i < 1000; i++) {
      const g = stickyAllocate(`m-${i}`, 'e-1', 50);
      if (g === 'A') countA++;
      else countB++;
    }
    // Допускаем разброс ±10% (диапазон 400..600).
    expect(countA).toBeGreaterThan(400);
    expect(countA).toBeLessThan(600);
    expect(countB).toBeGreaterThan(400);
    expect(countB).toBeLessThan(600);
  });
});

function buildService(args: {
  hasFeature?: boolean;
  quota?: number;
  runningCount?: number;
}): {
  svc: PromptExperimentsService;
  prismaMock: ReturnType<typeof buildPrismaMock>;
  entMock: { hasFeature: ReturnType<typeof vi.fn>; getQuota: ReturnType<typeof vi.fn> };
} {
  const prismaMock = buildPrismaMock(args.runningCount ?? 0);
  const entMock = {
    hasFeature: vi.fn(async () => args.hasFeature ?? true),
    getQuota: vi.fn(async () => args.quota ?? 3),
  };
  const svc = new PromptExperimentsService(
    prismaMock as unknown as PrismaService,
    entMock as unknown as EntitlementService,
  );
  return { svc, prismaMock, entMock };
}

function buildPrismaMock(runningCount: number) {
  return {
    promptExperiment: {
      findUnique: vi.fn(async (_args: { where: { id: string } }) => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'e-new',
        ...data,
        startedAt: null,
        createdAt: new Date(),
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'e-1',
        status: 'running',
        ...data,
      })),
      count: vi.fn(async () => runningCount),
    },
    promptTemplateVersion: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        templateId: `t-${where.id}`,
        versionNumber: 1,
        systemPrompt: 'sys',
        outputSchema: {},
        toolName: null,
        template: {
          id: `t-${where.id}`,
          scope: 'system',
          orgId: null,
          taskType: 'summary',
          meetingType: 'sales',
        },
      })),
    },
    aiResult: { findMany: vi.fn(async () => []) },
    aiResultFeedback: { groupBy: vi.fn(async () => []) },
  };
}

describe('PromptExperimentsService.create', () => {
  it('Free-тариф без feature.prompt_experiments → 403', async () => {
    const { svc } = buildService({ hasFeature: false });
    await expect(
      svc.create(
        {
          orgId: 'org-1',
          templateAId: 'v-1',
          templateBId: 'v-2',
          splitPercent: 50,
        },
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        error: { code: 'feature_not_available' },
      },
    });
  });

  it('templateA === templateB → BadRequest', async () => {
    const { svc } = buildService({ hasFeature: true });
    await expect(
      svc.create(
        {
          orgId: 'org-1',
          templateAId: 'v-1',
          templateBId: 'v-1',
          splitPercent: 50,
        },
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'experiment_a_b_must_differ' } },
    });
  });

  it('taskType mismatch → BadRequest', async () => {
    const { svc, prismaMock } = buildService({ hasFeature: true });
    (
      prismaMock.promptTemplateVersion.findUnique as unknown as { mockImplementation: (fn: unknown) => void }
    ).mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'v-1') {
        return {
          id: 'v-1',
          templateId: 't-A',
          versionNumber: 1,
          systemPrompt: 'sys',
          outputSchema: {},
          toolName: null,
          template: {
            id: 't-A',
            scope: 'org',
            orgId: 'org-1',
            taskType: 'summary',
            meetingType: 'sales',
          },
        };
      }
      return {
        id: 'v-2',
        templateId: 't-B',
        versionNumber: 1,
        systemPrompt: 'sys',
        outputSchema: {},
        toolName: null,
        template: {
          id: 't-B',
          scope: 'org',
          orgId: 'org-1',
          taskType: 'tasks',
          meetingType: 'sales',
        },
      };
    });
    await expect(
      svc.create(
        {
          orgId: 'org-1',
          templateAId: 'v-1',
          templateBId: 'v-2',
          splitPercent: 50,
        },
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'experiment_a_b_task_type_mismatch' } },
    });
  });

  it('endsAt слишком близко → BadRequest', async () => {
    const { svc } = buildService({ hasFeature: true });
    await expect(
      svc.create(
        {
          orgId: 'org-1',
          templateAId: 'v-1',
          templateBId: 'v-2',
          splitPercent: 50,
          endsAt: new Date(Date.now() + 60 * 1000).toISOString(), // через минуту
        },
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'ends_at_too_close' } },
    });
  });

  it('успешное создание возвращает draft', async () => {
    const { svc, prismaMock } = buildService({ hasFeature: true });
    const created = await svc.create(
      {
        orgId: 'org-1',
        templateAId: 'v-1',
        templateBId: 'v-2',
        splitPercent: 50,
        endsAt: inHours(48),
      },
      { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
    );
    expect(prismaMock.promptExperiment.create).toHaveBeenCalled();
    expect(created.status).toBe('draft');
  });
});

describe('PromptExperimentsService.start', () => {
  it('лимит 3 одновременных → BadRequest на 4-м', async () => {
    const { svc, prismaMock } = buildService({
      hasFeature: true,
      quota: 3,
      runningCount: 3,
    });
    (
      prismaMock.promptExperiment.findUnique as unknown as { mockImplementation: (fn: unknown) => void }
    ).mockImplementation(
      async () =>
        ({
          id: 'e-4',
          orgId: 'org-1',
          status: 'draft',
          templateAId: 'v-1',
          templateBId: 'v-2',
          splitPercent: 50,
          startedAt: null,
          endsAt: null,
          createdById: 'u-1',
          notes: null,
          createdAt: new Date(),
        }) as never,
    );
    await expect(
      svc.start('e-4', { userId: 'u-1', isSuperAdmin: true, ownedOrgIds: [] }),
    ).rejects.toMatchObject({
      response: { error: { code: 'too_many_running_experiments' } },
    });
  });
});
