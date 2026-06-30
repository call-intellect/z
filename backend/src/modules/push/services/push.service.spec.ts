import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ApnsSender } from './apns-sender.service';
import type { FcmSender } from './fcm-sender.service';
import type { PushTransportPayload, PushTransportSendResult } from './push-transport.types';
import { PushService } from './push.service';
import type { RustoreSender } from './rustore-sender.service';
import type { WebPushSender } from './web-push-sender.service';

interface PushTokenRow {
  id: string;
  userId: string;
  tenantId: string;
  transport: string;
  token: string;
  isActive: boolean;
  failureCount: number;
}

function mkSender(args: {
  transport: 'apns' | 'fcm' | 'rustore';
  configured: boolean;
  result?: PushTransportSendResult;
}): {
  sender: ApnsSender | FcmSender | RustoreSender;
  sendToToken: ReturnType<typeof vi.fn>;
} {
  const sendToToken = vi.fn(
    async (_a: { token: string; payload: PushTransportPayload }) =>
      args.result ?? { ok: true },
  );
  const sender = {
    transport: args.transport,
    isConfigured: () => args.configured,
    sendToToken,
  } as unknown as ApnsSender;
  return { sender, sendToToken };
}

function build(opts: {
  tokens: PushTokenRow[];
  maxFailures?: number;
  apnsConfigured?: boolean;
  fcmConfigured?: boolean;
  rustoreConfigured?: boolean;
  apnsResult?: PushTransportSendResult;
  webResult?: { delivered: number; failed: number };
}) {
  const updated: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    pushToken: {
      findMany: vi.fn(async () => opts.tokens.filter((t) => t.isActive)),
      update: vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        updated.push({ id: a.where.id, data: a.data });
        const row = opts.tokens.find((t) => t.id === a.where.id)!;
        if (a.data['failureCount'] && typeof a.data['failureCount'] === 'object') {
          row.failureCount += 1;
        }
        return { failureCount: row.failureCount };
      }),
      upsert: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    channel: { upsert: vi.fn(async () => ({ id: 'ch-1' })) },
    channelBinding: { upsert: vi.fn() },
  } as unknown as PrismaService;

  const cfg = {
    push: { maxFailures: opts.maxFailures ?? 5 },
  } as unknown as TypedConfigService;

  const apns = mkSender({
    transport: 'apns',
    configured: opts.apnsConfigured ?? true,
    ...(opts.apnsResult ? { result: opts.apnsResult } : {}),
  });
  const fcm = mkSender({ transport: 'fcm', configured: opts.fcmConfigured ?? true });
  const rustore = mkSender({ transport: 'rustore', configured: opts.rustoreConfigured ?? true });

  const webSendToUser = vi.fn(async () => opts.webResult ?? { delivered: 0, failed: 0 });
  const webPush = { sendToUser: webSendToUser } as unknown as WebPushSender;

  const service = new PushService(
    prisma,
    cfg,
    apns.sender as ApnsSender,
    fcm.sender as FcmSender,
    rustore.sender as RustoreSender,
    webPush,
  );
  return { service, prisma, apns, fcm, rustore, webSendToUser, updated };
}

