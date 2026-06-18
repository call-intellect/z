import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { MyDailyValueController } from './my-daily-value.controller';

describe('MyDailyValueController', () => {
  const req = { user: { id: 'user-1' } } as unknown as Request;

  function build(opts: {
    enabled?: boolean;
    ideasItems?: unknown[];
    recognitions?: unknown[];
    persons?: unknown[];
  }) {
    const ideas = {
      listMine: vi.fn().mockResolvedValue({
        items: opts.ideasItems ?? [],
        total: (opts.ideasItems ?? []).length,
        page: 1,
        limit: 20,
      }),
    };
    const prisma = {
      recognition: {
        findMany: vi.fn().mockResolvedValue(opts.recognitions ?? []),
      },
      person: {
        findMany: vi.fn().mockResolvedValue(opts.persons ?? []),
      },
    };
    const cfg = {
      getDynamic: vi.fn().mockResolvedValue(opts.enabled ?? true),
    };
    const metrics = {
      incMyIdeasFateServed: vi.fn(),
      incMyRecognitionsServed: vi.fn(),
    };
    const ctrl = new MyDailyValueController(
      ideas as never,
      prisma as never,
      cfg as never,
      metrics as never,
    );
    return { ctrl, ideas, prisma, cfg, metrics };
  }

  it('self-scope ideas: listMine вызывается с role=author + userId из сессии', async () => {
    const { ctrl, ideas, metrics } = build({
      ideasItems: [{ id: 'idea-1' }],
    });

    const res = await ctrl.myIdeas('org1', req);

    expect(ideas.listMine).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org1',
        userId: 'user-1',
        query: expect.objectContaining({ role: 'author', page: 1, limit: 20 }),
      }),
    );
    expect(res).toEqual({ items: [{ id: 'idea-1' }] });
    expect(metrics.incMyIdeasFateServed).toHaveBeenCalledTimes(1);
  });

  it('self-scope recognitions: findMany фильтруется по toUserId=userId, имена резолвятся', async () => {
    const { ctrl, prisma, metrics } = build({
      recognitions: [
        {
          id: 'r1',
          type: 'helper',
          message: 'спасибо',
          fromUserId: 'giver-1',
          visibility: 'team',
          createdAt: new Date('2026-06-01T10:00:00.000Z'),
        },
        {
          id: 'r2',
          type: 'expert',
          message: null,
          fromUserId: null,
          visibility: 'private',
          createdAt: new Date('2026-05-30T08:00:00.000Z'),
        },
      ],
      persons: [{ userId: 'giver-1', name: 'Анна' }],
    });

    const res = await ctrl.myRecognitions('org1', req);

    expect(prisma.recognition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'org1', toUserId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    expect(res.items).toEqual([
      {
        id: 'r1',
        type: 'helper',
        message: 'спасибо',
        fromPersonName: 'Анна',
        visibility: 'team',
        createdAt: '2026-06-01T10:00:00.000Z',
      },
      {
        id: 'r2',
        type: 'expert',
        message: null,
        fromPersonName: null,
        visibility: 'private',
        createdAt: '2026-05-30T08:00:00.000Z',
      },
    ]);
    expect(metrics.incMyRecognitionsServed).toHaveBeenCalledTimes(1);
  });

  it('флаг OFF → /me/ideas пустой, listMine не вызывается', async () => {
    const { ctrl, ideas, metrics } = build({ enabled: false });

    const res = await ctrl.myIdeas('org1', req);

    expect(res).toEqual({ items: [] });
    expect(ideas.listMine).not.toHaveBeenCalled();
    expect(metrics.incMyIdeasFateServed).not.toHaveBeenCalled();
  });

  it('флаг OFF → /me/recognitions пустой, findMany не вызывается', async () => {
    const { ctrl, prisma, metrics } = build({ enabled: false });

    const res = await ctrl.myRecognitions('org1', req);

    expect(res).toEqual({ items: [] });
    expect(prisma.recognition.findMany).not.toHaveBeenCalled();
    expect(metrics.incMyRecognitionsServed).not.toHaveBeenCalled();
  });

  it('нет tenantId → ошибка, ничего не читаем', async () => {
    const { ctrl, ideas, prisma } = build({});

    await expect(ctrl.myIdeas(undefined, req)).rejects.toThrow();
    await expect(ctrl.myRecognitions(undefined, req)).rejects.toThrow();
    expect(ideas.listMine).not.toHaveBeenCalled();
    expect(prisma.recognition.findMany).not.toHaveBeenCalled();
  });
});
