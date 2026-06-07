/**
 * Ф4 knowledge-access — фокус-тесты выходного шлюза chat-v2
 * (приватный `loadContextBlocks`). Проверяем гейт-семантику:
 *   - off (accessCtx=null) → partition НЕ вызывается, выдача = все blockIds.
 *   - enforce → недоступные отфильтрованы + incAccessDenied.
 *   - shadow → выдача НЕ меняется + incAccessShadowDiff.
 *
 * Прямой вызов приватного метода через any-cast — изолируем шлюз от
 * retrieval/LLM. prisma.ideaBlock.findMany возвращает блоки по effectiveIds;
 * evidence/rawEvent/meeting findMany — пустые (primaryMeetingEvidence=null,
 * для гейт-логики не важно).
 */
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

  const partitionSpy = vi.fn(
    async () => opts.partition ?? { accessible: [], denied: 0 },
  );
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
    {} as never, // cfg — не используется в loadContextBlocks
    {} as never, // llm
    {} as never, // retrieval
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
  // Приватный метод — вызываем через any-cast (привязка к инстансу).
  return (service as unknown as { loadContextBlocks: LoadContextBlocks })
    .loadContextBlocks.bind(service);
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
    // findMany получил все blockIds (байт-в-байт).
    expect(blockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ALL_IDS } }),
      }),
    );
  });

  it('bypass-ctx → partition НЕ влияет (resolver сам вернёт все), выдача = все', async () => {
    // bypass: partition вернёт все accessible, но мы проверяем что enforce
    // всё равно вызывает partition (он внутри сам шорткатит bypass).
    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: true,
    };
    const { service, partitionSpy } = buildService({ blockRows: ROWS });
    const out = await loadCtx(service)('t-1', ALL_IDS, ctx, 'enforce', 'chat');
    // isBypass → метод не зовёт partition (ранний выход по ctx.isBypass).
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
      blockRows: ROWS.filter((r) => r.id !== 'b2'), // b2 отфильтрован шлюзом
      partition: { accessible: ['b1', 'b3'], denied: 1 },
    });
    const out = await loadCtx(service)('t-1', ALL_IDS, ctx, 'enforce', 'chat');
    expect(partitionSpy).toHaveBeenCalledWith(ctx, ALL_IDS);
    // findMany получил только accessible.
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
      blockRows: ROWS, // выдача неизменна
      partition: { accessible: ['b1', 'b3'], denied: 1 },
    });
    const out = await loadCtx(service)('t-1', ALL_IDS, ctx, 'shadow', 'chat');
    expect(partitionSpy).toHaveBeenCalledWith(ctx, ALL_IDS);
    // findMany получил ВСЕ blockIds — выдача байт-в-байт.
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
