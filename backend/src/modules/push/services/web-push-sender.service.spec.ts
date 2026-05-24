import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';

import type { PushSubscriptionsService } from './push-subscriptions.service';
import { WebPushSender } from './web-push-sender.service';

// Mock npm `web-push` (default export).
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

// Достаём mock'нутый default из ESM-обёртки.
async function getWebpushMock(): Promise<{
  setVapidDetails: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
}> {
  const mod = (await import('web-push')) as unknown as {
    default: {
      setVapidDetails: ReturnType<typeof vi.fn>;
      sendNotification: ReturnType<typeof vi.fn>;
    };
  };
  return mod.default;
}

function mkSender(opts: {
  isSendEnabled: boolean;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
}): {
  sender: WebPushSender;
  subs: {
    listForUser: ReturnType<typeof vi.fn>;
    markFailure: ReturnType<typeof vi.fn>;
    markSuccess: ReturnType<typeof vi.fn>;
  };
} {
  const cfg = {
    push: {
      isSendEnabled: opts.isSendEnabled,
      vapidPublicKey: opts.vapidPublicKey,
      vapidPrivateKey: opts.vapidPrivateKey,
      vapidSubject: 'mailto:test@kora.app',
      maxFailures: 3,
    },
  } as unknown as TypedConfigService;
  const subs = {
    listForUser: vi.fn().mockResolvedValue([]),
    markFailure: vi.fn().mockResolvedValue({ failureCount: 1, deleted: false }),
    markSuccess: vi.fn().mockResolvedValue(undefined),
  };
  const sender = new WebPushSender(
    cfg,
    subs as unknown as PushSubscriptionsService,
  );
  return { sender, subs };
}

describe('WebPushSender', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const m = await getWebpushMock();
    m.setVapidDetails.mockReset();
    m.sendNotification.mockReset();
  });

  it('без VAPID — onModuleInit логирует warn, sendToUser возвращает нули', async () => {
    const { sender, subs } = mkSender({ isSendEnabled: false });
    sender.onModuleInit();

    const m = await getWebpushMock();
    expect(m.setVapidDetails).not.toHaveBeenCalled();

    const r = await sender.sendToUser({
      tenantId: 't1',
      userId: 'u1',
      title: 'Hello',
      body: 'World',
    });
    expect(r).toEqual({ delivered: 0, failed: 0 });
    expect(subs.listForUser).not.toHaveBeenCalled();
  });

  it('с VAPID — отправляет всем подпискам user, успехи учитывает в delivered', async () => {
    const { sender, subs } = mkSender({
      isSendEnabled: true,
      vapidPublicKey: 'pub-key',
      vapidPrivateKey: 'priv-key',
    });
    sender.onModuleInit();

    subs.listForUser.mockResolvedValue([
      {
        id: 'sub-1',
        endpoint: 'https://push/a',
        p256dh: 'pk1',
        auth: 'au1',
      },
      {
        id: 'sub-2',
        endpoint: 'https://push/b',
        p256dh: 'pk2',
        auth: 'au2',
      },
    ]);
    const m = await getWebpushMock();
    m.sendNotification.mockResolvedValue({ statusCode: 201 });

    const r = await sender.sendToUser({
      tenantId: 't1',
      userId: 'u1',
      title: 'T',
      body: 'B',
      url: 'https://kora.app/inbox',
    });

    expect(r).toEqual({ delivered: 2, failed: 0 });
    expect(m.sendNotification).toHaveBeenCalledTimes(2);
    expect(subs.markSuccess).toHaveBeenCalledTimes(2);
    expect(subs.markFailure).not.toHaveBeenCalled();
    // payload содержит url
    const payloadStr = m.sendNotification.mock.calls[0]?.[1];
    expect(typeof payloadStr).toBe('string');
    const payload = JSON.parse(String(payloadStr));
    expect(payload.data?.url).toBe('https://kora.app/inbox');
  });

  it('410 от push-сервиса → markFailure (на 404 — то же)', async () => {
    const { sender, subs } = mkSender({
      isSendEnabled: true,
      vapidPublicKey: 'pub-key',
      vapidPrivateKey: 'priv-key',
    });
    sender.onModuleInit();

    subs.listForUser.mockResolvedValue([
      { id: 'sub-1', endpoint: 'https://push/a', p256dh: 'pk', auth: 'au' },
      { id: 'sub-2', endpoint: 'https://push/b', p256dh: 'pk', auth: 'au' },
    ]);
    const m = await getWebpushMock();
    const err410 = Object.assign(new Error('Gone'), { statusCode: 410 });
    const err404 = Object.assign(new Error('Not Found'), { statusCode: 404 });
    m.sendNotification
      .mockRejectedValueOnce(err410)
      .mockRejectedValueOnce(err404);

    const r = await sender.sendToUser({
      tenantId: 't1',
      userId: 'u1',
      title: 'T',
      body: 'B',
    });

    expect(r).toEqual({ delivered: 0, failed: 2 });
    expect(subs.markFailure).toHaveBeenCalledTimes(2);
    expect(subs.markFailure).toHaveBeenNthCalledWith(1, {
      subscriptionId: 'sub-1',
    });
    expect(subs.markFailure).toHaveBeenNthCalledWith(2, {
      subscriptionId: 'sub-2',
    });
  });

  it('5xx от push-сервиса — markFailure НЕ вызывается (временная ошибка)', async () => {
    const { sender, subs } = mkSender({
      isSendEnabled: true,
      vapidPublicKey: 'pub-key',
      vapidPrivateKey: 'priv-key',
    });
    sender.onModuleInit();

    subs.listForUser.mockResolvedValue([
      { id: 'sub-1', endpoint: 'https://push/a', p256dh: 'pk', auth: 'au' },
    ]);
    const m = await getWebpushMock();
    const err500 = Object.assign(new Error('Server Error'), { statusCode: 500 });
    m.sendNotification.mockRejectedValue(err500);

    const r = await sender.sendToUser({
      tenantId: 't1',
      userId: 'u1',
      title: 'T',
      body: 'B',
    });

    expect(r).toEqual({ delivered: 0, failed: 1 });
    expect(subs.markFailure).not.toHaveBeenCalled();
  });

  it('пустой список подписок — возвращает 0/0 без обращения к web-push', async () => {
    const { sender, subs } = mkSender({
      isSendEnabled: true,
      vapidPublicKey: 'pub-key',
      vapidPrivateKey: 'priv-key',
    });
    sender.onModuleInit();
    subs.listForUser.mockResolvedValue([]);

    const r = await sender.sendToUser({
      tenantId: 't1',
      userId: 'u1',
      title: 'T',
      body: 'B',
    });
    expect(r).toEqual({ delivered: 0, failed: 0 });
    const m = await getWebpushMock();
    expect(m.sendNotification).not.toHaveBeenCalled();
  });
});
