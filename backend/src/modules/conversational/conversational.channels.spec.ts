/**
 * ТЗ 2026-06-05 telegram-channel-reachability-and-channels-ux-fix, Ф1 (Б1/Б1b/Б2).
 *
 * Покрывает:
 *  - listMyChannels: глобальные бот-каналы (tenantId=NULL, kind in telegram_bot/max_bot)
 *    видны на личной странице; per-tenant каналы тоже; глобальный SMTP НЕ просачивается.
 *  - resolveBindings: тот же OR в пути доставки (verified bindings к глобальному каналу).
 *  - Контроллер: для бот-каналов отдаёт configured/botUsername, но НЕ botToken (нет утечки).
 */
import type { Channel, ChannelBinding } from '@prisma/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ConversationalController } from './conversational.controller';
import { ConversationalService } from './conversational.service';

interface Mocked {
  svc: ConversationalService;
  prisma: {
    channel: { findMany: ReturnType<typeof vi.fn> };
    channelBinding: { findMany: ReturnType<typeof vi.fn> };
  };
}

function build(): Mocked {
  const prisma = {
    channel: { findMany: vi.fn().mockResolvedValue([]) },
    channelBinding: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const cfg = { conversational: { quietHoursDefault: '23:00-07:00' } };
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

/** Удобный конструктор Channel с минимально нужными полями. */
function channel(partial: Partial<Channel>): Channel {
  return {
    id: 'ch',
    tenantId: null,
    kind: 'in_app',
    direction: 'bidirectional',
    status: 'active',
    maxDataClass: 'internal',
    config: {},
    ...partial,
  } as Channel;
}

const TENANT = 'org-1';
const USER = 'user-1';

describe('ConversationalService.listMyChannels (Ф1 Б1)', () => {
  let m: Mocked;
  beforeEach(() => {
    m = build();
  });

  it('запрашивает per-tenant каналы И глобальные бот-каналы (OR с tenantId:null, kind whitelist)', async () => {
    const tg = channel({
      id: 'tg',
      tenantId: null,
      kind: 'telegram_bot',
      config: { botToken: 'enc', botUsername: 'kora_bot' },
    });
    const inApp = channel({ id: 'in', tenantId: TENANT, kind: 'in_app' });
    m.prisma.channel.findMany.mockResolvedValueOnce([tg, inApp]);

    const res = await m.svc.listMyChannels({ userId: USER, tenantId: TENANT });

    // (а) возвращает ОБА канала
    expect(res.map((r) => r.channel.id).sort()).toEqual(['in', 'tg']);

    // where содержит OR: per-tenant ИЛИ глобальный бот
    expect(m.prisma.channel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'active',
          OR: expect.arrayContaining([
            { tenantId: TENANT },
            { tenantId: null, kind: { in: ['telegram_bot', 'max_bot'] } },
          ]),
        }),
      }),
    );
  });
});

describe('ConversationalService.resolveBindings (Ф1 Б1b — путь доставки)', () => {
  let m: Mocked;
  beforeEach(() => {
    m = build();
  });

  it('verified bindings фильтруются по тому же OR (глобальный бот доставляется)', async () => {
    // resolveBindings приватный — дёргаем через индексный доступ.
    await (
      m.svc as unknown as {
        resolveBindings: (a: {
          tenantId: string;
          userId: string;
        }) => Promise<unknown>;
      }
    ).resolveBindings({ tenantId: TENANT, userId: USER });

    expect(m.prisma.channelBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER,
          verifiedAt: { not: null },
          channel: expect.objectContaining({
            status: 'active',
            OR: expect.arrayContaining([
              { tenantId: TENANT },
              { tenantId: null, kind: { in: ['telegram_bot', 'max_bot'] } },
            ]),
          }),
        }),
      }),
    );
  });
});

describe('ConversationalController.listChannels mapping (Ф1 Б2)', () => {
  function buildController(items: Array<{ channel: Channel; binding: ChannelBinding | null }>) {
    const svc = {
      listMyChannels: vi.fn().mockResolvedValue(items),
    };
    const ingest = {};
    const ctrl = new ConversationalController(
      svc as unknown as never,
      ingest as unknown as never,
    );
    return ctrl;
  }

  it('(а) бот с botToken → configured:true + botUsername, без утечки токена', async () => {
    const tg = channel({
      id: 'tg',
      tenantId: null,
      kind: 'telegram_bot',
      config: { botToken: 'enc-secret', botUsername: 'kora_bot' },
    });
    const ctrl = buildController([{ channel: tg, binding: null }]);

    const out = await ctrl.listChannels(
      { id: USER } as never,
      TENANT,
    );
    const ch = out.items[0]!.channel as Record<string, unknown>;

    expect(ch.configured).toBe(true);
    expect(ch.botUsername).toBe('kora_bot');
    // негатив: токен наружу не отдаётся ни под каким ключом.
    expect(ch).not.toHaveProperty('botToken');
    expect(ch).not.toHaveProperty('config');
    expect(JSON.stringify(out)).not.toContain('enc-secret');
  });

  it('(б) бот с пустым config → configured:false, botUsername:null', async () => {
    const tg = channel({
      id: 'tg2',
      tenantId: null,
      kind: 'telegram_bot',
      config: {},
    });
    const ctrl = buildController([{ channel: tg, binding: null }]);

    const out = await ctrl.listChannels({ id: USER } as never, TENANT);
    const ch = out.items[0]!.channel as Record<string, unknown>;

    expect(ch.configured).toBe(false);
    expect(ch.botUsername).toBeNull();
  });

  it('(в) не-бот канал (in_app) НЕ получает configured/botUsername', async () => {
    const inApp = channel({ id: 'in', tenantId: TENANT, kind: 'in_app' });
    const ctrl = buildController([{ channel: inApp, binding: null }]);

    const out = await ctrl.listChannels({ id: USER } as never, TENANT);
    const ch = out.items[0]!.channel as Record<string, unknown>;

    expect(ch).not.toHaveProperty('configured');
    expect(ch).not.toHaveProperty('botUsername');
  });
});
