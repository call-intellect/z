import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CardSpecialistRegistry } from '../services/card-specialist-registry.service';

import { IssueCardHandler } from './issue-card-handler.service';

/**
 * Tracker Phase 3 part C — юнит-тест IssueCardHandler.
 *
 * Покрытие:
 *  - getCitations возвращает структуру с identifier/title/stateId/completedAt.
 *  - getCitations пустой blockIds → [] без запросов в БД.
 *  - formatForChat включает статус/приоритет/дедлайн в карточку.
 *  - onModuleInit регистрирует handler в registry.
 *  - getCardsForQuery с overlap-фильтром даёт correct confidence boost.
 */
describe('IssueCardHandler', () => {
  let prisma: PrismaService;
  let registry: CardSpecialistRegistry;
  let svc: IssueCardHandler;

  let issueFindMany: ReturnType<typeof vi.fn>;
  let register: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueFindMany = vi.fn();
    prisma = {
      issue: { findMany: issueFindMany },
    } as unknown as PrismaService;
    register = vi.fn();
    registry = { register } as unknown as CardSpecialistRegistry;
    svc = new IssueCardHandler(prisma, registry);
  });

  it('onModuleInit регистрирует handler как "issue"', () => {
    svc.onModuleInit();
    expect(register).toHaveBeenCalledWith('issue', svc);
  });

  it('getCitations возвращает структурированные Issue по blockIds', async () => {
    issueFindMany.mockResolvedValue([
      {
        id: 'iss1',
        identifier: 'K-1',
        title: 'Релиз',
        descriptionStripped: 'Сделать сборку',
        description: 'Сделать сборку',
        projectId: 'p1',
        stateId: 'st1',
        completedAt: new Date('2026-05-20T10:00:00Z'),
        priority: 'high',
        dueDate: new Date('2026-06-01T00:00:00Z'),
      },
    ]);
    const result = await svc.getCitations({
      tenantId: 't1',
      blockIds: ['b1', 'b2'],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'iss1',
      identifier: 'K-1',
      title: 'Релиз',
      description: 'Сделать сборку',
      projectId: 'p1',
      stateId: 'st1',
      completedAt: '2026-05-20T10:00:00.000Z',
      priority: 'high',
      dueDate: '2026-06-01T00:00:00.000Z',
    });
  });

  it('getCitations с пустым blockIds → []', async () => {
    const result = await svc.getCitations({
      tenantId: 't1',
      blockIds: [],
    });
    expect(result).toEqual([]);
    expect(issueFindMany).not.toHaveBeenCalled();
  });

  it('formatForChat собирает строку с метаданными', () => {
    const out = svc.formatForChat({
      identifier: 'K-1',
      title: 'Релиз',
      stateName: 'В работе',
      priority: 'high',
      dueDate: '2026-06-01T00:00:00.000Z',
    });
    expect(out).toContain('K-1');
    expect(out).toContain('Релиз');
    expect(out).toContain('В работе');
    expect(out).toContain('high');
    expect(out).toContain('2026-06-01');
  });

  it('formatForChat без приоритета "none" не показывает приоритет', () => {
    const out = svc.formatForChat({
      identifier: 'K-2',
      title: 'X',
      priority: 'none',
    });
    expect(out).not.toContain('приоритет');
  });

  it('getCardsForQuery возвращает sorted по overlap', async () => {
    issueFindMany.mockResolvedValue([
      {
        id: 'iss-low',
        identifier: 'K-LOW',
        title: 'Low overlap',
        descriptionStripped: 'one block',
        description: null,
        sourceBlockIds: ['b1'],
        confidence: null,
        stateId: 'st1',
        completedAt: null,
        projectId: 'p1',
        dueDate: null,
        priority: 'low',
      },
      {
        id: 'iss-high',
        identifier: 'K-HIGH',
        title: 'High overlap',
        descriptionStripped: 'two blocks',
        description: null,
        sourceBlockIds: ['b1', 'b2'],
        confidence: null,
        stateId: 'st1',
        completedAt: null,
        projectId: 'p1',
        dueDate: null,
        priority: 'high',
      },
    ]);
    const out = await svc.getCardsForQuery({
      tenantId: 't1',
      query: 'X',
      candidateBlockIds: ['b1', 'b2'],
      limit: 5,
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.id).toBe('iss-high');
    expect(out[1]?.id).toBe('iss-low');
  });

  it('getCardsForQuery: пустой candidateBlockIds → []', async () => {
    const out = await svc.getCardsForQuery({
      tenantId: 't1',
      query: 'X',
      candidateBlockIds: [],
      limit: 5,
    });
    expect(out).toEqual([]);
  });
});
