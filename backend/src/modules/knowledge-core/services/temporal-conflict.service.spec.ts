import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemporalConflictService } from './temporal-conflict.service';

/**
 * Agents v2 Фаза A1 (2026-05-30) — unit-тесты TemporalConflictService.
 * См. plans/tz/2026-05-29-agents-v2-umbrella.md §A1.
 *
 * Покрываем 3 сценария:
 *   1. Insert link без conflict (нет existing open того же source+target+
 *      противоречащего relationType) → ничего не invalidate.
 *   2. Insert link с conflict (existing open develops vs новый contradicts) →
 *      existing закрывается validUntil=NOW, метрика дёрнута.
 *   3. Insert link с conflict, но existing уже closed (validUntil не null) →
 *      не трогаем.
 */
describe('TemporalConflictService', () => {
  let prismaStub: {
    ideaBlockLink: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    entityLink: {
      findMany: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let metricsStub: {
    incTemporalEdgesInvalidated: ReturnType<typeof vi.fn>;
  };
  let svc: TemporalConflictService;

  beforeEach(() => {
    prismaStub = {
      ideaBlockLink: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      entityLink: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    metricsStub = {
      incTemporalEdgesInvalidated: vi.fn(),
    };
    svc = new TemporalConflictService(
      prismaStub as unknown as never,
      metricsStub as unknown as never,
    );
  });

  it('сценарий 1: новый contradicts-link без existing develops → 0 invalidated', async () => {
    prismaStub.ideaBlockLink.findMany.mockResolvedValueOnce([]);
    // ensureValidFrom — обновим если null.
    prismaStub.ideaBlockLink.updateMany.mockResolvedValue({ count: 0 });

    const result = await svc.onNewBlockLink({
      id: 'new-link',
      tenantId: 't',
      fromBlockId: 'a',
      toBlockId: 'b',
      relationType: 'contradicts',
      status: 'active',
      validFrom: new Date(),
      validUntil: null,
    } as never);

    expect(result.invalidated).toBe(0);
    expect(metricsStub.incTemporalEdgesInvalidated).not.toHaveBeenCalled();
    // findMany был вызван с фильтром по противоречащим типам.
    expect(prismaStub.ideaBlockLink.findMany).toHaveBeenCalledTimes(1);
    const findCall = prismaStub.ideaBlockLink.findMany.mock.calls[0]?.[0];
    expect(findCall.where.relationType).toEqual({ in: ['develops'] });
    expect(findCall.where.validUntil).toBeNull();
    expect(findCall.where.status).toBe('active');
  });

  it('сценарий 2: новый contradicts с existing open develops → existing закрывается, метрика +1', async () => {
    prismaStub.ideaBlockLink.findMany.mockResolvedValueOnce([
      { id: 'old-1', relationType: 'develops' },
    ]);
    // updateMany закрыл 1 запись.
    prismaStub.ideaBlockLink.updateMany
      .mockResolvedValueOnce({ count: 1 }) // закрытие old
      .mockResolvedValueOnce({ count: 0 }); // ensureValidFrom — уже задан

    const result = await svc.onNewBlockLink({
      id: 'new-link',
      tenantId: 't',
      fromBlockId: 'a',
      toBlockId: 'b',
      relationType: 'contradicts',
      status: 'active',
      validFrom: new Date('2026-05-30'),
      validUntil: null,
    } as never);

    expect(result.invalidated).toBe(1);
    expect(metricsStub.incTemporalEdgesInvalidated).toHaveBeenCalledTimes(1);
    expect(metricsStub.incTemporalEdgesInvalidated).toHaveBeenCalledWith({
      relationType: 'develops',
    });
    // Первый updateMany — закрытие old-1.
    const closeCall = prismaStub.ideaBlockLink.updateMany.mock.calls[0]?.[0];
    expect(closeCall.where).toMatchObject({
      id: 'old-1',
      validUntil: null,
    });
    expect(closeCall.data.validUntil).toBeInstanceOf(Date);
  });

  it('сценарий 3: existing уже closed (validUntil не null) → не трогаем', async () => {
    // findMany возвращает [] потому что мы фильтруем по validUntil=null —
    // closed-записи туда не попадают. Это и есть гарантия идемпотентности.
    prismaStub.ideaBlockLink.findMany.mockResolvedValueOnce([]);
    prismaStub.ideaBlockLink.updateMany.mockResolvedValue({ count: 0 });

    const result = await svc.onNewBlockLink({
      id: 'new-link',
      tenantId: 't',
      fromBlockId: 'a',
      toBlockId: 'b',
      relationType: 'contradicts',
      status: 'active',
      validFrom: new Date(),
      validUntil: null,
    } as never);

    expect(result.invalidated).toBe(0);
    expect(metricsStub.incTemporalEdgesInvalidated).not.toHaveBeenCalled();
  });

  it('non-contradicting relationType (causes) → 0 invalidated, findMany не вызывается', async () => {
    const result = await svc.onNewBlockLink({
      id: 'new-link',
      tenantId: 't',
      fromBlockId: 'a',
      toBlockId: 'b',
      relationType: 'causes',
      status: 'active',
      validFrom: new Date(),
      validUntil: null,
    } as never);

    expect(result.invalidated).toBe(0);
    expect(prismaStub.ideaBlockLink.findMany).not.toHaveBeenCalled();
  });

  it('entity-link: works_at vs opposes — закрывает противоречащий', async () => {
    prismaStub.entityLink.findMany.mockResolvedValueOnce([
      { id: 'el-old', relationType: 'works_at' },
    ]);
    prismaStub.entityLink.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await svc.onNewEntityLink({
      id: 'el-new',
      tenantId: 't',
      fromEntityId: 'p1',
      toEntityId: 'c1',
      fromType: 'entity',
      toType: 'entity',
      relationType: 'opposes',
      status: 'active',
      validFrom: new Date(),
      validUntil: null,
    } as never);

    expect(result.invalidated).toBe(1);
    expect(metricsStub.incTemporalEdgesInvalidated).toHaveBeenCalledWith({
      relationType: 'works_at',
    });
  });

  // ─────────────── Б53 — поиск конфликта в ОБЕ стороны ───────────────

  it('Б53 block: where ищет обе ориентации (from,to) и (to,from); зеркальный old закрыт', async () => {
    prismaStub.ideaBlockLink.findMany.mockResolvedValueOnce([
      { id: 'mirror-old', relationType: 'contradicts' },
    ]);
    prismaStub.ideaBlockLink.updateMany
      .mockResolvedValueOnce({ count: 1 }) // закрытие зеркального old
      .mockResolvedValueOnce({ count: 0 }); // ensureValidFrom

    const result = await svc.onNewBlockLink({
      id: 'new-link',
      tenantId: 't',
      // Новая связь A→B; зеркальный old был B→A — должен найтись и закрыться.
      fromBlockId: 'A',
      toBlockId: 'B',
      relationType: 'develops',
      status: 'active',
      validFrom: new Date(),
      validUntil: null,
    } as never);

    expect(result.invalidated).toBe(1);
    const where = prismaStub.ideaBlockLink.findMany.mock.calls[0]?.[0].where;
    expect(where.OR).toEqual([
      { fromBlockId: 'A', toBlockId: 'B' },
      { fromBlockId: 'B', toBlockId: 'A' },
    ]);
    // Плоских направленных полей в where быть не должно (заменены на OR).
    expect(where.fromBlockId).toBeUndefined();
    expect(where.toBlockId).toBeUndefined();
    expect(prismaStub.ideaBlockLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mirror-old', validUntil: null } }),
    );
  });

  it('Б53 entity: where ищет обе ориентации с перестановкой fromType/toType', async () => {
    prismaStub.entityLink.findMany.mockResolvedValueOnce([
      { id: 'mirror-el', relationType: 'opposes' },
    ]);
    prismaStub.entityLink.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const result = await svc.onNewEntityLink({
      id: 'el-new',
      tenantId: 't',
      fromEntityId: 'P',
      toEntityId: 'C',
      fromType: 'person',
      toType: 'company',
      relationType: 'works_at',
      status: 'active',
      validFrom: new Date(),
      validUntil: null,
    } as never);

    expect(result.invalidated).toBe(1);
    const where = prismaStub.entityLink.findMany.mock.calls[0]?.[0].where;
    expect(where.OR).toEqual([
      { fromEntityId: 'P', toEntityId: 'C', fromType: 'person', toType: 'company' },
      { fromEntityId: 'C', toEntityId: 'P', fromType: 'company', toType: 'person' },
    ]);
    expect(where.fromEntityId).toBeUndefined();
    expect(where.toEntityId).toBeUndefined();
  });
});
