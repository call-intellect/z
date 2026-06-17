import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  KnowledgeAccessContext,
  KnowledgeAccessResolver,
} from '../../rbac/knowledge-access-resolver.service';

import { ChatV2Service } from './chat-v2.service';

interface BlockRow {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  dataClass: string;
}

function buildService(opts: {
  blockRows: BlockRow[];
  partition?: { accessible: string[]; denied: number };
}): {
  service: ChatV2Service;
  partitionSpy: ReturnType<typeof vi.fn>;
  incDenied: ReturnType<typeof vi.fn>;
  incShadow: ReturnType<typeof vi.fn>;
  blockFindMany: ReturnType<typeof vi.fn>;
} {
  const blockFindMany = vi.fn(async () => opts.blockRows);
  const prisma = {
    ideaBlock: { findMany: blockFindMany },
    ideaBlockEvidence: { findMany: vi.fn(async () => []) },
    rawEvent: { findMany: vi.fn(async () => []) },
    meeting: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;

  const partitionSpy = vi.fn(async () => opts.partition ?? { accessible: [], denied: 0 });
  const accessResolver = {
    partitionBlockIdsByAccess: partitionSpy,
  } as unknown as KnowledgeAccessResolver;

  const incDenied = vi.fn();
  const incShadow = vi.fn();
  const metrics = {
    incAccessDenied: incDenied,
    incAccessShadowDiff: incShadow,
  } as unknown as BusinessMetricsService;

  const service = new ChatV2Service(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    metrics,
    accessResolver,
  );
  return { service, partitionSpy, incDenied, incShadow, blockFindMany };
}

type LoadContextBlocks = (
  tenantId: string,
  blockIds: string[],
  accessCtx: KnowledgeAccessContext | null,
  enforcement: 'off' | 'shadow' | 'enforce',
  surface: string,
) => Promise<Array<{ id: string }>>;

function loadCtx(service: ChatV2Service): LoadContextBlocks {
  return (service as unknown as { loadContextBlocks: LoadContextBlocks }).loadContextBlocks.bind(
    service,
  );
}

const ALL_IDS = ['b1', 'b2', 'b3'];
const ROWS: BlockRow[] = [
  { id: 'b1', name: 'B1', signalType: 'fact', trustedAnswer: 'a1', dataClass: 'internal' },
  { id: 'b2', name: 'B2', signalType: 'fact', trustedAnswer: 'a2', dataClass: 'internal' },
  { id: 'b3', name: 'B3', signalType: 'fact', trustedAnswer: 'a3', dataClass: 'internal' },
];

describe('ChatV2Service.loadContextBlocks — Ф4 гейт доступа', () => {
  it('off (accessCtx=null) → partition НЕ вызывается, выдача = все blockIds', async () => {
    const { service, partitionSpy, blockFindMany } = buildService({ blockRows: ROWS });
    const out = await loadCtx(service)('t-1', ALL_IDS, null, 'off', 'chat');
    expect(partitionSpy).not.toHaveBeenCalled();
    expect(out.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3']);
    expect(blockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ALL_IDS } }),
      }),
    );
  });

  it('bypass-ctx → partition НЕ влияет (resolver сам вернёт все), выдача = все', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const { service, partitionSpy } = buildService({ blockRows: ROWS });
    const out = await loadCtx(service)('t-1', ALL_IDS, ctx, 'enforce', 'chat');
    expect(partitionSpy).not.toHaveBeenCalled();
    expect(out.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('enforce → недоступные отфильтрованы + incAccessDenied(denied)', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { service, partitionSpy, incDenied, incShadow, blockFindMany } = buildService({
      blockRows: ROWS.filter((r) => r.id !== 'b2'),
      partition: { accessible: ['b1', 'b3'], denied: 1 },
    });
    const out = await loadCtx(service)('t-1', ALL_IDS, ctx, 'enforce', 'chat');
    expect(partitionSpy).toHaveBeenCalledWith(ctx, ALL_IDS);
    expect(blockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['b1', 'b3'] } }),
      }),
    );
    expect(out.map((b) => b.id).sort()).toEqual(['b1', 'b3']);
    expect(incDenied).toHaveBeenCalledWith({ surface: 'chat' }, 1);
    expect(incShadow).not.toHaveBeenCalled();
  });

  it('shadow → выдача НЕ меняется (все blockIds) + incAccessShadowDiff(denied)', async () => {
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    };
    const { service, partitionSpy, incDenied, incShadow, blockFindMany } = buildService({
      blockRows: ROWS,
      partition: { accessible: ['b1', 'b3'], denied: 1 },
    });
    const out = await loadCtx(service)('t-1', ALL_IDS, ctx, 'shadow', 'chat');
    expect(partitionSpy).toHaveBeenCalledWith(ctx, ALL_IDS);
    expect(blockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ALL_IDS } }),
      }),
    );
    expect(out.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3']);
    expect(incShadow).toHaveBeenCalledWith({ surface: 'chat' }, 1);
    expect(incDenied).not.toHaveBeenCalled();
  });
});
