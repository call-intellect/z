import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { PushCleanupCron } from './push-cleanup.cron';

function build(maxFailures = 5): {
  cron: PushCleanupCron;
  prisma: {
    pushSubscription: { deleteMany: ReturnType<typeof vi.fn> };
  };
} {
  const prisma = {
    pushSubscription: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const cfg = {
    push: { maxFailures, isSendEnabled: true },
  } as unknown as TypedConfigService;
  const cron = new PushCleanupCron(
    prisma as unknown as PrismaService,
    cfg,
  );
  return { cron, prisma };
}

describe('PushCleanupCron.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('удаляет подписки с failureCount >= max ИЛИ expiresAt < now', async () => {
    const { cron, prisma } = build(5);
    prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 7 });

    const res = await cron.run();
    expect(res.deleted).toBe(7);

    const args = prisma.pushSubscription.deleteMany.mock.calls[0]?.[0];
    expect(args.where.OR).toEqual([
      { failureCount: { gte: 5 } },
      { expiresAt: { lt: expect.any(Date) } },
    ]);
  });

  it('пустой результат — возвращает 0, без ошибки', async () => {
    const { cron } = build();
    const res = await cron.run();
    expect(res.deleted).toBe(0);
  });
});
