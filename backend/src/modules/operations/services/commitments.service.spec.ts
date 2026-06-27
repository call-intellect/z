import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CommitmentsService } from './commitments.service';

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
      commitmentAuthorPersonId?: string | null;
      commitmentAskedAt: Date | null;
      commitmentEscalatedAt: Date | null;
      createdAt: Date;
      commitmentRecipient: { id: string; name: string } | null;
      evidence?: Array<{ rawEvent: { sourceExternalId: string | null } }>;
    }>;
    findFirstResult?: unknown;
    meetingResults?: Array<{ id: string; title: string }>;
    updateResult?: unknown;
  }) {
    const prisma = {
      person: {
        findFirst: vi.fn().mockResolvedValue(overrides.person ?? null),
      },
      ideaBlock: {
        findMany: vi.fn().mockResolvedValue(overrides.findManyResults ?? []),
        findFirst: vi.fn().mockResolvedValue(overrides.findFirstResult ?? null),
        update: vi.fn().mockResolvedValue(
          overrides.updateResult ??
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
              evidence: [],
            },
        ),
        count: vi.fn().mockResolvedValue(0),
      },
      meeting: {
        findMany: vi.fn().mockResolvedValue(overrides.meetingResults ?? []),
      },
    };
    const svc = new CommitmentsService(prisma as never);
    return { svc, prisma };
  }

  function makeBlock(over: Record<string, unknown> = {}) {
    return {
      id: 'b1',
      tenantId: 't1',
      criticalQuestion: 'Прислать отчёт',
      trustedAnswer: 'Да, до пятницы',
      commitmentStatus: 'open',
      commitmentDueDate: new Date('2026-06-01T00:00:00Z'),
      commitmentRecipientPersonId: null,
      commitmentAuthorPersonId: 'p-author',
      commitmentAskedAt: null,
      commitmentEscalatedAt: null,
      createdAt: new Date('2026-05-20T00:00:00Z'),
      commitmentRecipient: null,
      evidence: [] as Array<{ rawEvent: { sourceExternalId: string | null } }>,
      ...over,
    };
  }

  it('resolveSelfPerson: 403 если нет Person-записи', async () => {
    const { svc } = build({ person: null });
    await expect(svc.resolveSelfPerson({ tenantId: 't1', userId: 'u1' })).rejects.toThrow();
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
      where: { id_tenantId: { id: 'b1', tenantId: 't1' } },
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

  it('rescheduleMine: open → срок обновлён, статус остаётся open + заметка', async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const { svc, prisma } = build({
      findFirstResult: makeBlock(),
      updateResult: makeBlock({
        commitmentDueDate: future,
        commitmentStatus: 'open',
      }),
    });

    const dto = await svc.rescheduleMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      blockId: 'b1',
      body: { dueDate: future.toISOString() },
    });

    expect(prisma.ideaBlock.update).toHaveBeenCalledOnce();
    const updateArg = prisma.ideaBlock.update.mock.calls[0]?.[0] as {
      data: { commitmentStatus: string; commitmentDueDate: Date; trustedAnswer: string };
    };
    expect(updateArg.data.commitmentStatus).toBe('open');
    expect(updateArg.data.commitmentDueDate).toBeInstanceOf(Date);
    expect(updateArg.data.commitmentDueDate.getTime()).toBe(future.getTime());
    expect(updateArg.data.trustedAnswer).toContain('[reschedule → ');
    expect(dto.status).toBe('open');
  });

  it('rescheduleMine: note дописывается в trustedAnswer', async () => {
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const { svc, prisma } = build({ findFirstResult: makeBlock() });
    prisma.ideaBlock.update.mockImplementationOnce(async (arg: { data: Record<string, unknown> }) =>
      makeBlock(arg.data),
    );

    await svc.rescheduleMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      blockId: 'b1',
      body: { dueDate: future.toISOString(), note: 'жду данные от смежников' },
    });

    const updateArg = prisma.ideaBlock.update.mock.calls[0]?.[0] as {
      data: { trustedAnswer: string };
    };
    expect(updateArg.data.trustedAnswer).toContain('жду данные от смежников');
  });

  it('rescheduleMine: дата в прошлом → due_date_in_past (400), update не вызван', async () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000);
    const { svc, prisma } = build({ findFirstResult: makeBlock() });

    await expect(
      svc.rescheduleMine({
        tenantId: 't1',
        selfPersonId: 'p-self',
        blockId: 'b1',
        body: { dueDate: past.toISOString() },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ideaBlock.update).not.toHaveBeenCalled();
  });

  it('rescheduleMine: терминальный статус (fulfilled) → commitment_terminal (400)', async () => {
    const future = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const { svc, prisma } = build({
      findFirstResult: makeBlock({ commitmentStatus: 'fulfilled' }),
    });

    await expect(
      svc.rescheduleMine({
        tenantId: 't1',
        selfPersonId: 'p-self',
        blockId: 'b1',
        body: { dueDate: future.toISOString() },
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'commitment_terminal' } },
    });
    expect(prisma.ideaBlock.update).not.toHaveBeenCalled();
  });

  it('rescheduleMine: статус asked можно перенести (не терминальный)', async () => {
    const future = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const { svc, prisma } = build({
      findFirstResult: makeBlock({ commitmentStatus: 'asked' }),
      updateResult: makeBlock({ commitmentStatus: 'open' }),
    });

    await expect(
      svc.rescheduleMine({
        tenantId: 't1',
        selfPersonId: 'p-self',
        blockId: 'b1',
        body: { dueDate: future.toISOString() },
      }),
    ).resolves.toBeDefined();
    expect(prisma.ideaBlock.update).toHaveBeenCalledOnce();
  });

  it('rescheduleMine: блок не найден → commitment_not_found (404)', async () => {
    const future = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    const { svc, prisma } = build({ findFirstResult: null });

    await expect(
      svc.rescheduleMine({
        tenantId: 't1',
        selfPersonId: 'p-self',
        blockId: 'missing',
        body: { dueDate: future.toISOString() },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ideaBlock.update).not.toHaveBeenCalled();
  });

  it('listMine: derive источника — evidence из встречи → sourceMeetingId/Title (1 батч)', async () => {
    const { svc, prisma } = build({
      findManyResults: [makeBlock({ evidence: [{ rawEvent: { sourceExternalId: 'mtg-42' } }] })],
      meetingResults: [{ id: 'mtg-42', title: 'Планёрка' }],
    });

    const res = await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'open', limit: 50 },
    });

    expect(prisma.meeting.findMany).toHaveBeenCalledOnce();
    expect(prisma.meeting.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: ['mtg-42'] }, tenantId: 't1' },
    });
    expect(res.items[0]!.sourceMeetingId).toBe('mtg-42');
    expect(res.items[0]!.sourceMeetingTitle).toBe('Планёрка');
  });

  it('listMine: без evidence → sourceMeetingId/Title = null, встречи не запрашиваются', async () => {
    const { svc, prisma } = build({
      findManyResults: [makeBlock({ evidence: [] })],
    });

    const res = await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'open', limit: 50 },
    });

    expect(prisma.meeting.findMany).not.toHaveBeenCalled();
    expect(res.items[0]!.sourceMeetingId).toBeNull();
    expect(res.items[0]!.sourceMeetingTitle).toBeNull();
  });

  it('listMine: meetingId есть, но встреча чужого tenant (не найдена) → title null', async () => {
    const { svc } = build({
      findManyResults: [makeBlock({ evidence: [{ rawEvent: { sourceExternalId: 'mtg-x' } }] })],
      meetingResults: [],
    });

    const res = await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'open', limit: 50 },
    });

    expect(res.items[0]!.sourceMeetingId).toBe('mtg-x');
    expect(res.items[0]!.sourceMeetingTitle).toBeNull();
  });

  it('listMine split: полное обещание → items, неполное → openQuestions', async () => {
    const { svc } = build({
      findManyResults: [
        makeBlock({
          id: 'full-1',
          commitmentAuthorPersonId: 'a1',
          commitmentRecipientPersonId: null,
          commitmentDueDate: new Date('2026-06-10T00:00:00Z'),
        }),
        makeBlock({
          id: 'full-2',
          commitmentAuthorPersonId: 'a1',
          commitmentRecipientPersonId: 'r1',
          commitmentDueDate: null,
        }),
        makeBlock({
          id: 'inc-1',
          commitmentAuthorPersonId: 'a1',
          commitmentRecipientPersonId: null,
          commitmentDueDate: null,
        }),
        makeBlock({
          id: 'inc-2',
          commitmentAuthorPersonId: null,
          commitmentRecipientPersonId: 'r1',
          commitmentDueDate: new Date('2026-06-10T00:00:00Z'),
        }),
      ],
    });

    const res = await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'all', limit: 50 },
    });

    expect(res.items.map((i) => i.id).sort()).toEqual(['full-1', 'full-2']);
    expect(res.openQuestions.map((q) => q.id).sort()).toEqual(['inc-1', 'inc-2']);
  });

  it('listMine split: openQuestions содержат reason (RU) — нет ответственного/срока vs нет автора', async () => {
    const { svc } = build({
      findManyResults: [
        makeBlock({
          id: 'inc-noauthor',
          commitmentAuthorPersonId: null,
          commitmentRecipientPersonId: 'r1',
          commitmentDueDate: new Date('2026-06-10T00:00:00Z'),
        }),
        makeBlock({
          id: 'inc-nodue',
          commitmentAuthorPersonId: 'a1',
          commitmentRecipientPersonId: null,
          commitmentDueDate: null,
        }),
      ],
    });

    const res = await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'all', limit: 50 },
    });

    const byId = new Map(res.openQuestions.map((q) => [q.id, q]));
    expect(byId.get('inc-noauthor')!.reason).toBe('не определён автор обещания');
    expect(byId.get('inc-nodue')!.reason).toBe('не назначен ответственный и нет срока');
    expect(byId.get('inc-noauthor')!.text).toBe('Прислать отчёт');
  });

  it('listMine split: неполное обещание адресату НЕ показывается как его обещание (items пуст)', async () => {
    const { svc } = build({
      findManyResults: [
        makeBlock({
          id: 'inc-recipient-view',
          commitmentAuthorPersonId: null,
          commitmentRecipientPersonId: 'p-self',
          commitmentDueDate: null,
        }),
      ],
    });

    const res = await svc.listMine({
      tenantId: 't1',
      selfPersonId: 'p-self',
      query: { status: 'all', limit: 50 },
    });

    expect(res.items).toHaveLength(0);
    expect(res.openQuestions).toHaveLength(1);
    expect(res.openQuestions[0]!.reason).toBe('не определён автор обещания');
  });
});
