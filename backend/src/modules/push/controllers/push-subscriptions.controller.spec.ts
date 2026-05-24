import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { PushSubscriptionsService } from '../services/push-subscriptions.service';

import { PushSubscriptionsController } from './push-subscriptions.controller';

const sampleUser: CurrentUserPayload = {
  id: 'u-1',
  email: 'user@z.test',
  role: 'user',
};

function build(): {
  ctl: PushSubscriptionsController;
  svc: {
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    listMine: ReturnType<typeof vi.fn>;
    toView: ReturnType<typeof vi.fn>;
  };
} {
  const svc = {
    subscribe: vi.fn(async () => ({
      id: 'sub-1',
      endpoint: 'https://push/a',
      userAgent: null,
      lastSeenAt: new Date(),
      createdAt: new Date(),
    })),
    unsubscribe: vi.fn(async () => ({ deleted: 1 })),
    listMine: vi.fn(async () => [
      {
        id: 'sub-1',
        endpoint: 'https://push/a',
        userAgent: 'Mozilla',
        lastSeenAt: new Date('2026-05-24T00:00:00Z'),
        createdAt: new Date('2026-05-23T00:00:00Z'),
        tenantId: 't-1',
        userId: 'u-1',
        p256dh: 'pk',
        auth: 'au',
        expiresAt: null,
        failureCount: 0,
      },
    ]),
    toView: vi.fn((s: { id: string; endpoint: string }) => ({
      id: s.id,
      endpoint: s.endpoint,
      userAgent: 'Mozilla',
      lastSeenAt: '2026-05-24T00:00:00.000Z',
      createdAt: '2026-05-23T00:00:00.000Z',
    })),
  };
  const ctl = new PushSubscriptionsController(
    svc as unknown as PushSubscriptionsService,
  );
  return { ctl, svc };
}

describe('PushSubscriptionsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('subscribe (POST)', () => {
    it('передаёт endpoint, keys, userAgent в service, возвращает { ok, id }', async () => {
      const { ctl, svc } = build();
      const body = {
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'pub-key', auth: 'auth-secret' },
        expirationTime: null,
        userAgent: 'Mozilla/5.0',
      };
      const res = await ctl.subscribe(body, sampleUser, 't-1');
      expect(res).toEqual({ ok: true, id: 'sub-1' });
      expect(svc.subscribe).toHaveBeenCalledWith({
        tenantId: 't-1',
        userId: 'u-1',
        endpoint: 'https://push.example/abc',
        p256dh: 'pub-key',
        auth: 'auth-secret',
        userAgent: 'Mozilla/5.0',
        expiresAt: null,
      });
    });

    it('преобразует expirationTime (number ms) в Date', async () => {
      const { ctl, svc } = build();
      const expirationTime = new Date('2026-12-31T00:00:00Z').getTime();
      await ctl.subscribe(
        {
          endpoint: 'https://push.example/abc',
          keys: { p256dh: 'pk', auth: 'au' },
          expirationTime,
        },
        sampleUser,
        't-1',
      );
      const args = svc.subscribe.mock.calls[0]?.[0];
      expect(args.expiresAt).toBeInstanceOf(Date);
      expect((args.expiresAt as Date).getTime()).toBe(expirationTime);
    });

    it('tenant_required → BadRequest, если X-Org-Id не определён', async () => {
      const { ctl } = build();
      await expect(
        ctl.subscribe(
          {
            endpoint: 'https://push.example/abc',
            keys: { p256dh: 'pk', auth: 'au' },
          },
          sampleUser,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('unsubscribe (DELETE)', () => {
    it('вызывает service.unsubscribe и возвращает void (204)', async () => {
      const { ctl, svc } = build();
      const result = await ctl.unsubscribe(
        { endpoint: 'https://push.example/abc' },
        sampleUser,
        't-1',
      );
      expect(result).toBeUndefined();
      expect(svc.unsubscribe).toHaveBeenCalledWith({
        userId: 'u-1',
        endpoint: 'https://push.example/abc',
      });
    });
  });

  describe('list (GET)', () => {
    it('возвращает items без секретов', async () => {
      const { ctl } = build();
      const res = await ctl.list(sampleUser, 't-1');
      expect(res.items).toHaveLength(1);
      const str = JSON.stringify(res);
      expect(str).not.toContain('p256dh');
      expect(str).not.toContain('"auth"');
    });
  });
});
