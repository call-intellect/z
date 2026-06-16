import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { ConflictPendingProvider } from './conflict.provider';
import { IntakePendingProvider } from './intake.provider';

function makeCfg(
  overrides: Partial<{ urgentAgeDays: number; reminderLeadDays: number }> = {},
): TypedConfigService {
  return {
    pendingActions: {
      reminderWindowStartHour: 9,
      reminderWindowEndHour: 21,
      reminderStepHours: 3,
      urgentAgeDays: 5,
      reminderLeadDays: 3,
      ...overrides,
    },
  } as unknown as TypedConfigService;
}

describe('ConflictPendingProvider (B0)', () => {
  let prisma: PrismaService;
  let provider: ConflictPendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn();
    findManyMock = vi.fn();
    prisma = {
      conflictItem: { count: countMock, findMany: findManyMock },
    } as unknown as PrismaService;
    provider = new ConflictPendingProvider(prisma, makeCfg());
  });

  it('member: count=0 без обращения к БД', async () => {
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(0);
    expect(countMock).not.toHaveBeenCalled();
  });

  it('member: list=[] без обращения к БД', async () => {
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('admin: count обращается к open-конфликтам', async () => {
    countMock.mockResolvedValue(3);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(3);
    expect(countMock.mock.calls[0]![0].where.status).toBe('open');
  });

  it('snoozed исключается через id.notIn', async () => {
    countMock.mockResolvedValue(0);
    await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      snoozedResourceIds: new Set(['cf-1']),
    });
    expect(countMock.mock.calls[0]![0].where.id).toEqual({ notIn: ['cf-1'] });
  });

  it('list: severity urgent по ageDays >= urgentAgeDays (дефолт 5); canQuickConfirm=false', async () => {
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    findManyMock.mockResolvedValue([{ id: 'cf-9', resourceType: 'decision', createdAt: old }]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.severity).toBe('urgent');
    expect(items[0]!.canQuickConfirm).toBe(false);
    expect(items[0]!.actionUrl).toBe('/curation/conflicts/cf-9');
  });

  it('крутилка urgentAgeDays=10: конфликт возрастом 7 дней → normal (при дефолте 5 был бы urgent)', async () => {
    const sevenDaysOld = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const row = { id: 'cf-age7', resourceType: 'decision', createdAt: sevenDaysOld };
    findManyMock.mockResolvedValue([row]);
    const args = {
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin' as const,
      limit: 50,
      snoozedResourceIds: new Set<string>(),
    };

    const raised = new ConflictPendingProvider(prisma, makeCfg({ urgentAgeDays: 10 }));
    const raisedItems = await raised.listForUser(args);
    expect(raisedItems[0]!.ageDays).toBeGreaterThanOrEqual(7);
    expect(raisedItems[0]!.severity).toBe('normal');

    const defaultProvider = new ConflictPendingProvider(prisma, makeCfg());
    const defaultItems = await defaultProvider.listForUser(args);
    expect(defaultItems[0]!.severity).toBe('urgent');
  });

  it('Ф4: title = суть из evidence; detail.kind=conflict с обеими версиями', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'cf-d1',
        resourceType: 'decision',
        createdAt: new Date(),
        evidence: {
          oldStatement: 'Перешли на спринты по 2 недели',
          newStatement: 'Перешли на спринты по 1 неделе',
          supersedeReason: 'Команда выросла',
          explanation: 'Старое решение противоречит новому по длине спринта',
        },
        evolvingMeta: {
          existingValidUntil: '2026-06-01T00:00:00.000Z',
          newValidFrom: '2026-06-02T00:00:00.000Z',
        },
      },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.title).toBe('Старое решение противоречит новому по длине спринта');
    expect(items[0]!.detail).toEqual({
      kind: 'conflict',
      summary: 'Старое решение противоречит новому по длине спринта',
      oldVersion: {
        text: 'Перешли на спринты по 2 недели',
        date: '2026-06-01T00:00:00.000Z',
      },
      newVersion: {
        text: 'Перешли на спринты по 1 неделе',
        date: '2026-06-02T00:00:00.000Z',
      },
    });
  });

  it('Ф4: evidence без полей сути → fallback-title по типу ресурса', async () => {
    findManyMock.mockResolvedValue([
      { id: 'cf-d2', resourceType: 'decision', createdAt: new Date(), evidence: {} },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-admin',
      role: 'admin',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.title).toContain('Конфликт карточек');
    expect(items[0]!.detail?.kind).toBe('conflict');
  });
});

