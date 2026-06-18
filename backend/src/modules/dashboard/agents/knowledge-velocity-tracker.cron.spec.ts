import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeVelocityTrackerCron } from './knowledge-velocity-tracker.cron';

interface MockGap {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  trustedAnswer: string;
  entities: Array<{
    role: string | null;
    entity: { persons: Array<{ id: string; name: string }> } | null;
  }>;
}

function buildCron(opts: { orgs: Array<{ id: string }>; gapsByOrg?: Record<string, MockGap[]> }): {
  cron: KnowledgeVelocityTrackerCron;
  snapshotCreate: ReturnType<typeof vi.fn>;
} {
  const snapshotCreate = vi.fn();
  const orgFindMany = vi.fn(async () => opts.orgs);
  const ideaBlockFindMany = vi.fn(
    async (args: { where: { tenantId: string } }) => opts.gapsByOrg?.[args.where.tenantId] ?? [],
  );

  const prisma = {
    org: { findMany: orgFindMany },
    ideaBlock: { findMany: ideaBlockFindMany },
    knowledgeVelocitySnapshot: { create: snapshotCreate },
  } as unknown as PrismaService;

  return {
    cron: new KnowledgeVelocityTrackerCron(prisma),
    snapshotCreate,
  };
}

describe('KnowledgeVelocityTrackerCron.runOnce', () => {
  it('happy path: считает median hours и top responders', async () => {
    const t0 = new Date('2026-05-20T10:00:00Z');
    const t6h = new Date('2026-05-20T16:00:00Z');
    const t24h = new Date('2026-05-21T10:00:00Z');
    const t48h = new Date('2026-05-22T10:00:00Z');

    const gaps: MockGap[] = [
      {
        id: 'g1',
        createdAt: t0,
        updatedAt: t6h,
        trustedAnswer: 'Подробный ответ от Анны на вопрос про k8s',
        entities: [
          {
            role: 'subject',
            entity: { persons: [{ id: 'p_author', name: 'Автор' }] },
          },
          {
            role: 'mentioned',
            entity: { persons: [{ id: 'p_anna', name: 'Анна' }] },
          },
        ],
      },
      {
        id: 'g2',
        createdAt: t0,
        updatedAt: t24h,
        trustedAnswer: 'Другой развёрнутый ответ',
        entities: [
          {
            role: 'object',
            entity: { persons: [{ id: 'p_anna', name: 'Анна' }] },
          },
        ],
      },
      {
        id: 'g3',
        createdAt: t0,
        updatedAt: t48h,
        trustedAnswer: 'Третий полноценный ответ команды',
        entities: [],
      },
      {
        id: 'g4',
        createdAt: t0,
        updatedAt: t0,
        trustedAnswer: '',
        entities: [],
      },
    ];

    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      gapsByOrg: { org1: gaps },
    });

    const stats = await cron.runOnce();

    expect(stats.snapshotsCreated).toBe(1);
    const data = snapshotCreate.mock.calls[0]?.[0].data;
    expect(data.resolvedGapsCount).toBe(3);
    expect(data.openGapsCount).toBe(1);
    expect(Number(data.medianHoursToAnswer)).toBe(24);
    const responders = data.topRespondersJson.responders as Array<{
      personId: string;
      resolvedCount: number;
    }>;
    expect(responders[0]?.personId).toBe('p_anna');
    expect(responders[0]?.resolvedCount).toBe(2);
    expect(responders.find((r) => r.personId === 'p_author')).toBeUndefined();
  });

  it('пропускает блоки с коротким trustedAnswer (< MIN_ANSWER_LEN)', async () => {
    const t0 = new Date('2026-05-20T10:00:00Z');
    const t6h = new Date('2026-05-20T16:00:00Z');
    const gaps: MockGap[] = [
      {
        id: 'g1',
        createdAt: t0,
        updatedAt: t6h,
        trustedAnswer: 'да',
        entities: [],
      },
    ];
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      gapsByOrg: { org1: gaps },
    });
    const stats = await cron.runOnce();
    expect(stats.snapshotsCreated).toBe(1);
    const data = snapshotCreate.mock.calls[0]?.[0].data;
    expect(data.resolvedGapsCount).toBe(0);
    expect(data.openGapsCount).toBe(1);
  });

  it('no data: пустая Org → snapshot не создаётся', async () => {
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org-empty' }],
      gapsByOrg: { 'org-empty': [] },
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(0);
    expect(stats.errors).toBe(0);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });
});
