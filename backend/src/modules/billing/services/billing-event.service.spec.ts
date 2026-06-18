import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { BillingEventService } from './billing-event.service';

describe('BillingEventService.log (audit Б4)', () => {
  let prisma: {
    billingEventLog: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let svc: BillingEventService;

  beforeEach(() => {
    prisma = {
      billingEventLog: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };
    svc = new BillingEventService(prisma as unknown as PrismaService);
  });

  it('создаёт запись без jti — duplicate=false', async () => {
    const fake = { id: 'log-1', externalEventId: 'evt-1', jti: null };
    prisma.billingEventLog.create.mockResolvedValueOnce(fake);

    const res = await svc.log({
      eventType: 'PROVIDER_WEBHOOK',
      payload: { foo: 'bar' } as never,
      externalEventId: 'evt-1',
    });
    expect(res.duplicate).toBe(false);
    expect(res.event).toBe(fake);
    expect(prisma.billingEventLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalEventId: 'evt-1',
          jti: null,
        }),
      }),
    );
  });

  it('P2002 на jti → duplicate=true, не создаёт повторно', async () => {
    const existing = { id: 'log-2', jti: 'jti-X', externalEventId: 'evt-1' };
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'x',
    });
    prisma.billingEventLog.create.mockRejectedValueOnce(p2002);
    prisma.billingEventLog.findFirst.mockResolvedValueOnce(existing);

    const res = await svc.log({
      eventType: 'PROVIDER_WEBHOOK',
      payload: { foo: 'bar' } as never,
      jti: 'jti-X',
      externalEventId: 'evt-1',
    });
    expect(res.duplicate).toBe(true);
    expect(res.event).toBe(existing);
    expect(prisma.billingEventLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jti: 'jti-X' },
      }),
    );
  });

  it('non-P2002 ошибка пробрасывается наружу', async () => {
    prisma.billingEventLog.create.mockRejectedValueOnce(new Error('boom'));

    await expect(
      svc.log({
        eventType: 'PROVIDER_WEBHOOK',
        payload: { foo: 'bar' } as never,
      }),
    ).rejects.toThrow('boom');
  });
});
