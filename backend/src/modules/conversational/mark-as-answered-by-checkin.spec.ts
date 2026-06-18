import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ConversationalService } from './conversational.service';

interface Mocked {
  svc: ConversationalService;
  prisma: {
    notification: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    notificationDelivery: { updateMany: ReturnType<typeof vi.fn> };
  };
  metrics: { incConversationalNotification: ReturnType<typeof vi.fn> };
  eventEmitter: { emit: ReturnType<typeof vi.fn> };
}

function build(): Mocked {
  const prisma = {
    notification: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notificationDelivery: { updateMany: vi.fn() },
  };
  const cfg = {
    conversational: { quietHoursDefault: '23:00-07:00' },
  };
  const registry = { register: vi.fn() };
  const queue = {};
  const linkCode = {};
  const metrics = { incConversationalNotification: vi.fn() };
  const eventEmitter = { emit: vi.fn() };

  const svc = new ConversationalService(
    prisma as unknown as never,
    cfg as unknown as never,
    registry as unknown as never,
    queue as unknown as never,
    linkCode as unknown as never,
    metrics as unknown as never,
    undefined,
    eventEmitter as unknown as never,
  );

  return { svc, prisma, metrics, eventEmitter };
}

describe('ConversationalService.markAsAnsweredByCheckin (Phase 4)', () => {
  let m: Mocked;
  beforeEach(() => {
    m = build();
  });

  it('успешный путь: notification answered, deliveries обновлены, метрика, БЕЗ event', async () => {
    m.prisma.notification.findUnique.mockResolvedValue({
      id: 'n-1',
      recipientUserId: 'u-1',
      responseStatus: 'pending',
      eventType: 'checkin.prompt',
    });
    m.prisma.notification.update.mockResolvedValue({
      id: 'n-1',
      responseStatus: 'answered',
    });

    const result = await m.svc.markAsAnsweredByCheckin({
      notificationId: 'n-1',
      userId: 'u-1',
      fromSelfInitiated: true,
    });

    expect(result.id).toBe('n-1');
    expect(m.prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'n-1' },
        data: expect.objectContaining({
          responseStatus: 'answered',
          status: 'responded',
        }),
      }),
    );
    expect(m.prisma.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { notificationId: 'n-1' },
      }),
    );
    expect(m.metrics.incConversationalNotification).toHaveBeenCalledWith({
      eventType: 'checkin.prompt',
      status: 'responded',
    });
    expect(m.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('идемпотентность: уже answered → возвращаем notif без update', async () => {
    m.prisma.notification.findUnique.mockResolvedValue({
      id: 'n-1',
      recipientUserId: 'u-1',
      responseStatus: 'answered',
      eventType: 'checkin.prompt',
    });
    const result = await m.svc.markAsAnsweredByCheckin({
      notificationId: 'n-1',
      userId: 'u-1',
      fromSelfInitiated: true,
    });
    expect(result.id).toBe('n-1');
    expect(m.prisma.notification.update).not.toHaveBeenCalled();
  });

  it('notification отсутствует → NotFoundException', async () => {
    m.prisma.notification.findUnique.mockResolvedValue(null);
    await expect(
      m.svc.markAsAnsweredByCheckin({
        notificationId: 'n-x',
        userId: 'u-1',
        fromSelfInitiated: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('чужой recipient → ForbiddenException', async () => {
    m.prisma.notification.findUnique.mockResolvedValue({
      id: 'n-1',
      recipientUserId: 'other-user',
      responseStatus: 'pending',
      eventType: 'checkin.prompt',
    });
    await expect(
      m.svc.markAsAnsweredByCheckin({
        notificationId: 'n-1',
        userId: 'u-1',
        fromSelfInitiated: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
