import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { JwtService } from '../../auth/services/jwt.service';
import type { MessageDto, GetMessagesResult } from '../dto/message.dto';
import type { MessageService } from '../services/message.service';

import type { AccessLinkService } from './access-link.service';
import type { ExternalConversationService } from './external-conversation.service';
import { ExternalGuestController } from './external-guest.controller';
import type { ExternalGuestRequest } from './external-guest.guard';

function msg(seq: string, access: string, content: string): MessageDto {
  return {
    id: `m-${seq}`,
    conversationId: 'conv-1',
    seq,
    authorUserId: 'u1',
    authorType: 'human',
    access,
    content,
    parentMessageId: null,
    voiceUrl: null,
    voiceDuration: null,
    mentions: [],
    reactions: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
  };
}

function build(opts?: {
  enabled?: boolean;
  verifyToken?: () => Promise<unknown>;
  getMessagesResult?: GetMessagesResult;
}) {
  const enabled = opts?.enabled ?? true;

  const cfg = {
    externalChat: { enabled },
    auth: { cookieDomain: undefined },
    runtime: { isDevelopment: true },
  } as unknown as TypedConfigService;

  const verifyToken =
    opts?.verifyToken ??
    vi.fn().mockResolvedValue({
      accessLink: {
        id: 'link-1',
        contactEmail: 'c@example.com',
        contactPhone: null,
        claimedByUserId: 'guest-1',
      },
      conversationId: 'conv-1',
    });
  const claimLink = vi.fn().mockResolvedValue(undefined);
  const accessLinks = { verifyToken, claimLink } as unknown as AccessLinkService;

  const ensureShadowClientUser = vi.fn().mockResolvedValue({ userId: 'guest-1' });
  const addClientMember = vi.fn().mockResolvedValue(undefined);
  const getConversationTenantId = vi.fn().mockResolvedValue('org-1');
  const assertInboundRateLimit = vi.fn().mockResolvedValue(undefined);
  const requestRegisterCode = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn().mockResolvedValue(undefined);
  const reportConversation = vi.fn().mockResolvedValue(undefined);
  const external = {
    ensureShadowClientUser,
    addClientMember,
    getConversationTenantId,
    assertInboundRateLimit,
    requestRegisterCode,
    register,
    reportConversation,
  } as unknown as ExternalConversationService;

  const getMessages = vi
    .fn()
    .mockResolvedValue(opts?.getMessagesResult ?? { items: [], nextSeq: null });
  const appendTicketMessage = vi.fn().mockResolvedValue({ messageId: 'm-new', seq: '7' });
  const messages = { getMessages, appendTicketMessage } as unknown as MessageService;

  const signExternalGuestSession = vi.fn().mockReturnValue('signed-token');
  const jwt = {
    signExternalGuestSession,
    externalGuestSessionTtlSeconds: 3600,
  } as unknown as JwtService;

  const controller = new ExternalGuestController(external, accessLinks, messages, jwt, cfg);
  return {
    controller,
    verifyToken,
    claimLink,
    ensureShadowClientUser,
    addClientMember,
    assertInboundRateLimit,
    requestRegisterCode,
    register,
    reportConversation,
    getMessages,
    appendTicketMessage,
    signExternalGuestSession,
  };
}

function fakeResponse() {
  const cookie = vi.fn();
  return { cookie } as unknown as Response & { cookie: ReturnType<typeof vi.fn> };
}

