import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LivekitService } from '../../livekit/livekit.service';

import type { ConversationService } from './conversation.service';
import { HuddleService } from './huddle.service';
import type { MessageService } from './message.service';

function makeService(overrides: {
  enabled?: boolean;
  isMember?: boolean;
  maxParticipants?: number;
  presentCount?: number;
} = {}) {
  const meetingCreate = vi.fn().mockResolvedValue({ id: 'mtg-1', endedAt: null });
  const meetingFindFirst = vi
    .fn()
    .mockResolvedValue({ id: 'mtg-1', endedAt: null, ownerId: 'owner-1' });
  const userFindUnique = vi.fn().mockResolvedValue({ name: 'Иван' });
  const conversationFindUnique = vi.fn().mockResolvedValue({ title: 'Проект X' });
  const participantCount = vi.fn().mockResolvedValue(overrides.presentCount ?? 0);

  const prisma = {
    meeting: { create: meetingCreate, findFirst: meetingFindFirst },
    user: { findUnique: userFindUnique },
    conversation: { findUnique: conversationFindUnique },
    participant: { count: participantCount },
  } as unknown as PrismaService;

  const cfg = {
    huddles: { enabled: overrides.enabled ?? true },
    auth: { publicFrontendUrl: 'https://app.kora.ru/' },
    getDynamic: vi.fn().mockResolvedValue(overrides.maxParticipants ?? 10),
  } as unknown as TypedConfigService;

  const ensureRoom = vi.fn().mockResolvedValue(null);
  const generateHostToken = vi.fn().mockResolvedValue('host-token');
  const generateGuestToken = vi.fn().mockResolvedValue('guest-token');
  const livekit = {
    ensureRoom,
    generateHostToken,
    generateGuestToken,
  } as unknown as LivekitService;

  const assertMember = vi.fn().mockResolvedValue(overrides.isMember ?? true);
  const conversations = { assertMember } as unknown as ConversationService;

  const appendSystemMessage = vi
    .fn()
    .mockResolvedValue({ messageId: 'sys-1', seq: '1', deduped: false });
  const messages = { appendSystemMessage } as unknown as MessageService;

  const svc = new HuddleService(prisma, cfg, livekit, conversations, messages);

  return {
    svc,
    meetingCreate,
    meetingFindFirst,
    ensureRoom,
    generateHostToken,
    generateGuestToken,
    appendSystemMessage,
    participantCount,
  };
}

describe('HuddleService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('startHuddle', () => {
    it('не-член → 403', async () => {
      const { svc, meetingCreate } = makeService({ isMember: false });
      await expect(
        svc.startHuddle({ tenantId: 'org-1', conversationId: 'conv-1', userId: 'u-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(meetingCreate).not.toHaveBeenCalled();
    });

    it('создаёт Meeting(huddleConversationId) + ensureRoom + host-токен + системное сообщение', async () => {
      const { svc, meetingCreate, ensureRoom, generateHostToken, appendSystemMessage } =
        makeService({ isMember: true });

      const res = await svc.startHuddle({
        tenantId: 'org-1',
        conversationId: 'conv-1',
        userId: 'owner-1',
      });

      expect(res.meetingId).toBe('mtg-1');
      expect(res.roomToken).toBe('host-token');
      expect(res.joinUrl).toBe('https://app.kora.ru/m/mtg-1');

      const createArg = meetingCreate.mock.calls[0]![0];
      expect(createArg.data.huddleConversationId).toBe('conv-1');
      expect(createArg.data.ownerId).toBe('owner-1');
      expect(createArg.data.tenantId).toBe('org-1');

      expect(ensureRoom).toHaveBeenCalledWith({ id: 'mtg-1' });
      expect(generateHostToken).toHaveBeenCalledTimes(1);

      expect(appendSystemMessage).toHaveBeenCalledTimes(1);
      const msgArg = appendSystemMessage.mock.calls[0]![0];
      expect(msgArg.content).toContain('Начат созвон');
      expect(msgArg.content).toContain('https://app.kora.ru/m/mtg-1');
      expect(msgArg.clientMessageId).toBe('huddle-started:mtg-1');
    });
  });

  describe('joinHuddle', () => {
    it('член, не владелец → guest-токен с identity member:<id>', async () => {
      const { svc, generateGuestToken } = makeService({ isMember: true });
      const res = await svc.joinHuddle({
        tenantId: 'org-1',
        conversationId: 'conv-1',
        userId: 'u-2',
      });
      expect(res.roomToken).toBe('guest-token');
      expect(generateGuestToken).toHaveBeenCalledTimes(1);
      expect(generateGuestToken.mock.calls[0]![1]).toBe('member:u-2');
    });

    it('достигнут лимит участников → 403', async () => {
      const { svc } = makeService({ isMember: true, maxParticipants: 2, presentCount: 2 });
      await expect(
        svc.joinHuddle({ tenantId: 'org-1', conversationId: 'conv-1', userId: 'u-2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