describe('IntakePendingProvider (B0)', () => {
  let prisma: PrismaService;
  let provider: IntakePendingProvider;
  let countMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;

  let personFindManyMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    countMock = vi.fn();
    findManyMock = vi.fn();
    personFindManyMock = vi.fn().mockResolvedValue([]);
    prisma = {
      intakeIssue: { count: countMock, findMany: findManyMock },
      person: { findMany: personFindManyMock },
    } as unknown as PrismaService;
    provider = new IntakePendingProvider(prisma, makeCfg());
  });

  it('member: count=0, list=[] без обращения к БД', async () => {
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      snoozedResourceIds: new Set(),
    });
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-1',
      role: 'member',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(0);
    expect(items).toEqual([]);
    expect(countMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('owner: count по status=pending', async () => {
    countMock.mockResolvedValue(4);
    const n = await provider.countForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      snoozedResourceIds: new Set(),
    });
    expect(n).toBe(4);
    expect(countMock.mock.calls[0]![0].where.status).toBe('pending');
  });

  it('list: title из extractedTitle, actionUrl /intake', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'ii-1',
        extractedTitle: 'Починить биллинг',
        extractedDescription: null,
        rawContent: 'сырой текст',
        suggestedAssigneeId: null,
        suggestedDueDate: null,
        confidence: null,
        createdAt: new Date(),
      },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.title).toContain('Починить биллинг');
    expect(items[0]!.actionUrl).toBe('/intake');
    expect(items[0]!.resourceType).toBe('intake_issue');
    expect(personFindManyMock).not.toHaveBeenCalled();
  });

  it('Ф4: title = extractedTitle; detail с assigneeName/dueLabel/confidence/description', async () => {
    const due = new Date('2026-06-20T00:00:00.000Z');
    findManyMock.mockResolvedValue([
      {
        id: 'ii-2',
        extractedTitle: 'Подготовить договор',
        extractedDescription: 'Клиент просил черновик к пятнице',
        rawContent: 'сырой текст про договор',
        suggestedAssigneeId: 'u-nastya',
        suggestedDueDate: due,
        confidence: { toString: () => '0.82' },
        createdAt: new Date(),
      },
    ]);
    personFindManyMock.mockResolvedValue([{ userId: 'u-nastya', name: 'Настя Иванова' }]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.title).toBe('Подготовить договор');
    expect(items[0]!.detail).toEqual({
      kind: 'intake',
      title: 'Подготовить договор',
      description: 'Клиент просил черновик к пятнице',
      assigneeName: 'Настя Иванова',
      dueLabel: '2026-06-20T00:00:00.000Z',
      confidence: 0.82,
    });
    expect(personFindManyMock).toHaveBeenCalledTimes(1);
  });

  it('Ф4: без extractedTitle → title из rawContent.slice(0,80)', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'ii-3',
        extractedTitle: null,
        extractedDescription: null,
        rawContent: 'Длинный сырой текст обращения без явного заголовка',
        suggestedAssigneeId: null,
        suggestedDueDate: null,
        confidence: null,
        createdAt: new Date(),
      },
    ]);
    const items = await provider.listForUser({
      tenantId: 't-1',
      userId: 'u-owner',
      role: 'owner',
      limit: 50,
      snoozedResourceIds: new Set(),
    });
    expect(items[0]!.title).toBe('Длинный сырой текст обращения без явного заголовка');
    expect(items[0]!.detail?.kind).toBe('intake');
  });
});
