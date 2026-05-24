import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { PushSubscriptionsService } from './push-subscriptions.service';

interface MockPrisma {
  pushSubscription: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function mkSvc(maxFailures = 3): {
  svc: PushSubscriptionsService;
  prisma: MockPrisma;
} {
  const prisma: MockPrisma = {
    pushSubscription: {
      upsert: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  const cfg = {
    push: { maxFailures, isSendEnabled: true },
  } as unknown as TypedConfigService;
  const svc = new PushSubscriptionsService(
    prisma as unknown as PrismaService,
    cfg,
  );
  return { svc, prisma };
}

describe('PushSubscriptionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe', () => {
    it('upsert по (userId, endpoint) идемпотентен — повторный subscribe не плодит дубль', async () => {
      const { svc, prisma } = mkSvc();
      const row = { id: 'sub-1', userId: 'u1', endpoint: 'https://push/a' };
      prisma.pushSubscription.upsert.mockResolvedValue(row);

      const r1 = await svc.subscribe({
        tenantId: 't1',
        userId: 'u1',
        endpoint: 'https://push/a',
        p256dh: 'pub-key',
        auth: 'auth-secret',
      });
      const r2 = await svc.subscribe({
        tenantId: 't1',
        userId: 'u1',
        endpoint: 'https://push/a',
        p256dh: 'pub-key',
        auth: 'auth-secret',
      });

      expect(r1.id).toBe('sub-1');
      expect(r2.id).toBe('sub-1');
      expect(prisma.pushSubscription.upsert).toHaveBeenCalledTimes(2);
      const callArgs = prisma.pushSubscription.upsert.mock.calls[0]?.[0];
      expect(callArgs.where).toEqual({
        userId_endpoint: { userId: 'u1', endpoint: 'https://push/a' },
      });
      expect(callArgs.create.failureCount).toBe(0);
      expect(callArgs.update.failureCount).toBe(0);
    });

    it('пробрасывает expiresAt и userAgent в create', async () => {
      const { svc, prisma } = mkSvc();
      prisma.pushSubscription.upsert.mockResolvedValue({ id: 'sub-2' });
      const expiresAt = new Date('2026-12-31T00:00:00Z');

      await svc.subscribe({
        tenantId: 't1',
        userId: 'u1',
        endpoint: 'https://push/b',
        p256dh: 'pk',
        auth: 'au',
        userAgent: 'Mozilla/5.0',
        expiresAt,
      });

      const callArgs = prisma.pushSubscription.upsert.mock.calls[0]?.[0];
      expect(callArgs.create.userAgent).toBe('Mozilla/5.0');
      expect(callArgs.create.expiresAt).toBe(expiresAt);
    });
  });

  describe('unsubscribe', () => {
    it('идемпотентно: отсутствующая подписка не приводит к ошибке', async () => {
      const { svc, prisma } = mkSvc();
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });

      const r = await svc.unsubscribe({
        userId: 'u1',
        endpoint: 'https://push/missing',
      });
      expect(r.deleted).toBe(0);
    });

    it('удаляет существующую подписку по (userId, endpoint)', async () => {
      const { svc, prisma } = mkSvc();
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });

      const r = await svc.unsubscribe({
        userId: 'u1',
        endpoint: 'https://push/a',
      });
      expect(r.deleted).toBe(1);
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', endpoint: 'https://push/a' },
      });
    });
  });

  describe('markFailure', () => {
    it('инкрементит failureCount; ниже порога — не удаляет', async () => {
      const { svc, prisma } = mkSvc(3);
      prisma.pushSubscription.update.mockResolvedValue({
        id: 'sub-1',
        failureCount: 1,
      });

      const r = await svc.markFailure({ subscriptionId: 'sub-1' });
      expect(r).toEqual({ failureCount: 1, deleted: false });
      expect(prisma.pushSubscription.delete).not.toHaveBeenCalled();
    });

    it('по достижении порога — удаляет подписку', async () => {
      const { svc, prisma } = mkSvc(3);
      prisma.pushSubscription.update.mockResolvedValue({
        id: 'sub-1',
        failureCount: 3,
      });

      const r = await svc.markFailure({ subscriptionId: 'sub-1' });
      expect(r).toEqual({ failureCount: 3, deleted: true });
      expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
      });
    });
  });

  describe('toView', () => {
    it('не содержит секретов p256dh / auth', () => {
      const { svc } = mkSvc();
      const view = svc.toView({
        id: 'sub-1',
        tenantId: 't1',
        userId: 'u1',
        endpoint: 'https://push/a',
        p256dh: 'SECRET-PUB',
        auth: 'SECRET-AUTH',
        userAgent: 'Mozilla/5.0',
        expiresAt: null,
        lastSeenAt: new Date('2026-05-24T10:00:00Z'),
        failureCount: 0,
        createdAt: new Date('2026-05-24T09:00:00Z'),
      });

      const str = JSON.stringify(view);
      expect(str).not.toContain('SECRET-PUB');
      expect(str).not.toContain('SECRET-AUTH');
      expect(view.id).toBe('sub-1');
      expect(view.userAgent).toBe('Mozilla/5.0');
    });
  });
});
