import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';

import type { TagsRepository } from './tags.repository';
import { TagsService } from './tags.service';

describe('TagsService', () => {
  let prisma: { meeting: { findUnique: ReturnType<typeof vi.fn> } };
  let repo: {
    listByUser: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    countByUser: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    setMeetingTags: ReturnType<typeof vi.fn>;
    listMeetingTags: ReturnType<typeof vi.fn>;
    countByIds: ReturnType<typeof vi.fn>;
  };
  let cfg: TypedConfigService;

  beforeEach(() => {
    prisma = { meeting: { findUnique: vi.fn() } };
    repo = {
      listByUser: vi.fn(async () => []),
      findById: vi.fn(),
      countByUser: vi.fn(async () => 0),
      create: vi.fn(async () => ({ id: 'tag1', name: 'x', color: '#888888' })),
      update: vi.fn(async () => ({ id: 'tag1', name: 'y', color: '#888888' })),
      delete: vi.fn(async () => ({ id: 'tag1' })),
      setMeetingTags: vi.fn(async () => undefined),
      listMeetingTags: vi.fn(async () => []),
      countByIds: vi.fn(async () => 0),
    };
    cfg = {
      workspace: { maxTagsPerUser: 50 },
    } as unknown as TypedConfigService;
  });

  function make(): TagsService {
    return new TagsService(
      prisma as unknown as PrismaService,
      repo as unknown as TagsRepository,
      cfg,
    );
  }

  describe('create', () => {
    it('успех — лимит не превышен', async () => {
      const svc = make();
      await svc.create('u1', { name: 'x' });
      expect(repo.create).toHaveBeenCalledWith({ userId: 'u1', name: 'x' });
    });

    it('лимит достигнут → 409', async () => {
      repo.countByUser.mockResolvedValue(50);
      const svc = make();
      await expect(svc.create('u1', { name: 'x' })).rejects.toBeInstanceOf(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('дубликат имени (P2002) → 409 tag_duplicate', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      });
      repo.create.mockRejectedValue(err);
      const svc = make();
      await expect(svc.create('u1', { name: 'dup' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('тег чужой → NotFoundException', async () => {
      repo.findById.mockResolvedValue({ id: 'tag1', userId: 'other' });
      const svc = make();
      await expect(svc.update('tag1', 'u1', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setMeetingTags', () => {
    it('owner совпадает + все теги принадлежат юзеру → ok', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: null,
      });
      repo.countByIds.mockResolvedValue(2);
      const svc = make();
      const r = await svc.setMeetingTags('m1', 'u1', { tagIds: ['a', 'b'] });
      expect(repo.setMeetingTags).toHaveBeenCalledWith('m1', ['a', 'b']);
      expect(r).toEqual({ ok: true, count: 2 });
    });

    it('часть тегов чужие → 400 tag_unknown', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: null,
      });
      repo.countByIds.mockResolvedValue(1);
      const svc = make();
      await expect(svc.setMeetingTags('m1', 'u1', { tagIds: ['a', 'b'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.setMeetingTags).not.toHaveBeenCalled();
    });

    it('пустой список → ok (очищает все)', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: null,
      });
      const svc = make();
      const r = await svc.setMeetingTags('m1', 'u1', { tagIds: [] });
      expect(repo.setMeetingTags).toHaveBeenCalledWith('m1', []);
      expect(r).toEqual({ ok: true, count: 0 });
    });

    it('встреча чужая → NotFoundException', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'other',
        deletedAt: null,
      });
      const svc = make();
      await expect(svc.setMeetingTags('m1', 'u1', { tagIds: [] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
