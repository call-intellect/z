/**
 * Unit-тесты `BusFactorAnalyzerCron` (Pulse Wave 6 §6.1).
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import {
  BusFactorAnalyzerCron,
  computeRiskLevel,
} from './bus-factor-analyzer.cron';

interface MockRow {
  categoryName: string;
  confidence: string;
  personId: string;
  person: { name: string; deletedAt: Date | null };
}

function buildCron(opts: {
  orgs: Array<{ id: string }>;
  rowsByOrg?: Record<string, MockRow[]>;
}): {
  cron: BusFactorAnalyzerCron;
  snapshotCreate: ReturnType<typeof vi.fn>;
} {
  const snapshotCreate = vi.fn();
  const orgFindMany = vi.fn(async () => opts.orgs);
  const embedFindMany = vi.fn(
    async (args: { where: { tenantId: string } }) => {
      return opts.rowsByOrg?.[args.where.tenantId] ?? [];
    },
  );

  const prisma = {
    org: { findMany: orgFindMany },
    personKnowledgeCategoryEmbedding: { findMany: embedFindMany },
    knowledgeRiskSnapshot: { create: snapshotCreate },
  } as unknown as PrismaService;

  return { cron: new BusFactorAnalyzerCron(prisma), snapshotCreate };
}

describe('computeRiskLevel', () => {
  it('critical когда 0 или 1 high-эксперт', () => {
    expect(computeRiskLevel(0)).toBe('critical');
    expect(computeRiskLevel(1)).toBe('critical');
  });
  it('warning когда 2-3 high-эксперта', () => {
    expect(computeRiskLevel(2)).toBe('warning');
    expect(computeRiskLevel(3)).toBe('warning');
  });
  it('ok когда ≥4 high-эксперта', () => {
    expect(computeRiskLevel(4)).toBe('ok');
    expect(computeRiskLevel(10)).toBe('ok');
  });
});

describe('BusFactorAnalyzerCron.runOnce', () => {
  it('happy path: создаёт snapshot per category с правильными counts', async () => {
    const rows: MockRow[] = [
      {
        categoryName: 'Кубернетес',
        confidence: 'high',
        personId: 'p1',
        person: { name: 'Иван', deletedAt: null },
      },
      {
        categoryName: 'Кубернетес',
        confidence: 'medium',
        personId: 'p2',
        person: { name: 'Анна', deletedAt: null },
      },
      {
        categoryName: 'GraphQL',
        confidence: 'low',
        personId: 'p3',
        person: { name: 'Олег', deletedAt: null },
      },
    ];
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      rowsByOrg: { org1: rows },
    });

    const stats = await cron.runOnce();

    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(2); // Кубернетес + GraphQL
    expect(stats.errors).toBe(0);

    const calls = snapshotCreate.mock.calls.map((c) => c[0].data);
    const k8s = calls.find((c) => c.categoryName === 'Кубернетес');
    expect(k8s).toBeDefined();
    expect(k8s.highConfidenceCount).toBe(1);
    expect(k8s.totalExpertsCount).toBe(2);
    expect(k8s.riskLevel).toBe('critical'); // 1 high → critical
    expect(k8s.topExpertsJson).toEqual({
      experts: [
        { personId: 'p1', name: 'Иван', confidence: 'high' },
        { personId: 'p2', name: 'Анна', confidence: 'medium' },
      ],
    });

    const graphql = calls.find((c) => c.categoryName === 'GraphQL');
    expect(graphql.highConfidenceCount).toBe(0);
    expect(graphql.totalExpertsCount).toBe(0); // только low
    expect(graphql.riskLevel).toBe('critical');
  });

  it('пропускает удалённых person', async () => {
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      rowsByOrg: {
        org1: [
          {
            categoryName: 'X',
            confidence: 'high',
            personId: 'p1',
            person: { name: 'Удалённый', deletedAt: new Date() },
          },
        ],
      },
    });
    const stats = await cron.runOnce();
    expect(stats.snapshotsCreated).toBe(0);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it('no data: пустая Org не падает, snapshot не создаётся', async () => {
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org-empty' }],
      rowsByOrg: { 'org-empty': [] },
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(0);
    expect(stats.errors).toBe(0);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });
});
