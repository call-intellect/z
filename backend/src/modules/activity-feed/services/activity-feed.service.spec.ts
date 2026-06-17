import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ActivityFeedGateway } from '../gateways/activity-feed.gateway';

import { ActivityFeedService } from './activity-feed.service';

describe('ActivityFeedService', () => {
  let prisma: PrismaService;
  let metrics: BusinessMetricsService;
  let gateway: ActivityFeedGateway;
  let svc: ActivityFeedService;

  let createMock: ReturnType<typeof vi.fn>;
  let findFirstMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;
  let findManyMock: ReturnType<typeof vi.fn>;
  let updateManyMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;

  let emitMock: ReturnType<typeof vi.fn>;
  let incEmittedMock: ReturnType<typeof vi.fn>;
  let incActionedMock: ReturnType<typeof vi.fn>;
  let incReactionMock: ReturnType<typeof vi.fn>;
  let incExpiredMock: ReturnType<typeof vi.fn>;

  function makeItem(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'i-1',
      tenantId: 't-1',
      feedType: 'probe_question',
      sourceType: 'ai_agent',
      sourceAgentName: 'probe_agent',
      sourceUserId: null,
      relatedEntityType: null,
      relatedEntityId: null,
      title: 'Test',
      summary: null,
      iconType: null,
      severity: 'normal',
      status: 'emitted',
      visibility: 'private',
      visibilityScope: null,
      targetUserId: 'u-1',
      targetChannel: null,
      teamId: null,
      projectId: null,
      goalId: null,
      reactions: { thanks: [], votes: [] },
      expiresAt: null,
      emittedAt: new Date('2026-05-24T10:00:00Z'),
      deliveredAt: null,
      seenAt: null,
      respondedAt: null,
      actionedAt: null,
      ...over,
    };
  }

  beforeEach(() => {
    createMock = vi.fn();
    findFirstMock = vi.fn();
    updateMock = vi.fn();
    findManyMock = vi.fn();
    updateManyMock = vi.fn();

    transactionMock = vi.fn(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));

    prisma = {
      activityFeedItem: {
        create: createMock,
        findFirst: findFirstMock,
        update: updateMock,
        findMany: findManyMock,
        updateMany: updateManyMock,
      },
      $transaction: transactionMock,
    } as unknown as PrismaService;

    incEmittedMock = vi.fn();
    incActionedMock = vi.fn();
    incReactionMock = vi.fn();
    incExpiredMock = vi.fn();
    metrics = {
      incFeedItemEmitted: incEmittedMock,
      incFeedItemActioned: incActionedMock,
      incFeedReaction: incReactionMock,
      incFeedItemExpired: incExpiredMock,
    } as unknown as BusinessMetricsService;

    emitMock = vi.fn();
    gateway = {
      tenantRoom: (t: string) => `tenant:${t}`,
      teamRoom: (t: string) => `team:${t}`,
      userRoom: (u: string) => `user:${u}`,
      emitToRooms: emitMock,
    } as unknown as ActivityFeedGateway;

    svc = new ActivityFeedService(prisma, metrics, gateway);
  });

  it('publish — создаёт запись, инкрементирует метрику emitted и эмитит WS-событие', async () => {
    createMock.mockResolvedValueOnce(makeItem());

    const dto = await svc.publish({
      tenantId: 't-1',
      feedType: 'probe_question',
      sourceType: 'ai_agent',
      sourceAgentName: 'probe_agent',
      visibility: 'private',
      targetUserId: 'u-1',
      title: 'Test',
    });

    expect(dto.id).toBe('i-1');
    expect(dto.feedType).toBe('probe_question');
    expect(dto.severity).toBe('normal');
    expect(dto.status).toBe('emitted');
    expect(incEmittedMock).toHaveBeenCalledWith({
      tenant: 't-1',
      feedType: 'probe_question',
      severity: 'normal',
    });
    expect(emitMock).toHaveBeenCalledTimes(1);
    const [rooms, eventName, payload] = emitMock.mock.calls[0]!;
    expect(eventName).toBe('feed.new_item');
    expect(rooms).toContain('tenant:t-1');
    expect(rooms).toContain('user:u-1');
    expect((payload as { type: string }).type).toBe('feed.new_item');
  });

  it('publish с visibility=team + teamId — WS летит в tenant + team room', async () => {
    createMock.mockResolvedValueOnce(
      makeItem({
        visibility: 'team',
        teamId: 'team-A',
        targetUserId: null,
      }),
    );

    await svc.publish({
      tenantId: 't-1',
      feedType: 'insight',
      sourceType: 'ai_agent',
      visibility: 'team',
      teamId: 'team-A',
      title: 'New insight',
    });

    const [rooms] = emitMock.mock.calls[0]!;
    expect(rooms).toEqual(expect.arrayContaining(['tenant:t-1', 'team:team-A']));
    expect(rooms).not.toContain('user:u-1');
  });

  it('markSeen — переход emitted → seen, метрика actioned, обновлён seenAt', async () => {
    findFirstMock.mockResolvedValueOnce(makeItem({ status: 'emitted' }));
    updateMock.mockResolvedValueOnce(makeItem({ status: 'seen', seenAt: new Date() }));

    const dto = await svc.markSeen({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-1',
    });

    expect(dto.status).toBe('seen');
    expect(updateMock).toHaveBeenCalledTimes(1);
    const callArg = updateMock.mock.calls[0]![0];
    expect(callArg.data.status).toBe('seen');
    expect(callArg.data.seenAt).toBeInstanceOf(Date);
    expect(incActionedMock).toHaveBeenCalledWith({
      tenant: 't-1',
      feedType: 'probe_question',
      status: 'seen',
    });
  });

  it('markSeen дважды — второй вызов идемпотентен (без update, без метрики)', async () => {
    findFirstMock.mockResolvedValueOnce(makeItem({ status: 'seen' }));

    const dto = await svc.markSeen({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-1',
    });

    expect(dto.status).toBe('seen');
    expect(updateMock).not.toHaveBeenCalled();
    expect(incActionedMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('markSeen на expired — запрещённый backward переход, no-op', async () => {
    findFirstMock.mockResolvedValueOnce(makeItem({ status: 'expired' }));

    const dto = await svc.markSeen({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-1',
    });

    expect(dto.status).toBe('expired');
    expect(updateMock).not.toHaveBeenCalled();
    expect(incActionedMock).not.toHaveBeenCalled();
  });

  it('react thanks — добавляет userId в массив и инкрементирует метрику', async () => {
    findFirstMock.mockResolvedValueOnce(makeItem());
    updateMock.mockResolvedValueOnce(makeItem({ reactions: { thanks: ['u-2'], votes: [] } }));

    const dto = await svc.react({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-2',
      reaction: 'thanks',
    });

    expect(dto.reactions.thanks).toEqual(['u-2']);
    expect(dto.reactions.votes).toEqual([]);
    expect(incReactionMock).toHaveBeenCalledWith({
      tenant: 't-1',
      feedType: 'probe_question',
      reaction: 'thanks',
    });
    const callArg = updateMock.mock.calls[0]![0];
    expect(callArg.data.reactions).toEqual({ thanks: ['u-2'], votes: [] });
  });

  it('react thanks дважды — второй вызов дедупится, метрика не растёт', async () => {
    findFirstMock.mockResolvedValueOnce(makeItem({ reactions: { thanks: ['u-2'], votes: [] } }));

    await svc.react({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-2',
      reaction: 'thanks',
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(incReactionMock).not.toHaveBeenCalled();
  });

  it('react разными пользователями — оба попадают в массив', async () => {
    findFirstMock.mockResolvedValueOnce(makeItem({ reactions: { thanks: ['u-2'], votes: [] } }));
    updateMock.mockResolvedValueOnce(
      makeItem({ reactions: { thanks: ['u-2', 'u-3'], votes: [] } }),
    );

    const dto = await svc.react({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-3',
      reaction: 'thanks',
    });

    expect(dto.reactions.thanks).toEqual(['u-2', 'u-3']);
  });

  it('expire — помечает кандидатов, инкрементирует метрику и шлёт WS на каждого', async () => {
    findManyMock.mockResolvedValueOnce([
      { id: 'i-1', tenantId: 't-1', feedType: 'probe_question' },
      { id: 'i-2', tenantId: 't-1', feedType: 'probe_question' },
      { id: 'i-3', tenantId: 't-2', feedType: 'insight' },
    ]);
    updateManyMock.mockResolvedValueOnce({ count: 3 });

    const { updated } = await svc.expire();

    expect(updated).toBe(3);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['i-1', 'i-2', 'i-3'] } },
      data: { status: 'expired' },
    });
    expect(incExpiredMock).toHaveBeenCalledTimes(3);
    expect(incExpiredMock).toHaveBeenCalledWith({
      tenant: 't-1',
      feedType: 'probe_question',
    });
    expect(incExpiredMock).toHaveBeenCalledWith({
      tenant: 't-2',
      feedType: 'insight',
    });
    expect(emitMock).toHaveBeenCalledTimes(3);
    expect(emitMock.mock.calls[0]![1]).toBe('feed.item_expired');
  });

  it('expire без кандидатов — no-op, метрика и WS не вызываются', async () => {
    findManyMock.mockResolvedValueOnce([]);

    const { updated } = await svc.expire();

    expect(updated).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(incExpiredMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('markSeen на несуществующий id — NotFoundException', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    await expect(
      svc.markSeen({ tenantId: 't-1', itemId: 'missing', userId: 'u-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('react на несуществующий id — NotFoundException', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    await expect(
      svc.react({
        tenantId: 't-1',
        itemId: 'missing',
        userId: 'u-1',
        reaction: 'thanks',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dismiss — переход → dismissed + WS feed.item_dismissed с userId', async () => {
    findFirstMock.mockResolvedValueOnce(makeItem({ status: 'seen' }));
    updateMock.mockResolvedValueOnce(makeItem({ status: 'dismissed' }));

    await svc.dismiss({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-1',
    });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'i-1' },
      data: { status: 'dismissed' },
    });
    const [rooms, eventName, payload] = emitMock.mock.calls[0]!;
    expect(eventName).toBe('feed.item_dismissed');
    expect(rooms).toContain('tenant:t-1');
    expect(payload).toMatchObject({
      itemId: 'i-1',
      dismissedByUserId: 'u-1',
    });
  });
});
