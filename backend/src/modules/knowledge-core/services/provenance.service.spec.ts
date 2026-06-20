import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import {
  buildProvenanceDeepLink,
  PROVENANCE_ACCESS_MASK,
  ProvenanceService,
} from './provenance.service';

describe('buildProvenanceDeepLink (RC-6 — мс → сек)', () => {
  it('meeting: startMs делится на 1000 в ?t=<sec>', () => {
    expect(
      buildProvenanceDeepLink({ sourceType: 'meeting', externalId: 'm1', startMs: 90_000 }),
    ).toBe('/meetings/m1?t=90');
  });

  it('meeting: startMs null → ?t=0', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'meeting', externalId: 'm1' })).toBe(
      '/meetings/m1?t=0',
    );
  });

  it('document → /documents/:id (без таймкода)', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'document', externalId: 'd1' })).toBe(
      '/documents/d1',
    );
  });

  it('chat → null (нет deep-link во второй волне)', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'chat', externalId: 'c1' })).toBeNull();
  });

  it('пустой externalId → null', () => {
    expect(buildProvenanceDeepLink({ sourceType: 'meeting', externalId: '', startMs: 1000 })).toBeNull();
  });
});

function buildService(opts: {
  prisma: Partial<Record<string, unknown>>;
  isBypass?: boolean;
  accessibleIds?: Set<string>;
}): ProvenanceService {
  const accessResolver = {
    resolveAccessibleGroups: vi.fn(async () => ({
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: opts.isBypass ?? true,
    })),
    partitionProjectionsByAccess: vi.fn(
      async (_ctx: unknown, items: Array<{ id: string }>) => ({
        accessibleIds:
          opts.accessibleIds ?? new Set(items.map((i) => i.id)),
        denied: 0,
      }),
    ),
  } as unknown as KnowledgeAccessResolver;
  return new ProvenanceService(
    opts.prisma as unknown as PrismaService,
    accessResolver,
  );
}

describe('ProvenanceService.resolve — последняя миля', () => {
  function meetingPrisma() {
    return {
      decision: {
        findFirst: vi.fn(async () => ({ sourceBlockIds: ['b-1'] })),
      },
      ideaBlock: {
        findMany: vi.fn(async () => [{ id: 'b-1', primarySource: 'transcript' }]),
      },
      ideaBlockEvidence: {
        findMany: vi.fn(async () => [
          {
            blockId: 'b-1',
            rawEventId: 'raw-1',
            quote: 'Переходим на недельные спринты',
            startMs: 90_000,
            endMs: 95_000,
            sourceTimestamp: new Date('2026-03-10T09:00:00.000Z'),
          },
        ]),
      },
      rawEvent: {
        findMany: vi.fn(async () => [
          { id: 'raw-1', sourceType: 'meeting', sourceExternalId: 'm-1' },
        ]),
      },
      meeting: {
        findMany: vi.fn(async () => [{ id: 'm-1', title: 'Планёрка' }]),
      },
      document: { findMany: vi.fn(async () => []) },
    };
  }

  it('meeting-источник: цитата + deepLink с точным таймкодом + attribution=quoted', async () => {
    const svc = buildService({ prisma: meetingPrisma(), isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.blockId).toBe('b-1');
    expect(n.quote).toBe('Переходим на недельные спринты');
    expect(n.attribution).toBe('quoted');
    expect(n.accessFiltered).toBe(false);
    expect(n.startMs).toBe(90_000);
    expect(n.source).toEqual({
      type: 'meeting',
      refId: 'm-1',
      label: 'Встреча «Планёрка»',
      deepLink: '/meetings/m-1?t=90',
    });
  });

  it('report-блок → attribution=inferred', async () => {
    const prisma = meetingPrisma();
    prisma.ideaBlock.findMany = vi.fn(async () => [
      { id: 'b-1', primarySource: 'report' },
    ]);
    const svc = buildService({ prisma, isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes[0]!.attribution).toBe('inferred');
  });

  it('блок недоступен зрителю → accessFiltered, quote/label/deepLink замаскированы', async () => {
    const svc = buildService({
      prisma: meetingPrisma(),
      isBypass: false,
      accessibleIds: new Set<string>(),
    });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toHaveLength(1);
    const n = nodes[0]!;
    expect(n.accessFiltered).toBe(true);
    expect(n.quote).toBe(PROVENANCE_ACCESS_MASK);
    expect(n.source.label).toBe(PROVENANCE_ACCESS_MASK);
    expect(n.source.refId).toBeNull();
    expect(n.source.deepLink).toBeNull();
    expect(n.startMs).toBeNull();
  });

  it('сущность без sourceBlockIds → пустой результат (создано вручную)', async () => {
    const prisma = meetingPrisma();
    prisma.decision.findFirst = vi.fn(async () => ({ sourceBlockIds: [] }));
    const svc = buildService({ prisma, isBypass: true });
    const nodes = await svc.resolve('decision', 'd-1', {
      tenantId: 't-1',
      userId: 'u-1',
    });
    expect(nodes).toEqual([]);
  });
});
