import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import type { RoomMessagesRepository } from './room-messages.repository';
import { RoomMessagesService } from './room-messages.service';

describe('RoomMessagesService', () => {
  let repo: {
    findByClientMessageId: ReturnType<typeof vi.fn>;
    findMeeting: ReturnType<typeof vi.fn>;
    findParticipant: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let cfg: TypedConfigService;

  const ownerUser: CurrentUserPayload = {
    id: 'owner-1',
    email: 'owner@example.com',
    role: 'user',
  };
  const memberUser: CurrentUserPayload = {
    id: 'member-1',
    email: 'm@example.com',
    role: 'user',
  };
  const guestUser: CurrentUserPayload = {
    id: '',
    email: '',
    role: 'user',
    livekitIdentity: 'guest:abc',
    name: 'Гость Вася',
  };
  const otherUser: CurrentUserPayload = {
    id: 'stranger-1',
    email: 's@example.com',
    role: 'user',
  };

  beforeEach(() => {
    repo = {
      findByClientMessageId: vi.fn().mockResolvedValue(null),
      findMeeting: vi.fn(),
      findParticipant: vi.fn().mockResolvedValue(null),
      create: vi.fn(async (data) => ({
        id: 'msg-1',
        meetingId: data.meetingId,
        participantId: data.participantId,
        authorName: data.authorName,
        authorIdentity: data.authorIdentity,
        content: data.content,
        clientMessageId: data.clientMessageId,
        sentAt: new Date('2026-05-09T10:00:00.000Z'),
      })),
      list: vi.fn().mockResolvedValue([]),
    };
    cfg = {
      workspace: { maxRoomMessageChars: 2000 },
    } as unknown as TypedConfigService;
  });

  function make(): RoomMessagesService {
    return new RoomMessagesService(
      repo as unknown as RoomMessagesRepository,
      cfg,
    );
  }

  // ────────────────────────── send ──────────────────────────

  describe('send — happy path', () => {
    it('owner может отправить и сохранить сообщение', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: null,
      });
      const svc = make();
      const result = await svc.send({
        meetingId: 'm1',
        currentUser: ownerUser,
        clientMessageId: 'cmid-1',
        content: 'привет команда',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 'm1',
          clientMessageId: 'cmid-1',
          content: 'привет команда',
          authorIdentity: `user:${ownerUser.id}`,
        }),
      );
      expect(result.id).toBe('msg-1');
    });

    it('зарегистрированный участник по userId может отправить', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: null,
      });
      repo.findParticipant.mockResolvedValue({
        id: 'p-1',
        meetingId: 'm1',
        userId: memberUser.id,
        livekitIdentity: 'host:member-1',
        name: 'Member One',
      });
      const svc = make();
      await svc.send({
        meetingId: 'm1',
        currentUser: memberUser,
        clientMessageId: 'cmid-2',
        content: 'тут я',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: 'p-1',
          authorName: 'Member One',
          authorIdentity: 'host:member-1',
        }),
      );
    });

    it('гость по livekitIdentity может отправить', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: null,
      });
      repo.findParticipant.mockResolvedValue({
        id: 'p-guest',
        meetingId: 'm1',
        userId: null,
        livekitIdentity: 'guest:abc',
        name: 'Гость Вася',
      });
      const svc = make();
      await svc.send({
        meetingId: 'm1',
        currentUser: guestUser,
        clientMessageId: 'cmid-3',
        content: 'привет от гостя',
      });
      expect(repo.findParticipant).toHaveBeenCalledWith({
        meetingId: 'm1',
        livekitIdentity: 'guest:abc',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: 'p-guest',
          authorName: 'Гость Вася',
          authorIdentity: 'guest:abc',
        }),
      );
    });
  });

  describe('send — idempotency', () => {
    it('повторный POST с тем же clientMessageId возвращает существующее', async () => {
      const existing = {
        id: 'msg-existing',
        meetingId: 'm1',
        participantId: null,
        authorName: 'Кто-то',
        authorIdentity: 'user:owner-1',
        content: 'старое',
        clientMessageId: 'cmid-dup',
        sentAt: new Date(),
      };
      repo.findByClientMessageId.mockResolvedValue(existing);
      const svc = make();
      const r = await svc.send({
        meetingId: 'm1',
        currentUser: ownerUser,
        clientMessageId: 'cmid-dup',
        content: 'новое (игнор)',
      });
      expect(r).toBe(existing);
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.findMeeting).not.toHaveBeenCalled();
    });

    it('тот же clientMessageId на ДРУГОЙ встрече → BadRequest', async () => {
      repo.findByClientMessageId.mockResolvedValue({
        id: 'msg-existing',
        meetingId: 'OTHER',
        participantId: null,
        authorName: 'X',
        authorIdentity: 'user:x',
        content: 'x',
        clientMessageId: 'cmid-collision',
        sentAt: new Date(),
      });
      const svc = make();
      await expect(
        svc.send({
          meetingId: 'm1',
          currentUser: ownerUser,
          clientMessageId: 'cmid-collision',
          content: 'тест',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('send — ownership / 404', () => {
    it('не участник встречи → ForbiddenException', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: null,
      });
      repo.findParticipant.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.send({
          meetingId: 'm1',
          currentUser: otherUser,
          clientMessageId: 'cmid-x',
          content: 'привет',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('встреча soft-deleted → NotFoundException', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: new Date(),
      });
      const svc = make();
      await expect(
        svc.send({
          meetingId: 'm1',
          currentUser: ownerUser,
          clientMessageId: 'cmid-z',
          content: 'тест',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('встречи нет → NotFoundException', async () => {
      repo.findMeeting.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.send({
          meetingId: 'missing',
          currentUser: ownerUser,
          clientMessageId: 'cmid-y',
          content: 'тест',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('send — content limits', () => {
    it('пустой контент после trim → BadRequest', async () => {
      const svc = make();
      await expect(
        svc.send({
          meetingId: 'm1',
          currentUser: ownerUser,
          clientMessageId: 'cmid-empty',
          content: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('контент длиннее лимита → BadRequest', async () => {
      const svc = make();
      await expect(
        svc.send({
          meetingId: 'm1',
          currentUser: ownerUser,
          clientMessageId: 'cmid-long',
          content: 'a'.repeat(2001),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ────────────────────────── list ──────────────────────────

  describe('list', () => {
    it('owner может читать историю', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: null,
      });
      repo.list.mockResolvedValue([{ id: 'msg-1' }]);
      const svc = make();
      const result = await svc.list({
        meetingId: 'm1',
        currentUser: ownerUser,
      });
      expect(result).toHaveLength(1);
      expect(repo.list).toHaveBeenCalledWith('m1', {});
    });

    it('передаёт since в repo', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: null,
      });
      const since = new Date('2026-05-09T00:00:00.000Z');
      const svc = make();
      await svc.list({ meetingId: 'm1', currentUser: ownerUser, since });
      expect(repo.list).toHaveBeenCalledWith('m1', { since });
    });

    it('не участник → ForbiddenException', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: null,
      });
      repo.findParticipant.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.list({ meetingId: 'm1', currentUser: otherUser }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('soft-deleted встреча → NotFound', async () => {
      repo.findMeeting.mockResolvedValue({
        id: 'm1',
        ownerId: ownerUser.id,
        deletedAt: new Date(),
      });
      const svc = make();
      await expect(
        svc.list({ meetingId: 'm1', currentUser: ownerUser }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
