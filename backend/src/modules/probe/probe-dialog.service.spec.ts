import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';

import { ProbeDialogService } from './probe-dialog.service';

function makeService(): {
  service: ProbeDialogService;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
} {
  const row = {
    id: 'pds-1',
    probeEventId: 'p1',
    phase: 'awaiting_answer',
    turnCount: 0,
  };
  const upsert = vi.fn().mockResolvedValue(row);
  const update = vi.fn().mockResolvedValue(row);
  const findFirst = vi.fn().mockResolvedValue(null);
  const prisma = {
    probeDialogState: { upsert, update, findFirst },
  } as unknown as PrismaService;
  return { service: new ProbeDialogService(prisma), upsert, update, findFirst };
}

describe('ProbeDialogService', () => {
  it('ensureState — upsert по probeEventId, create.phase=awaiting_answer, tenantId/recipient проброшены, update={}', async () => {
    const { service, upsert } = makeService();

    await service.ensureState({
      tenantId: 'org-1',
      probeEventId: 'p1',
      recipientUserId: 'user-1',
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0]![0] as {
      where: { probeEventId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ probeEventId: 'p1' });
    expect(arg.create.phase).toBe('awaiting_answer');
    expect(arg.create.tenantId).toBe('org-1');
    expect(arg.create.probeEventId).toBe('p1');
    expect(arg.create.recipientUserId).toBe('user-1');
    expect(arg.update).toEqual({});
  });

  it('ensureState идемпотентен — два подряд вызова идут через upsert (не create), возвращают одну строку', async () => {
    const { service, upsert } = makeService();
    const prismaUntyped = (
      service as unknown as {
        prisma: { probeDialogState: Record<string, unknown> };
      }
    ).prisma;

    const first = await service.ensureState({
      tenantId: 'org-1',
      probeEventId: 'p1',
      recipientUserId: 'user-1',
    });
    const second = await service.ensureState({
      tenantId: 'org-1',
      probeEventId: 'p1',
      recipientUserId: 'user-1',
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(first).toEqual(second);
    expect(first.id).toBe('pds-1');
    expect(prismaUntyped.probeDialogState.create).toBeUndefined();
  });

  it('recordTurn — update с turnCount increment 1 и проброс outcome/collectedValue/confidence', async () => {
    const { service, update } = makeService();

    await service.recordTurn({
      probeEventId: 'p1',
      outcome: 'apply',
      collectedValue: 'Анна',
      confidence: 0.9,
    });

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]![0] as {
      where: { probeEventId: string };
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ probeEventId: 'p1' });
    expect(arg.data.turnCount).toEqual({ increment: 1 });
    expect(arg.data.outcome).toBe('apply');
    expect(arg.data.collectedValue).toBe('Анна');
    expect(arg.data.confidence).toBe(0.9);
  });

  it('getActive — findFirst с phase != resolved + tenantId + probeEventId', async () => {
    const { service, findFirst } = makeService();

    await service.getActive({ tenantId: 'org-1', probeEventId: 'p1' });

    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = findFirst.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where.tenantId).toBe('org-1');
    expect(arg.where.probeEventId).toBe('p1');
    expect(arg.where.phase).toEqual({ not: 'resolved' });
  });

  it('setPhase — update с data.phase', async () => {
    const { service, update } = makeService();

    await service.setPhase({ probeEventId: 'p1', phase: 'resolved' });

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]![0] as {
      where: { probeEventId: string };
      data: { phase: string };
    };
    expect(arg.where).toEqual({ probeEventId: 'p1' });
    expect(arg.data.phase).toBe('resolved');
  });
});
