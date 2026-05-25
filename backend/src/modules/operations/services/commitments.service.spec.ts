import { describe, expect, it, vi } from 'vitest';

import { CommitmentsService } from './commitments.service';

/**
 * SBA β-8.2 — CommitmentsService unit-тесты.
 *
 * Главный фокус — ИЗОЛЯЦИЯ: сотрудник A через `listMine` НЕ должен видеть
 * обещания сотрудника B. Реализовано через JOIN
 * `IdeaBlockEntity.entity.persons.some({ id: selfPersonId })`.
 *
 * Дополнительно:
 *   - resolveSelfPerson бросает 403 если нет Person'а.
 *   - markMine бросает 404 если блок не принадлежит сотруднику.
 *   - markMine добавляет статус и note в trustedAnswer.
 *   - listOpenForTenant возвращает только open + asked в окне.
 */
describe('CommitmentsService', () => {
  function build(overrides: {
    person?: { id: string } | null;
    findManyResults?: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentStatus: string | null;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId: string | null;
      commitmentAskedAt: Date | null;
      commitmentEscalatedAt: Date | null;
      createdAt: Date;
      commitmentRecipient: { id: string; name: string } | null;
    }>;
    findFirstResult?: unknown;
  }) {
    const prisma = {
      person: {
        findFirst: vi.fn().mockResolvedValue(overrides.person ?? null),
      },
      ideaBlock: {
        findMany: vi.fn().mockResolvedValue(overrides.findManyResults ?? []),
        findFirst: vi.fn().mockResolvedValue(overrides.findFirstResult ?? null),
        update: vi
          .fn()
          .mockResolvedValue(
            overrides.findFirstResult ?? {
              id: 'b1',
              tenantId: 't1',
              criticalQuestion: 'X',
              trustedAnswer: 'Y',
              commitmentStatus: 'fulfilled',
              commitmentDueDate: null,
              commitmentRecipientPersonId: null,
              commitmentAskedAt: null,
              commitmentEscalatedAt: null,
              createdAt: new Date(),
              commitmentRecipient: null,
            },
          ),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const svc = new CommitmentsService(prisma as never);
    return { svc, prisma };
  }

  it('resolveSelfPerson: 403 если нет Person-записи', async () => {
    const { svc } = build({ person: null });
    await expect(
      svc.resolveSelfPerson({ tenantId: 't1', userId: 'u1' }),
    ).rejects.toThrow();
  });

  it('listMine: where-фильтр ВКЛЮЧАЕТ self-personId через JOIN — изоляция между сотрудниками', async () => {
    const { svc, prisma } = build({ person: { id: 'p-self' } });
    await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'open', limit: 50 },
    });
    expect(prisma.ideaBlock.findMany).toHaveBeenCalledOnce();
    const call = prisma.ideaBlock.findMany.mock.calls[0]?.[0] as {
      where: {
        tenantId: string;
        signalType: string;
        commitmentStatus?: string;
        entities: {
          some: {
            entity: {
              persons: { some: { id: string } };
            };
          };
        };
      };
    };
    // КРИТИЧНО: фильтр должен ссылаться именно на selfPersonId.
    expect(call.where.entities.some.entity.persons.some.id).toBe('p-self');
    expect(call.where.tenantId).toBe('t1');
    expect(call.where.signalType).toBe('commitment');
    expect(call.where.commitmentStatus).toBe('open');
  });

  it('listMine status=asked → фильтр по asked', async () => {
    const { svc, prisma } = build({});
    await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'asked', limit: 50 },
    });
    const call = prisma.ideaBlock.findMany.mock.calls[0]?.[0] as {
      where: { commitmentStatus?: string };
    };
    expect(call.where.commitmentStatus).toBe('asked');
  });

  it('listMine status=all → без фильтра commitmentStatus', async () => {
    const { svc, prisma } = build({});
    await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'all', limit: 50 },
    });
    const call = prisma.ideaBlock.findMany.mock.calls[0]?.[0] as {
      where: { commitmentStatus?: string };
    };
    expect(call.where.commitmentStatus).toBeUndefined();
  });

  it('markMine: 404 если блок не принадлежит сотруднику', async () => {
    const { svc } = build({ findFirstResult: null });
    await expect(
      svc.markMine({
        tenantId: 't1',
        selfPersonId: 'p-self',
        blockId: 'b1',
        body: { status: 'fulfilled' },
      }),
    ).rejects.toThrow();
  });

  it('markMine: обновляет статус и добавляет note в trustedAnswer', async () => {
    const { svc, prisma } = build({
      findFirstResult: {
        id: 'b1',
        tenantId: 't1',
        criticalQuestion: 'Q',
        trustedAnswer: 'A',
        commitmentStatus: 'open',
        commitmentDueDate: null,
        commitmentRecipientPersonId: null,
        commitmentAskedAt: null,
        commitmentEscalatedAt: null,
        createdAt: new Date(),
        commitmentRecipient: null,
      },
    });
    await svc.markMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      blockId: 'b1',
      body: { status: 'fulfilled', note: 'OK' },
    });
    expect(prisma.ideaBlock.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: expect.objectContaining({
        commitmentStatus: 'fulfilled',
        trustedAnswer: expect.stringContaining('[fulfilled] OK'),
      }),
      select: expect.any(Object),
    });
  });

  it('listOpenForTenant: фильтр commitmentStatus in [open, asked] + createdAt >= since', async () => {
    const { svc, prisma } = build({});
    await svc.listOpenForTenant({ tenantId: 't1', days: 14, limit: 100 });
    const call = prisma.ideaBlock.findMany.mock.calls[0]?.[0] as {
      where: {
        commitmentStatus?: { in: string[] };
        createdAt?: { gte: Date };
      };
    };
    expect(call.where.commitmentStatus?.in).toEqual(['open', 'asked']);
    expect(call.where.createdAt?.gte).toBeInstanceOf(Date);
  });
});