describe('ExternalGuestController.access', () => {
  it('флаг off → 503 EXTERNAL_CHAT_DISABLED', async () => {
    const { controller } = build({ enabled: false });
    await expect(
      controller.access({ token: 'a'.repeat(32) }, fakeResponse()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('валидный токен → shadow user + client-member + guest-cookie + conversationId', async () => {
    const { controller, ensureShadowClientUser, addClientMember, claimLink } = build();
    const res = fakeResponse();
    const out = await controller.access({ token: 'a'.repeat(32) }, res);

    expect(out).toEqual({ conversationId: 'conv-1' });
    expect(ensureShadowClientUser).toHaveBeenCalledWith({
      contactEmail: 'c@example.com',
      contactPhone: null,
    });
    expect(claimLink).toHaveBeenCalledWith('link-1', 'guest-1');
    expect(addClientMember).toHaveBeenCalledWith('conv-1', 'guest-1');

    const cookieCall = (res as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie.mock
      .calls[0]!;
    expect(cookieCall[0]).toBe('z_external_session');
    expect(cookieCall[1]).toBe('signed-token');
    expect(cookieCall[2]).toMatchObject({ httpOnly: true, sameSite: 'lax' });
  });

  it('revoked/expired ссылка → 403 (проброс verifyToken)', async () => {
    const verifyToken = vi.fn().mockRejectedValue(
      new ForbiddenException({
        ok: false,
        error: { code: 'ACCESS_LINK_REVOKED', message: 'Ссылка доступа отозвана' },
      }),
    );
    const { controller } = build({ verifyToken });
    await expect(
      controller.access({ token: 'a'.repeat(32) }, fakeResponse()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ExternalGuestController.listMessages (security)', () => {
  it('НИКОГДА не возвращает internal — только external/normal', async () => {
    const getMessagesResult: GetMessagesResult = {
      items: [
        msg('1', 'external', 'клиентское'),
        msg('2', 'internal', 'СЕКРЕТНАЯ-ВНУТРЕННЯЯ-ЗАМЕТКА'),
        msg('3', 'normal', 'обычное'),
        msg('4', 'internal', 'ЕЩЁ-ОДНА-ВНУТРЕННЯЯ'),
      ],
      nextSeq: '4',
    };
    const { controller } = build({ getMessagesResult });
    const out = await controller.listMessages('conv-1', {});

    const accesses = out.items.map((m) => m.access);
    expect(accesses).toEqual(['external', 'normal']);
    expect(out.items.some((m) => m.access === 'internal')).toBe(false);
    const dump = JSON.stringify(out);
    expect(dump).not.toContain('СЕКРЕТНАЯ-ВНУТРЕННЯЯ-ЗАМЕТКА');
    expect(dump).not.toContain('ЕЩЁ-ОДНА-ВНУТРЕННЯЯ');
  });
});

describe('ExternalGuestController.sendMessage', () => {
  it('пишет Message(access=external) от guest userId', async () => {
    const { controller, appendTicketMessage, assertInboundRateLimit } = build();
    const request = {
      externalGuest: { userId: 'guest-1', conversationId: 'conv-1', accessLinkId: 'link-1' },
    } as unknown as ExternalGuestRequest;

    const out = await controller.sendMessage(
      'conv-1',
      { content: 'привет', clientMessageId: 'cm-1' },
      request,
    );

    expect(out).toEqual({ messageId: 'm-new', seq: '7' });
    expect(assertInboundRateLimit).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userId: 'guest-1',
    });
    const arg = appendTicketMessage.mock.calls[0]![0];
    expect(arg.access).toBe('external');
    expect(arg.authorUserId).toBe('guest-1');
    expect(arg.authorType).toBe('human');
  });

  it('rate-limit превышен → 429/Forbidden пробрасывается', async () => {
    const { controller, appendTicketMessage } = build();
    (controller as unknown as { external: { assertInboundRateLimit: ReturnType<typeof vi.fn> } })
      .external.assertInboundRateLimit = vi.fn().mockRejectedValue(
      new ForbiddenException({
        ok: false,
        error: { code: 'EXTERNAL_RATE_LIMITED', message: 'Слишком много сообщений' },
      }),
    );
    const request = {
      externalGuest: { userId: 'guest-1', conversationId: 'conv-1', accessLinkId: 'link-1' },
    } as unknown as ExternalGuestRequest;

    await expect(
      controller.sendMessage('conv-1', { content: 'x', clientMessageId: 'cm-2' }, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(appendTicketMessage).not.toHaveBeenCalled();
  });
});

describe('ExternalGuestController register flow', () => {
  it('request-code → verifyToken + requestRegisterCode + {ok}', async () => {
    const { controller, requestRegisterCode } = build();
    const out = await controller.requestRegisterCode({
      token: 'a'.repeat(32),
      email: 'c@example.com',
    });
    expect(out).toEqual({ ok: true });
    expect(requestRegisterCode).toHaveBeenCalledWith({
      accessLinkId: 'link-1',
      email: 'c@example.com',
      phone: null,
    });
  });

  it('register → verify + register + {ok, verified}', async () => {
    const { controller, register } = build();
    const out = await controller.register({
      token: 'a'.repeat(32),
      email: 'c@example.com',
      code: '123456',
    });
    expect(out).toEqual({ ok: true, verified: true });
    expect(register).toHaveBeenCalledWith({
      accessLinkId: 'link-1',
      userId: 'guest-1',
      email: 'c@example.com',
      phone: null,
      code: '123456',
    });
  });

  it('register без claimedByUserId → 503 EXTERNAL_NOT_CLAIMED', async () => {
    const verifyToken = vi.fn().mockResolvedValue({
      accessLink: { id: 'link-1', claimedByUserId: null },
      conversationId: 'conv-1',
    });
    const { controller, register } = build({ verifyToken });
    await expect(
      controller.register({ token: 'a'.repeat(32), email: 'c@example.com', code: '123456' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(register).not.toHaveBeenCalled();
  });
});

describe('ExternalGuestController.report', () => {
  it('пишет report-сигнал', async () => {
    const { controller, reportConversation } = build();
    const request = {
      externalGuest: { userId: 'guest-1', conversationId: 'conv-1', accessLinkId: 'link-1' },
    } as unknown as ExternalGuestRequest;
    const out = await controller.report('conv-1', request);
    expect(out).toEqual({ ok: true });
    expect(reportConversation).toHaveBeenCalledWith({ conversationId: 'conv-1', userId: 'guest-1' });
  });
});
