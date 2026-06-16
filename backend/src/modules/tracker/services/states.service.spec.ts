import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ListStatesQuery } from '../dto/states/list-states-query.dto';

import { StatesService } from './states.service';

interface FakeIssueState {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  category: string;
  sequence: number;
  isDefault: boolean;
}

function makeService(rows: FakeIssueState[]): {
  svc: StatesService;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => rows);
  const prisma = {
    issueState: { findMany },
  } as unknown as PrismaService;
  return { svc: new StatesService(prisma), findMany };
}

const baseRow: FakeIssueState = {
  id: 's1',
  tenantId: 't1',
  projectId: 'p1',
  name: 'Бэклог',
  color: '#94A3B8',
  category: 'backlog',
  sequence: 0,
  isDefault: true,
};

const emptyQuery: ListStatesQuery = {};

describe('StatesService.findAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('без фильтров — передаёт только tenantId, маппит в StateResponseDto', async () => {
    const { svc, findMany } = makeService([baseRow]);
    const result = await svc.findAll('t1', emptyQuery);

    expect(findMany).toHaveBeenCalledTimes(1);
    const callArg = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(callArg.where).toEqual({ tenantId: 't1' });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 's1',
      tenantId: 't1',
      projectId: 'p1',
      name: 'Бэклог',
      category: 'backlog',
      isDefault: true,
    });
  });

  it('фильтр projectId — попадает в where', async () => {
    const { svc, findMany } = makeService([baseRow]);
    await svc.findAll('t1', { projectId: 'p1' });
    const callArg = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(callArg.where).toEqual({ tenantId: 't1', projectId: 'p1' });
  });

  it('фильтр category — попадает в where', async () => {
    const { svc, findMany } = makeService([baseRow]);
    await svc.findAll('t1', { category: 'started' });
    const callArg = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(callArg.where).toEqual({ tenantId: 't1', category: 'started' });
  });

  it('tenant isolation: вызов с другим tenantId фильтрует только по нему', async () => {
    const { svc, findMany } = makeService([]);
    await svc.findAll('t2', { projectId: 'p1' });
    const callArg = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(callArg.where).toMatchObject({ tenantId: 't2' });
    expect(callArg.where).not.toHaveProperty('OR');
  });
});
