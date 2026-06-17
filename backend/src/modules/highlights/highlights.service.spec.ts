import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AiQueueService } from '../ai/ai-queue.service';
import { QuotaExceededError } from '../quotas/quota.errors';
import type { QuotaService } from '../quotas/quota.service';
import type { S3Service } from '../recordings/s3.service';

import { ClipRenderService } from './clip-render.service';
import type { HighlightsRepository } from './highlights.repository';
import { HighlightsService } from './highlights.service';

describe('HighlightsService', () => {
  let prisma: { meeting: { findUnique: ReturnType<typeof vi.fn> } };
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    listByMeeting: ReturnType<typeof vi.fn>;
    countByMeeting: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateRenderStatus: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let cfg: TypedConfigService;
  let queue: { enqueueClipRender: ReturnType<typeof vi.fn> };
  let s3: { presignGet: ReturnType<typeof vi.fn> };
  let quota: { checkAndIncrement: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = { meeting: { findUnique: vi.fn() } };
    repo = {
      findById: vi.fn(),
      listByMeeting: vi.fn(async () => []),
      countByMeeting: vi.fn(async () => 0),
      create: vi.fn(async () => ({ id: 'h1' })),
      update: vi.fn(async () => ({ id: 'h1' })),
      updateRenderStatus: vi.fn(async () => ({ id: 'h1', renderStatus: 'queued' })),
      delete: vi.fn(async () => ({ id: 'h1' })),
    };
    cfg = {
      workspace: {
        clipMaxDurationSeconds: 300,
        maxHighlightsPerMeeting: 50,
        maxRenderJobsPerHour: 10,
      },
    } as unknown as TypedConfigService;
    queue = { enqueueClipRender: vi.fn(async () => undefined) };
    s3 = {
      presignGet: vi.fn(async () => ({
        url: 'https://s3/file.mp4',
        expiresAt: new Date('2030-01-01'),
      })),
    };
    quota = {
      checkAndIncrement: vi.fn(async () => ({ ok: true as const, current: 1, remaining: 9 })),
    };
  });

  function make(): HighlightsService {
    const clipRender = new ClipRenderService(
      repo as unknown as HighlightsRepository,
      queue as unknown as AiQueueService,
      s3 as unknown as S3Service,
      quota as unknown as QuotaService,
      cfg,
    );
    return new HighlightsService(
      prisma as unknown as PrismaService,
      repo as unknown as HighlightsRepository,
      cfg,
      clipRender,
    );
  }

  describe('create — бизнес-валидации', () => {
    it('успех: длительность ≤ лимита, owner совпадает', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      await svc.create('m1', 'u1', { startMs: 0, endMs: 5000, title: 'X' });
      expect(repo.create).toHaveBeenCalled();
    });

    it('clip > clipMaxDurationSeconds → 400 clip_too_long', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000_000,
        deletedAt: null,
      });
      const svc = make();
      await expect(
        svc.create('m1', 'u1', {
          startMs: 0,
          endMs: 301 * 1000,
          title: 'X',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('endMs > meeting.durationMs → 400 clip_out_of_bounds', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 1000,
        deletedAt: null,
      });
      const svc = make();
      await expect(
        svc.create('m1', 'u1', { startMs: 0, endMs: 5000, title: 'X' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('лимит на встречу превышен → 409 highlights_limit_reached', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      repo.countByMeeting.mockResolvedValue(50);
      const svc = make();
      await expect(
        svc.create('m1', 'u1', { startMs: 0, endMs: 1000, title: 'X' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('встреча чужая → NotFoundException', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'other',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      await expect(
        svc.create('m1', 'u1', { startMs: 0, endMs: 1000, title: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('startRender — идемпотентность', () => {
    it('renderStatus=queued → 409 render_in_progress', async () => {
      repo.findById.mockResolvedValue({
        id: 'h1',
        meetingId: 'm1',
        renderStatus: 'queued',
        renderedMp4Key: null,
      });
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      await expect(svc.startRender('h1', 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(queue.enqueueClipRender).not.toHaveBeenCalled();
    });

    it('renderStatus=processing → 409', async () => {
      repo.findById.mockResolvedValue({
        id: 'h1',
        meetingId: 'm1',
        renderStatus: 'processing',
        renderedMp4Key: null,
      });
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      await expect(svc.startRender('h1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('renderStatus=ready → возвращает presigned URL', async () => {
      repo.findById.mockResolvedValue({
        id: 'h1',
        meetingId: 'm1',
        renderStatus: 'ready',
        renderedMp4Key: 'clips/h1.mp4',
      });
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      const r = await svc.startRender('h1', 'u1');
      expect(r).toMatchObject({ status: 'ready', url: 'https://s3/file.mp4' });
      expect(queue.enqueueClipRender).not.toHaveBeenCalled();
    });

    it('renderStatus=none → quota OK → ставит queued + enqueue', async () => {
      repo.findById.mockResolvedValue({
        id: 'h1',
        meetingId: 'm1',
        renderStatus: 'none',
        renderedMp4Key: null,
      });
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      const r = await svc.startRender('h1', 'u1');
      expect(repo.updateRenderStatus).toHaveBeenCalledWith('h1', 'queued', {
        renderError: null,
      });
      expect(queue.enqueueClipRender).toHaveBeenCalledWith('h1');
      expect(r).toEqual({ status: 'queued', renderStatus: 'queued' });
    });

    it('quota исчерпан → 429', async () => {
      repo.findById.mockResolvedValue({
        id: 'h1',
        meetingId: 'm1',
        renderStatus: 'none',
        renderedMp4Key: null,
      });
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      quota.checkAndIncrement.mockRejectedValue(
        new QuotaExceededError('render_jobs_per_hour', 60, 10),
      );
      const svc = make();
      await expect(svc.startRender('h1', 'u1')).rejects.toBeInstanceOf(HttpException);
      expect(queue.enqueueClipRender).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    it('renderStatus=ready → presigned', async () => {
      repo.findById.mockResolvedValue({
        id: 'h1',
        meetingId: 'm1',
        renderStatus: 'ready',
        renderedMp4Key: 'clips/h1.mp4',
      });
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      const r = await svc.getDownloadUrl('h1', 'u1');
      expect(r.url).toBe('https://s3/file.mp4');
    });

    it('renderStatus=none → 404', async () => {
      repo.findById.mockResolvedValue({
        id: 'h1',
        meetingId: 'm1',
        renderStatus: 'none',
        renderedMp4Key: null,
      });
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        ownerId: 'u1',
        durationMs: 10_000,
        deletedAt: null,
      });
      const svc = make();
      await expect(svc.getDownloadUrl('h1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
