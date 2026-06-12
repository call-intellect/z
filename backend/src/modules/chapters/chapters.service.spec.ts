import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';

import type { ChaptersRepository } from './chapters.repository';
import { ChaptersService } from './chapters.service';

describe('ChaptersService', () => {
  let prisma: {
    meeting: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    listByMeeting: ReturnType<typeof vi.fn>;
    countByMeeting: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let coreQueue: { enqueueMeetingReportFast: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      meeting: {
        findUnique: vi.fn(),
        update: vi.fn(async () => ({})),
      },
    };
    repo = {
      findById: vi.fn(),
      listByMeeting: vi.fn(async () => []),
      countByMeeting: vi.fn(async () => 0),
      create: vi.fn(async () => ({ id: 'c1' })),
      update: vi.fn(async () => ({ id: 'c1' })),
      delete: vi.fn(async () => ({ id: 'c1' })),
    };
    coreQueue = { enqueueMeetingReportFast: vi.fn(async () => undefined) };
  });

  function make(): ChaptersService {
    return new ChaptersService(
      prisma as unknown as PrismaService,
      repo as unknown as ChaptersRepository,
      coreQueue as unknown as CoreQueueService,
    );
  }

  describe('create', () => {
    it('owner совпадает → создаёт с next order', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: null,
      });
      repo.countByMeeting.mockResolvedValue(2);
      const svc = make();
      await svc.create('m1', 'u1', { startMs: 0, endMs: 1000, title: 'T' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ meetingId: 'm1', order: 2 }),
      );
    });

    it('встреча чужая → NotFoundException', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'other',
        deletedAt: null,
      });
      const svc = make();
      await expect(
        svc.create('m1', 'u1', { startMs: 0, endMs: 100, title: 'T' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('regenerate (idempotency)', () => {
    it('reportFastStatus=processing → 409', async () => {
      prisma.meeting.findUnique
        .mockResolvedValueOnce({ ownerId: 'u1', deletedAt: null })
        .mockResolvedValueOnce({ reportFastStatus: 'processing' });
      const svc = make();
      await expect(svc.regenerate('m1', 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(coreQueue.enqueueMeetingReportFast).not.toHaveBeenCalled();
    });

    it('reportFastStatus=ready → перезапускает meeting-report-fast', async () => {
      prisma.meeting.findUnique
        .mockResolvedValueOnce({ ownerId: 'u1', deletedAt: null })
        .mockResolvedValueOnce({ reportFastStatus: 'ready' });
      const svc = make();
      const r = await svc.regenerate('m1', 'u1');
      expect(coreQueue.enqueueMeetingReportFast).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ reason: expect.stringMatching(/^regen-\d+$/) }),
      );
      expect(r).toEqual({ status: 'queued' });
    });
  });

  describe('update', () => {
    it('главы нет → NotFoundException', async () => {
      repo.findById.mockResolvedValue(null);
      const svc = make();
      await expect(svc.update('c1', 'u1', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('встреча главы чужая → NotFoundException', async () => {
      repo.findById.mockResolvedValue({ id: 'c1', meetingId: 'm1' });
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'other',
        deletedAt: null,
      });
      const svc = make();
      await expect(svc.update('c1', 'u1', { title: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