describe('PushService.sendToUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('шлёт во все активные транспорты (transport-агностичность)', async () => {
    const { service, apns, fcm, rustore } = build({
      tokens: [
        { id: 't1', userId: 'u1', tenantId: 'org1', transport: 'apns', token: 'a', isActive: true, failureCount: 0 },
        { id: 't2', userId: 'u1', tenantId: 'org1', transport: 'fcm', token: 'b', isActive: true, failureCount: 0 },
        { id: 't3', userId: 'u1', tenantId: 'org1', transport: 'rustore', token: 'c', isActive: true, failureCount: 0 },
      ],
    });
    const res = await service.sendToUser({
      tenantId: 'org1',
      userId: 'u1',
      signal: { kind: 'chat.new_message', conversationId: 'conv-1' },
    });
    expect(apns.sendToToken).toHaveBeenCalledTimes(1);
    expect(fcm.sendToToken).toHaveBeenCalledTimes(1);
    expect(rustore.sendToToken).toHaveBeenCalledTimes(1);
    expect(res.delivered).toBe(3);
  });

  it('отсутствие FCM-кредов → fcm no-op, apns/rustore шлют (R34)', async () => {
    const { service, apns, fcm, rustore } = build({
      tokens: [
        { id: 't1', userId: 'u1', tenantId: 'org1', transport: 'apns', token: 'a', isActive: true, failureCount: 0 },
        { id: 't2', userId: 'u1', tenantId: 'org1', transport: 'fcm', token: 'b', isActive: true, failureCount: 0 },
        { id: 't3', userId: 'u1', tenantId: 'org1', transport: 'rustore', token: 'c', isActive: true, failureCount: 0 },
      ],
      fcmConfigured: false,
    });
    const res = await service.sendToUser({
      tenantId: 'org1',
      userId: 'u1',
      signal: { kind: 'chat.new_message', conversationId: 'conv-1' },
    });
    expect(fcm.sendToToken).not.toHaveBeenCalled();
    expect(apns.sendToToken).toHaveBeenCalledTimes(1);
    expect(rustore.sendToToken).toHaveBeenCalledTimes(1);
    expect(res.delivered).toBe(2);
  });

  it('payload без тела/имён (ФЗ-41): title=Кора, body=Новое сообщение, data только {kind,conversationId}', async () => {
    const { service, apns } = build({
      tokens: [
        { id: 't1', userId: 'u1', tenantId: 'org1', transport: 'apns', token: 'a', isActive: true, failureCount: 0 },
      ],
      fcmConfigured: false,
      rustoreConfigured: false,
    });
    await service.sendToUser({
      tenantId: 'org1',
      userId: 'u1',
      signal: { kind: 'chat.new_message', conversationId: 'conv-1' },
    });
    const arg = apns.sendToToken.mock.calls[0]![0] as { payload: PushTransportPayload };
    expect(arg.payload.title).toBe('Кора');
    expect(arg.payload.body).toBe('Новое сообщение');
    expect(arg.payload.data).toEqual({ kind: 'chat.new_message', conversationId: 'conv-1' });
    const flat = JSON.stringify(arg.payload);
    expect(flat).not.toMatch(/content|authorName|displayName|text/i);
  });

  it('failure → failureCount++; при достижении max → isActive=false', async () => {
    const { service, updated } = build({
      tokens: [
        { id: 't1', userId: 'u1', tenantId: 'org1', transport: 'apns', token: 'a', isActive: true, failureCount: 4 },
      ],
      fcmConfigured: false,
      rustoreConfigured: false,
      maxFailures: 5,
      apnsResult: { ok: false },
    });
    const res = await service.sendToUser({
      tenantId: 'org1',
      userId: 'u1',
      signal: { kind: 'chat.new_message', conversationId: 'conv-1' },
    });
    expect(res.failed).toBe(1);
    expect(updated.some((u) => 'failureCount' in u.data)).toBe(true);
    expect(updated.some((u) => u.data['isActive'] === false)).toBe(true);
  });

  it('webpush делегируется WebPushSender и суммируется', async () => {
    const { service, webSendToUser } = build({
      tokens: [],
      webResult: { delivered: 2, failed: 0 },
    });
    const res = await service.sendToUser({
      tenantId: 'org1',
      userId: 'u1',
      signal: { kind: 'chat.new_message', conversationId: 'conv-1' },
    });
    expect(webSendToUser).toHaveBeenCalledTimes(1);
    expect(res.delivered).toBe(2);
  });
});

describe('PushService register/unregister', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registerToken идемпотентен (upsert по @@unique) + ensurePushBinding', async () => {
    const upsert = vi.fn(async () => ({ id: 'pt-1' }));
    const channelUpsert = vi.fn(async () => ({ id: 'ch-1' }));
    const bindingUpsert = vi.fn(async () => ({ id: 'b-1' }));
    const prisma = {
      pushToken: { upsert },
      channel: { upsert: channelUpsert },
      channelBinding: { upsert: bindingUpsert },
    } as unknown as PrismaService;
    const service = new PushService(
      prisma,
      { push: { maxFailures: 5 } } as unknown as TypedConfigService,
      {} as ApnsSender,
      {} as FcmSender,
      {} as RustoreSender,
      {} as WebPushSender,
    );
    await service.registerToken({
      tenantId: 'org1',
      userId: 'u1',
      transport: 'apns',
      token: 'tok',
    });
    expect(channelUpsert).toHaveBeenCalledTimes(1);
    expect(bindingUpsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('unregisterToken деактивирует (isActive=false)', async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const prisma = {
      pushToken: { updateMany },
    } as unknown as PrismaService;
    const service = new PushService(
      prisma,
      { push: { maxFailures: 5 } } as unknown as TypedConfigService,
      {} as ApnsSender,
      {} as FcmSender,
      {} as RustoreSender,
      {} as WebPushSender,
    );
    const res = await service.unregisterToken({ userId: 'u1', token: 'tok' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(res.deactivated).toBe(2);
  });
});
