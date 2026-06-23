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

  return { svc, prisma };
}

describe('ConversationalService.dismissProbe (Ф2 взаимное закрытие при отклонении)', () => {
  let m: Mocked;
  beforeEach(() => {
    m = build();
  });

  it('успех: notification dismissed + гашение доставок во всех каналах', async () => {
    m.prisma.notification.findUnique.mockResolvedValue({
      id: 'n-1',
      recipientUserId: 'u-1',
      eventType: 'probe.question',
    });
    m.prisma.notification.update.mockResolvedValue({
      id: 'n-1',
      responseStatus: 'dismissed',
      status: 'read',
    });

    const result = await m.svc.dismissProbe({
      notificationId: 'n-1',
      userId: 'u-1',
    });

    expect(result.id).toBe('n-1');
    expect(m.prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'n-1' },
        data: expect.objectContaining({
          responseStatus: 'dismissed',
          status: 'read',
        }),
      }),
    );
    expect(m.prisma.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ notificationId: 'n-1' }),
        data: expect.objectContaining({
          status: 'responded',
          respondedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('notification отсутствует → NotFoundException, доставки не трогаем', async () => {
    m.prisma.notification.findUnique.mockResolvedValue(null);
    await expect(
      m.svc.dismissProbe({ notificationId: 'n-x', userId: 'u-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(m.prisma.notificationDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('чужой recipient → ForbiddenException, доставки не трогаем', async () => {
    m.prisma.notification.findUnique.mockResolvedValue({
      id: 'n-1',
      recipientUserId: 'other-user',
      eventType: 'probe.question',
    });
    await expect(
      m.svc.dismissProbe({ notificationId: 'n-1', userId: 'u-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.prisma.notificationDelivery.updateMany).not.toHaveBeenCalled();
  });
});
