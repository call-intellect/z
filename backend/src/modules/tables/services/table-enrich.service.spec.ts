import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { TableEnrichService } from './table-enrich.service';

describe('TableEnrichService', () => {
  const TENANT = 'org-1';
  const MEETING = 'mtg-1';

  const PROPS = [
    {
      id: 'p-name',
      name: 'Название',
      type: 'text',
      config: { readonly: true, source: 'entity', entityAttribute: 'canonicalName' },
    },
    { id: 'p-stage', name: 'Стадия', type: 'selectSingle', config: {} },
    { id: 'p-budget', name: 'Бюджет', type: 'currency', config: {} },
  ];

  const TABLE = {
    id: 't-1',
    tenantId: TENANT,
    deletedAt: null,
    archivedAt: null,
    entitySync: { type: 'org', autoCreate: true, entityTypes: ['customer'] },
    properties: PROPS,
  };

  function meeting() {
    return {
      id: MEETING,
      tenantId: TENANT,
      title: 'Звонок с Бета-Корп',
      ownerId: 'user-1',
      type: 'sales',
      transcript: {
        turns: [
          {
            speaker: 'Менеджер',
            text: 'По клиенту Бета-Корп бюджет проекта 500000 рублей.',
            startSec: 12,
            endSec: 18,
          },
        ],
      },
    };
  }

  const ENTITY = {
    id: 'ent-1',
    canonicalName: 'Бета-Корп',
    aliases: [] as string[],
  };

  type Fn = ReturnType<typeof vi.fn>;
  interface PrismaMock {
    meeting: { findUnique: Fn };
    table: { findMany: Fn };
    rawEvent: { findMany: Fn };
    ideaBlockEvidence: { findMany: Fn };
    ideaBlockEntity: { findMany: Fn };
    event: { findMany: Fn };
    entity: { findMany: Fn; findUnique: Fn };
    tableRow: { findMany: Fn; findUnique: Fn; update: Fn };
    tableCellProvenance: {
      findFirst: Fn;
      create: Fn;
      findUnique: Fn;
      update: Fn;
    };
    tableCellPendingPatch: {
      findFirst: Fn;
      create: Fn;
      findUnique: Fn;
      update: Fn;
    };
    proactiveNotification: { create: Fn };
  }
  let prisma: PrismaMock;
  let llm: { call: ReturnType<typeof vi.fn> };
  let cfg: { getDynamic: ReturnType<typeof vi.fn> };
  let svc: TableEnrichService;

  beforeEach(() => {
    prisma = {
      meeting: { findUnique: vi.fn() },
      table: { findMany: vi.fn() },
      rawEvent: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      event: { findMany: vi.fn().mockResolvedValue([]) },
      entity: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
      tableRow: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      tableCellProvenance: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'prov-1' }),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      tableCellPendingPatch: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'pp-1' }),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      proactiveNotification: { create: vi.fn().mockResolvedValue({ id: 'n-1' }) },
    };

    llm = { call: vi.fn() };
    cfg = { getDynamic: vi.fn().mockResolvedValue(0.85) };

    svc = new TableEnrichService(
      prisma as unknown as PrismaService,
      llm as unknown as LlmRouterService,
      cfg as unknown as TypedConfigService,
    );
  });

  function arrangeEnrich(rowCells: Record<string, unknown>): void {
    prisma.meeting.findUnique.mockResolvedValue(meeting());
    prisma.table.findMany.mockResolvedValue([TABLE]);
    prisma.entity.findMany.mockResolvedValueOnce([ENTITY]);
    prisma.tableRow.findMany.mockResolvedValue([{ id: 'r-1', cells: rowCells, entityId: 'ent-1' }]);
    prisma.entity.findUnique.mockResolvedValue({ canonicalName: 'Бета-Корп' });
  }

  function llmFacts(facts: unknown[]): void {
    llm.call.mockResolvedValue({ text: JSON.stringify({ facts }) });
  }

  it('(a) пустая ячейка + confidence ≥ threshold → патч + provenance с deep-link', async () => {
    arrangeEnrich({});
    llmFacts([
      {
        propertyId: 'p-budget',
        value: 500000,
        confidence: 0.92,
        quote: 'Бюджет 500000',
        timeSec: 12,
      },
    ]);

    const res = await svc.enrichFromEvent({ meetingId: MEETING, tenantId: TENANT });

    expect(res.applied).toBe(1);
    expect(res.pending).toBe(0);
    expect(prisma.tableRow.update).toHaveBeenCalledTimes(1);
    const upd = prisma.tableRow.update.mock.calls[0]![0].data.cells;
    expect(upd['p-budget']).toBe(500000);
    expect(prisma.tableCellProvenance.create).toHaveBeenCalledTimes(1);
    const prov = prisma.tableCellProvenance.create.mock.calls[0]![0].data;
    expect(prov.sourceType).toBe('meeting');
    expect(prov.sourceId).toBe(MEETING);
    expect(prov.sourceLink).toBe(`/meetings/${MEETING}?t=12`);
    expect(prov.appliedBy).toBe('agent');
    expect(prov.previousValue).toBe(Prisma.JsonNull);
    expect(prisma.tableCellPendingPatch.create).not.toHaveBeenCalled();
  });

  it("(b) непустая ячейка + высокий confidence → pending reason 'overwrite', ячейка не тронута", async () => {
    arrangeEnrich({ 'p-stage': 'opt-1' });
    llmFacts([
      {
        propertyId: 'p-stage',
        value: 'opt-2',
        confidence: 0.95,
        quote: 'перешли к контракту',
        timeSec: 30,
      },
    ]);

    const res = await svc.enrichFromEvent({ meetingId: MEETING, tenantId: TENANT });

    expect(res.applied).toBe(0);
    expect(res.pending).toBe(1);
    expect(prisma.tableRow.update).not.toHaveBeenCalled();
    expect(prisma.tableCellPendingPatch.create).toHaveBeenCalledTimes(1);
    const pp = prisma.tableCellPendingPatch.create.mock.calls[0]![0].data;
    expect(pp.reason).toBe('overwrite');
    expect(pp.proposedValue).toBe('opt-2');
    expect(pp.currentValue).toBe('opt-1');
    expect(pp.status).toBe('pending');
  });

  it("(c) confidence < threshold → pending reason 'low_confidence', ячейка не тронута", async () => {
    arrangeEnrich({});
    llmFacts([
      { propertyId: 'p-budget', value: 300000, confidence: 0.5, quote: 'примерно', timeSec: 5 },
    ]);

    const res = await svc.enrichFromEvent({ meetingId: MEETING, tenantId: TENANT });

    expect(res.applied).toBe(0);
    expect(res.pending).toBe(1);
    expect(prisma.tableRow.update).not.toHaveBeenCalled();
    const pp = prisma.tableCellPendingPatch.create.mock.calls[0]![0].data;
    expect(pp.reason).toBe('low_confidence');
    expect(pp.currentValue).toBe(Prisma.JsonNull);
  });

  it('(d) read-only entity-колонка не попадает в схему extract (агент игнорирует)', async () => {
    arrangeEnrich({});
    llmFacts([]);

    await svc.enrichFromEvent({ meetingId: MEETING, tenantId: TENANT });

    expect(llm.call).toHaveBeenCalledTimes(1);
    const userMsg = llm.call.mock.calls[0]![0].userMessage as string;
    expect(userMsg).not.toContain('id=p-name');
    expect(userMsg).toContain('id=p-stage');
    expect(userMsg).toContain('id=p-budget');
  });

  it('(e) кэш: provenance с тем же (row,property,meeting) → факт пропущен, патча нет', async () => {
    arrangeEnrich({});
    llmFacts([
      { propertyId: 'p-budget', value: 500000, confidence: 0.92, quote: 'x', timeSec: 12 },
    ]);
    prisma.tableCellProvenance.findFirst.mockResolvedValue({ id: 'prov-old' });

    const res = await svc.enrichFromEvent({ meetingId: MEETING, tenantId: TENANT });

    expect(res.applied).toBe(0);
    expect(res.skippedCached).toBe(1);
    expect(prisma.tableRow.update).not.toHaveBeenCalled();
    expect(prisma.tableCellProvenance.create).not.toHaveBeenCalled();
  });

  it('(f) decidePendingPatch approve → ячейка обновляется + provenance; reject → не меняется', async () => {
    prisma.tableCellPendingPatch.findUnique.mockResolvedValue({
      id: 'pp-1',
      tenantId: TENANT,
      tableId: 't-1',
      tableRowId: 'r-1',
      propertyId: 'p-stage',
      proposedValue: 'opt-2',
      confidence: new Prisma.Decimal(0.95),
      sourceType: 'meeting',
      sourceId: MEETING,
      sourceLabel: 'Встреча «Звонок с Бета-Корп», 00:30',
      sourceLink: `/meetings/${MEETING}?t=30`,
      status: 'pending',
    });
    prisma.tableRow.findUnique.mockResolvedValue({
      id: 'r-1',
      cells: { 'p-stage': 'opt-1' },
      tenantId: TENANT,
      deletedAt: null,
    });

    const ok = await svc.decidePendingPatch({
      tenantId: TENANT,
      patchId: 'pp-1',
      decision: 'approve',
      userId: 'user-2',
    });
    expect(ok.status).toBe('approved');
    expect(prisma.tableRow.update).toHaveBeenCalledTimes(1);
    expect(prisma.tableRow.update.mock.calls[0]![0].data.cells['p-stage']).toBe('opt-2');
    const prov = prisma.tableCellProvenance.create.mock.calls[0]![0].data;
    expect(prov.appliedBy).toBe('user-2');
    expect(prov.previousValue).toBe('opt-1');

    vi.clearAllMocks();
    prisma.tableCellPendingPatch.findUnique.mockResolvedValue({
      id: 'pp-2',
      tenantId: TENANT,
      status: 'pending',
    });
    const rej = await svc.decidePendingPatch({
      tenantId: TENANT,
      patchId: 'pp-2',
      decision: 'reject',
      userId: 'user-2',
    });
    expect(rej.status).toBe('rejected');
    expect(prisma.tableRow.update).not.toHaveBeenCalled();
    expect(prisma.tableCellProvenance.create).not.toHaveBeenCalled();
  });

  it('(g) undoCellEdit → previousValue восстановлен, rolledBackAt проставлен', async () => {
    prisma.tableCellProvenance.findUnique.mockResolvedValue({
      id: 'prov-1',
      tenantId: TENANT,
      tableRowId: 'r-1',
      propertyId: 'p-budget',
      previousValue: null,
      rolledBackAt: null,
    });
    prisma.tableRow.findUnique.mockResolvedValue({
      id: 'r-1',
      cells: { 'p-budget': 500000, 'p-stage': 'opt-1' },
      tenantId: TENANT,
      deletedAt: null,
    });

    const res = await svc.undoCellEdit({
      tenantId: TENANT,
      provenanceId: 'prov-1',
      userId: 'user-2',
    });

    expect(res.rolledBack).toBe(true);
    const updatedCells = prisma.tableRow.update.mock.calls[0]![0].data.cells;
    expect(updatedCells['p-budget']).toBeUndefined();
    expect(updatedCells['p-stage']).toBe('opt-1');
    expect(prisma.tableCellProvenance.update).toHaveBeenCalledTimes(1);
    expect(prisma.tableCellProvenance.update.mock.calls[0]![0].data.rolledBackAt).toBeInstanceOf(
      Date,
    );
  });
});
