import { describe, expect, it, vi } from 'vitest';

import { Specialist32Service } from './specialist-3-2-knowledge-clone.service';

function buildService(opts: {
  resolvedEntityId: string | null;
  findManyResult?: Array<{ blockId: string }>;
}) {
  const resolveSubjectEntityId = vi.fn(async () => opts.resolvedEntityId);
  const personUpdate = vi.fn(async () => ({ id: 'p1' }));
  const ideaBlockEntityFindMany = vi.fn(async () => opts.findManyResult ?? []);

  const entities = { resolveSubjectEntityId };
  const prisma = {
    person: { update: personUpdate },
    ideaBlockEntity: { findMany: ideaBlockEntityFindMany },
  };
  const metrics = { incKnowledgeClonePersonNoEntity: vi.fn() };
  const cfg = { knowledgeClone: { lookbackMonths: 6 } };
  const logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn() };

  const svc = Object.create(Specialist32Service.prototype) as Specialist32Service;
  Object.assign(svc, { prisma, entities, metrics, cfg, logger });

  return { svc, resolveSubjectEntityId, personUpdate, ideaBlockEntityFindMany, metrics };
}

describe('Specialist32Service.loadBlocksForPerson — Person без entityId', () => {
  it('резолв успешен → update с обоими полями FK + counter + продолжает', async () => {
    const { svc, resolveSubjectEntityId, personUpdate, metrics } = buildService({
      resolvedEntityId: 'ent-1',
      findManyResult: [],
    });

    const result = await (svc as any).loadBlocksForPerson({
      tenantId: 't1',
      personId: 'p1',
      entityId: null,
    });

    expect(result).toEqual([]);
    expect(metrics.incKnowledgeClonePersonNoEntity).toHaveBeenCalledWith({ tenant: 't1' });
    expect(resolveSubjectEntityId).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ authorPersonId: 'p1' }),
    );
    expect(personUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ entityId: 'ent-1', entityTenantId: 't1' }),
      }),
    );
  });

  it('резолв null → return [] + counter, без update', async () => {
    const { svc, personUpdate, ideaBlockEntityFindMany, metrics } = buildService({
      resolvedEntityId: null,
    });

    const result = await (svc as any).loadBlocksForPerson({
      tenantId: 't1',
      personId: 'p1',
      entityId: null,
    });

    expect(result).toEqual([]);
    expect(metrics.incKnowledgeClonePersonNoEntity).toHaveBeenCalledWith({ tenant: 't1' });
    expect(personUpdate).not.toHaveBeenCalled();
    expect(ideaBlockEntityFindMany).not.toHaveBeenCalled();
  });
});
