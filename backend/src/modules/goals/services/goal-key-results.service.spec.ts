import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';

import { GoalKeyResultsService } from './goal-key-results.service';

type Fn = ReturnType<typeof vi.fn>;

function firstArg<T>(fn: Fn): T {
  const calls = fn.mock.calls as unknown as unknown[][];
  return calls[0]![0] as T;
}

interface PrismaStub {
  goal: { findUnique: Fn };
  goalKeyResult: { findUnique: Fn; create: Fn; update: Fn; delete: Fn };
  goalKeyResultCheckpoint: { create: Fn };
  $transaction: Fn;
}

function krRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'kr1',
    goalId: 'g1',
    tenantId: 't1',
    name: 'Встречи',
    unit: 'встреч',
    startValue: '0.0000',
    targetValue: '100.0000',
    currentValue: '0.0000',
    sourceKind: 'manual',
    source: 'manual',
    manualOverride: {},
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeService(prismaStub: PrismaStub): {
  svc: GoalKeyResultsService;
  audit: { log: Fn };
} {
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new GoalKeyResultsService(
    prismaStub as unknown as PrismaService,
    audit as unknown as AuditLogService,
  );
  return { svc, audit };
}

describe('GoalKeyResultsService.update — checkpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PATCH с currentValue создаёт checkpoint (recordedBy=manual) в транзакции', async () => {
    const checkpointCreate = vi.fn(async () => ({ id: 'cp1' }));
    const txKrUpdate = vi.fn(async () => krRow({ currentValue: '42.0000' }));
    const prisma: PrismaStub = {
      goal: { findUnique: vi.fn() },
      goalKeyResult: {
        findUnique: vi.fn(async () => ({
          id: 'kr1',
          tenantId: 't1',
          goalId: 'g1',
          manualOverride: {},
        })),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      goalKeyResultCheckpoint: { create: checkpointCreate },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          goalKeyResult: { update: txKrUpdate },
          goalKeyResultCheckpoint: { create: checkpointCreate },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    await svc.update({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      krId: 'kr1',
      body: { currentValue: 42 },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(checkpointCreate).toHaveBeenCalledTimes(1);
    const cpArg = firstArg<{ data: Record<string, unknown> }>(checkpointCreate);
    expect(cpArg.data.recordedBy).toBe('manual');
    expect(cpArg.data.keyResultId).toBe('kr1');
    expect(String(cpArg.data.value)).toBe('42');
  });

  it('PATCH без currentValue НЕ создаёт checkpoint и не открывает транзакцию', async () => {
    const directUpdate = vi.fn(async () => krRow({ name: 'Новое имя' }));
    const checkpointCreate = vi.fn();
    const txFn = vi.fn();
    const prisma: PrismaStub = {
      goal: { findUnique: vi.fn() },
      goalKeyResult: {
        findUnique: vi.fn(async () => ({
          id: 'kr1',
          tenantId: 't1',
          goalId: 'g1',
          manualOverride: {},
        })),
        create: vi.fn(),
        update: directUpdate,
        delete: vi.fn(),
      },
      goalKeyResultCheckpoint: { create: checkpointCreate },
      $transaction: txFn,
    };
    const { svc } = makeService(prisma);
    await svc.update({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      krId: 'kr1',
      body: { name: 'Новое имя' },
    });
    expect(txFn).not.toHaveBeenCalled();
    expect(checkpointCreate).not.toHaveBeenCalled();
    expect(directUpdate).toHaveBeenCalledTimes(1);
  });

  it('manualOverride: правленые поля мерджатся в kr.manualOverride', async () => {
    const directUpdate = vi.fn(async () => krRow());
    const prisma: PrismaStub = {
      goal: { findUnique: vi.fn() },
      goalKeyResult: {
        findUnique: vi.fn(async () => ({
          id: 'kr1',
          tenantId: 't1',
          goalId: 'g1',
          manualOverride: { unit: true },
        })),
        create: vi.fn(),
        update: directUpdate,
        delete: vi.fn(),
      },
      goalKeyResultCheckpoint: { create: vi.fn() },
      $transaction: vi.fn(),
    };
    const { svc } = makeService(prisma);
    await svc.update({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      krId: 'kr1',
      body: { name: 'X', targetValue: 200 },
    });
    const arg = firstArg<{ data: { manualOverride: Record<string, true> } }>(directUpdate);
    expect(arg.data.manualOverride).toEqual({ unit: true, name: true, targetValue: true });
  });
});

describe('GoalKeyResultsService.progressPercent', () => {
  it('clamp 0..100 и защита от деления на 0', () => {
    expect(GoalKeyResultsService.progressPercent(0, 100, 50)).toBe(50);
    expect(GoalKeyResultsService.progressPercent(0, 100, 150)).toBe(100);
    expect(GoalKeyResultsService.progressPercent(0, 100, -10)).toBe(0);
    expect(GoalKeyResultsService.progressPercent(50, 50, 70)).toBe(0);
  });
});
