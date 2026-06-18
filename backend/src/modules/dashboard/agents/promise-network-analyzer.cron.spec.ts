import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { PromiseNetworkAnalyzerCron, classifyRole } from './promise-network-analyzer.cron';

interface MockCommitment {
  id: string;
  commitmentRecipientPersonId: string;
  commitmentRecipient: { id: string; name: string };
  entities: Array<{
    role: string | null;
    entity: { persons: Array<{ id: string; name: string }> } | null;
  }>;
}

function buildCron(opts: {
  orgs: Array<{ id: string }>;
  commitmentsByOrg?: Record<string, MockCommitment[]>;
}): {
  cron: PromiseNetworkAnalyzerCron;
  snapshotCreate: ReturnType<typeof vi.fn>;
} {
  const snapshotCreate = vi.fn();
  const orgFindMany = vi.fn(async () => opts.orgs);
  const ideaBlockFindMany = vi.fn(
    async (args: { where: { tenantId: string } }) =>
      opts.commitmentsByOrg?.[args.where.tenantId] ?? [],
  );

  const prisma = {
    org: { findMany: orgFindMany },
    ideaBlock: { findMany: ideaBlockFindMany },
    promiseNetworkSnapshot: { create: snapshotCreate },
  } as unknown as PrismaService;

  return { cron: new PromiseNetworkAnalyzerCron(prisma), snapshotCreate };
}

function commitmentWith(args: {
  id: string;
  authorPersonId: string;
  authorName: string;
  recipientPersonId: string;
  recipientName: string;
}): MockCommitment {
  return {
    id: args.id,
    commitmentRecipientPersonId: args.recipientPersonId,
    commitmentRecipient: { id: args.recipientPersonId, name: args.recipientName },
    entities: [
      {
        role: 'subject',
        entity: {
          persons: [{ id: args.authorPersonId, name: args.authorName }],
        },
      },
    ],
  };
}

describe('classifyRole', () => {
  it('isolated при in+out <= 1', () => {
    expect(classifyRole(0, 0)).toBe('isolated');
    expect(classifyRole(1, 0)).toBe('isolated');
    expect(classifyRole(0, 1)).toBe('isolated');
  });
  it('accumulator: inDegree >= 3*outDegree и in >= 3', () => {
    expect(classifyRole(3, 0)).toBe('accumulator');
    expect(classifyRole(6, 2)).toBe('accumulator');
  });
  it('donor: outDegree >= 3*inDegree и out >= 3', () => {
    expect(classifyRole(0, 3)).toBe('donor');
    expect(classifyRole(2, 6)).toBe('donor');
  });
  it('balanced иначе', () => {
    expect(classifyRole(2, 2)).toBe('balanced');
    expect(classifyRole(3, 2)).toBe('balanced');
  });
});

describe('PromiseNetworkAnalyzerCron.runOnce', () => {
  it('happy path: строит граф с edges и nodes', async () => {
    const commits: MockCommitment[] = [
      commitmentWith({
        id: 'c1',
        authorPersonId: 'p1',
        authorName: 'A',
        recipientPersonId: 'p2',
        recipientName: 'B',
      }),
      commitmentWith({
        id: 'c2',
        authorPersonId: 'p1',
        authorName: 'A',
        recipientPersonId: 'p2',
        recipientName: 'B',
      }),
      commitmentWith({
        id: 'c3',
        authorPersonId: 'p1',
        authorName: 'A',
        recipientPersonId: 'p3',
        recipientName: 'C',
      }),
    ];
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      commitmentsByOrg: { org1: commits },
    });

    const stats = await cron.runOnce();

    expect(stats.snapshotsCreated).toBe(1);
    const data = snapshotCreate.mock.calls[0]?.[0].data;
    expect(data.totalCommitments).toBe(3);
    const graph = data.graphJson as {
      nodes: Array<{ personId: string; inDegree: number; outDegree: number; role: string }>;
      edges: Array<{ fromPersonId: string; toPersonId: string; count: number }>;
    };
    expect(graph.nodes).toHaveLength(3);
    const p1 = graph.nodes.find((n) => n.personId === 'p1');
    const p2 = graph.nodes.find((n) => n.personId === 'p2');
    expect(p1?.outDegree).toBe(3);
    expect(p1?.inDegree).toBe(0);
    expect(p1?.role).toBe('donor');
    expect(p2?.inDegree).toBe(2);
    expect(p2?.outDegree).toBe(0);

    const edgeP1P2 = graph.edges.find((e) => e.fromPersonId === 'p1' && e.toPersonId === 'p2');
    expect(edgeP1P2?.count).toBe(2);
  });

  it('игнорирует self-promise (author === recipient)', async () => {
    const commits: MockCommitment[] = [
      commitmentWith({
        id: 'c1',
        authorPersonId: 'p1',
        authorName: 'A',
        recipientPersonId: 'p1',
        recipientName: 'A',
      }),
    ];
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      commitmentsByOrg: { org1: commits },
    });
    const stats = await cron.runOnce();
    expect(stats.snapshotsCreated).toBe(0);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it('no data: пустая Org не падает', async () => {
    const { cron, snapshotCreate } = buildCron({
      orgs: [{ id: 'org-empty' }],
      commitmentsByOrg: { 'org-empty': [] },
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(0);
    expect(stats.errors).toBe(0);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });
});
