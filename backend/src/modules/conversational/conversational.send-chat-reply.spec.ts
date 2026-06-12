/**
 * Ф1 «Стоп-молчание» (ТЗ 2026-06-11 assistant-channels) — unit-тесты для
 * `ConversationalService.sendChatReply` (флаг `solicited`) и нового
 * публичного резолвера `resolveOriginChannelKinds`.
 *
 * Покрывает:
 *   - solicited=true + валидный originChannelBindingId → critical=true
 *     (байпас тихих часов / push-бюджета внутри sendNotification);
 *   - без solicited → critical=false (поведение как раньше);
 *   - solicited=true БЕЗ originChannelBindingId → critical=false
 *     (solicited действует только в паре с каналом-источником);
 *   - solicited=true + НЕвалидный binding → critical=false;
 *   - resolveOriginChannelKinds: валидный binding → [kind], глобальный
 *     канал (tenantId=null) допустим, чужой user / неактивный канал → [].
 */
import type { Notification } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationalService } from './conversational.service';

interface Mocked {
  svc: ConversationalService;
  prisma: {
    channelBinding: { findUnique: ReturnType<typeof vi.fn> };
  };
  sendNotification: ReturnType<typeof vi.fn>;
}

function makeBinding(overrides?: {
  userId?: string;
  channelTenantId?: string | null;
  channelStatus?: string;
  kind?: string;
}) {
  return {
    id: 'binding-1',
    userId: overrides?.userId ?? 'u-1',
    channel: {
      tenantId:
        overrides?.channelTenantId === undefined
          ? 'org-1'
          : overrides.channelTenantId,
      status: overrides?.channelStatus ?? 'active',
      kind: overrides?.kind ?? 'telegram_bot',
    },
  };
}

function build(): Mocked {
  const prisma = {
    channelBinding: { findUnique: vi.fn() },
  };
  const cfg = {
    conversational: { quietHoursDefault: '23:00-07:00' },
  };

  const svc = new ConversationalService(
    prisma as unknown as never,
    cfg as unknown as never,
    {} as unknown as never, // registry
    {} as unknown as never, // queue
    {} as unknown as never, // linkCode
    { incConversationalNotification: vi.fn() } as unknown as never, // metrics
    undefined, // budget
    undefined, // policy
    undefined, // eventEmitter
  );

  // sendChatReply делегирует в sendNotification — мокаем его, чтобы
  // проверять только контракт вызова (critical/dataClass/preferredKinds).
  const sendNotification = vi
    .spyOn(svc, 'sendNotification')
    .mockResolvedValue({ id: 'n-1' } as unknown as Notification);

  return { svc, prisma, sendNotification };
}

function baseArgs() {
  return {
    tenantId: 'org-1',
    userId: 'u-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    text: 'Ответ Коры',
    citationsCount: 2,
  };
}

describe('ConversationalService.sendChatReply — Ф1 solicited (Стоп-молчание)', () => {
  let m: Mocked;
  beforeEach(() => {
    m = build();
  });

  it('solicited=true + валидный originChannelBindingId → critical=true и канал-источник', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(makeBinding());

    await m.svc.sendChatReply({
      ...baseArgs(),
      originChannelBindingId: 'binding-1',
      dataClass: 'internal',
      solicited: true,
    });

    expect(m.sendNotification).toHaveBeenCalledTimes(1);
    expect(m.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'chat.answer',
        dataClass: 'internal',
        preferredChannelKinds: ['telegram_bot'],
        critical: true,
      }),
    );
  });

  it('без solicited (дефолт) → critical=false даже с валидным binding', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(makeBinding());

    await m.svc.sendChatReply({
      ...baseArgs(),
      originChannelBindingId: 'binding-1',
    });

    expect(m.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        critical: false,
        preferredChannelKinds: ['telegram_bot'],
      }),
    );
  });

  it('solicited=true БЕЗ originChannelBindingId → critical=false', async () => {
    await m.svc.sendChatReply({
      ...baseArgs(),
      solicited: true,
    });

    expect(m.prisma.channelBinding.findUnique).not.toHaveBeenCalled();
    expect(m.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        critical: false,
        preferredChannelKinds: undefined,
      }),
    );
  });

  it('solicited=true + НЕвалидный binding (не найден) → critical=false, fallback на policy', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(null);

    await m.svc.sendChatReply({
      ...baseArgs(),
      originChannelBindingId: 'binding-ghost',
      solicited: true,
    });

    expect(m.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        critical: false,
        preferredChannelKinds: undefined,
      }),
    );
  });

  it('dataClass по умолчанию остаётся sensitive', async () => {
    await m.svc.sendChatReply(baseArgs());

    expect(m.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ dataClass: 'sensitive' }),
    );
  });
});

describe('ConversationalService.resolveOriginChannelKinds (Ф1)', () => {
  let m: Mocked;
  beforeEach(() => {
    m = build();
  });

  it('валидный binding → [kind]', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(makeBinding());
    await expect(
      m.svc.resolveOriginChannelKinds({
        originChannelBindingId: 'binding-1',
        userId: 'u-1',
        tenantId: 'org-1',
      }),
    ).resolves.toEqual(['telegram_bot']);
  });

  it('глобальный канал (tenantId=null, telegram/max) → [kind]', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(
      makeBinding({ channelTenantId: null }),
    );
    await expect(
      m.svc.resolveOriginChannelKinds({
        originChannelBindingId: 'binding-1',
        userId: 'u-1',
        tenantId: 'org-1',
      }),
    ).resolves.toEqual(['telegram_bot']);
  });

  it('без originChannelBindingId → [] (без запроса в БД)', async () => {
    await expect(
      m.svc.resolveOriginChannelKinds({
        userId: 'u-1',
        tenantId: 'org-1',
      }),
    ).resolves.toEqual([]);
    expect(m.prisma.channelBinding.findUnique).not.toHaveBeenCalled();
  });

  it('binding чужого пользователя → []', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(
      makeBinding({ userId: 'other-user' }),
    );
    await expect(
      m.svc.resolveOriginChannelKinds({
        originChannelBindingId: 'binding-1',
        userId: 'u-1',
        tenantId: 'org-1',
      }),
    ).resolves.toEqual([]);
  });

  it('канал другого Org → []', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(
      makeBinding({ channelTenantId: 'org-2' }),
    );
    await expect(
      m.svc.resolveOriginChannelKinds({
        originChannelBindingId: 'binding-1',
        userId: 'u-1',
        tenantId: 'org-1',
      }),
    ).resolves.toEqual([]);
  });

  it('неактивный канал → []', async () => {
    m.prisma.channelBinding.findUnique.mockResolvedValue(
      makeBinding({ channelStatus: 'disabled' }),
    );
    await expect(
      m.svc.resolveOriginChannelKinds({
        originChannelBindingId: 'binding-1',
        userId: 'u-1',
        tenantId: 'org-1',
      }),
    ).resolves.toEqual([]);
  });
});
