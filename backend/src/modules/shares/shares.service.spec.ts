import {
  BadRequestException,
  GoneException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';
import type { S3Service } from '../recordings/s3.service';

import type { SharesRepository } from './shares.repository';
import { SharesService } from './shares.service';

describe('SharesService', () => {
  let prisma: {
    meeting: { findUnique: ReturnType<typeof vi.fn> };
    meetingHighlight: { findUnique: ReturnType<typeof vi.fn> };
  };
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    findByToken: ReturnType<typeof vi.fn>;
    listByMeeting: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
    incrementView: ReturnType<typeof vi.fn>;
    countDistinctViewToday: ReturnType<typeof vi.fn>;
    findHighlightShareById: ReturnType<typeof vi.fn>;
    findHighlightShareByToken: ReturnType<typeof vi.fn>;
    listByHighlight: ReturnType<typeof vi.fn>;
    createHighlightShare: ReturnType<typeof vi.fn>;
    revokeHighlightShare: ReturnType<typeof vi.fn>;
    incrementHighlightShareView: ReturnType<typeof vi.fn>;
  };
  let cfg: TypedConfigService;
  let s3: { presignGet: ReturnType<typeof vi.fn> };
  let audit: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = {
      meeting: { findUnique: vi.fn() },
      meetingHighlight: { findUnique: vi.fn() },
    };
    repo = {
      findById: vi.fn(),
      findByToken: vi.fn(),
      listByMeeting: vi.fn(async () => []),
      create: vi.fn(async (data: { token: string; expiresAt: Date }) => ({
        id: 's1',
        token: data.token,
        meetingId: 'm1',
        createdById: 'u1',
        allowVideo: true,
        allowTranscript: false,
        allowTasks: true,
        allowChapters: true,
        expiresAt: data.expiresAt,
        revokedAt: null,
        viewCount: 0,
        lastViewedAt: null,
        createdAt: new Date(),
      })),
      revoke: vi.fn(async () => ({ id: 's1' })),
      incrementView: vi.fn(async () => ({ id: 'v1' })),
      countDistinctViewToday: vi.fn(async () => 0),
      findHighlightShareById: vi.fn(),
      findHighlightShareByToken: vi.fn(),
      listByHighlight: vi.fn(async () => []),
      createHighlightShare: vi.fn(async () => ({ id: 'hs1' })),
      revokeHighlightShare: vi.fn(async () => ({ id: 'hs1' })),
      incrementHighlightShareView: vi.fn(async () => ({ id: 'hs1' })),
    };
    cfg = {
      hashing: { ipDailySalt: 'salty-test-salt-32characters!!!!' },
      share: { tokenLengthBytes: 24, allowedExpirationDays: [1, 7, 14] },
      s3: { bucket: 'bk' },
    } as unknown as TypedConfigService;
    s3 = {
      presignGet: vi.fn(async () => ({
        url: 'https://s3/x',
        expiresAt: new Date('2030-01-01'),
      })),
    };
    audit = { log: vi.fn(async () => undefined) };
  });

  function make(): SharesService {
    return new SharesService(
      prisma as unknown as PrismaService,
      repo as unknown as SharesRepository,
      cfg,
      s3 as unknown as S3Service,
      audit as unknown as AuditLogService,
    );
  }

  // ─────────────────────────── createMeetingShare ──────────────────────

  describe('createMeetingShare', () => {
    it('успех: owner совпадает, expiration валидно', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: null,
      });
      const svc = make();
      const r = await svc.createMeetingShare('m1', 'u1', {
        allowVideo: true,
        allowTranscript: false,
        allowTasks: true,
        allowChapters: true,
        allowChat: false,
        expirationDays: 7,
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          meetingId: 'm1',
          createdById: 'u1',
          allowVideo: true,
          allowChapters: true,
        }),
      );
      expect(r.id).toBe('s1');
    });

    it('expirationDays не из allowed → 400', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'u1',
        deletedAt: null,
      });
      const svc = make();
      await expect(
        svc.createMeetingShare('m1', 'u1', {
          allowVideo: false,
          allowTranscript: false,
          allowTasks: true,
          allowChapters: true,
          allowChat: false,
          expirationDays: 30,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('встреча чужая → NotFoundException', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ownerId: 'other',
        deletedAt: null,
      });
      const svc = make();
      await expect(
        svc.createMeetingShare('m1', 'u1', {
          allowVideo: false,
          allowTranscript: false,
          allowTasks: true,
          allowChapters: true,
          allowChat: false,
          expirationDays: 7,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─────────────────────────── public meeting share ──────────────────────

  describe('getPublicMeetingShare', () => {
    function buildShare(over: Partial<{ revokedAt: Date | null; expiresAt: Date }> = {}) {
      return {
        id: 's1',
        token: 'tok',
        meetingId: 'm1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        allowVideo: false,
        allowTranscript: false,
        allowTasks: true,
        allowChapters: true,
        ...over,
      };
    }

    it('токен не существует → 404', async () => {
      repo.findByToken.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.getPublicMeetingShare('xxx', { ip: '1', userAgent: null, referrer: null }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revoked → 410', async () => {
      repo.findByToken.mockResolvedValue(buildShare({ revokedAt: new Date() }));
      const svc = make();
      await expect(
        svc.getPublicMeetingShare('tok', { ip: '1', userAgent: null, referrer: null }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('expired → 410', async () => {
      repo.findByToken.mockResolvedValue(
        buildShare({ expiresAt: new Date(Date.now() - 1000) }),
      );
      const svc = make();
      await expect(
        svc.getPublicMeetingShare('tok', { ip: '1', userAgent: null, referrer: null }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('happy path: возвращает только разрешённые блоки', async () => {
      repo.findByToken.mockResolvedValue(buildShare());
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        title: 'Demo',
        type: 'team',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        endedAt: new Date('2026-01-01T11:00:00Z'),
        durationMs: 3_600_000,
        deletedAt: null,
        chapters: [
          {
            id: 'c1',
            startMs: 0,
            endMs: 100,
            title: 'Intro',
            summary: null,
            order: 0,
          },
        ],
        tasks: [
          {
            id: 't1',
            title: 'Task',
            description: null,
            status: 'open',
            assigneeRaw: null,
            dueDate: null,
          },
        ],
        // Р6: select тянет summaryFast/summary; legacy-only встреча (fast ещё
        // не сгенерирован) → pickPrimarySummary падает на summary.
        aiResult: { summaryFast: null, summary: 'Краткое резюме' },
        transcript: null,
        recording: null,
      });

      const svc = make();
      const result = await svc.getPublicMeetingShare('tok', {
        ip: '127.0.0.1',
        userAgent: 'agent',
        referrer: null,
      });
      expect(result.summary).toBe('Краткое резюме');
      expect(result.chapters).toHaveLength(1);
      expect(result.tasks).toHaveLength(1);
      // allowVideo=false и allowTranscript=false → видео/транскрипта нет
      expect(result.videoUrl).toBeUndefined();
      expect(result.transcript).toBeUndefined();
      // просмотр зарегистрирован
      expect(repo.incrementView).toHaveBeenCalled();
    });

    it('Р6: summaryFast приоритетнее legacy summary в публичной шаре', async () => {
      repo.findByToken.mockResolvedValue(buildShare());
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        title: 'Demo',
        type: 'team',
        startedAt: new Date('2026-01-01T10:00:00Z'),
        endedAt: new Date('2026-01-01T11:00:00Z'),
        durationMs: 3_600_000,
        deletedAt: null,
        chapters: [],
        tasks: [],
        aiResult: {
          summaryFast: 'Быстрая сводка',
          summary: 'Legacy сводка',
        },
        transcript: null,
        recording: null,
      });

      const svc = make();
      const result = await svc.getPublicMeetingShare('tok', {
        ip: '127.0.0.1',
        userAgent: 'agent',
        referrer: null,
      });
      expect(result.summary).toBe('Быстрая сводка');
    });
  });

  // ─────────────────────────── getPublicHighlightShare ───────────────────

  describe('getPublicHighlightShare', () => {
    function buildShare(over: Partial<{ revokedAt: Date | null; expiresAt: Date }> = {}) {
      return {
        id: 'hs1',
        token: 'tok2',
        highlightId: 'h1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        highlight: {
          id: 'h1',
          title: 'Clip',
          description: 'd',
          renderStatus: 'ready',
          renderedMp4Key: 'clips/h1.mp4',
        },
        ...over,
      };
    }

    it('токена нет → 404', async () => {
      repo.findHighlightShareByToken.mockResolvedValue(null);
      const svc = make();
      await expect(svc.getPublicHighlightShare('xx')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('revoked → 410', async () => {
      repo.findHighlightShareByToken.mockResolvedValue(
        buildShare({ revokedAt: new Date() }),
      );
      const svc = make();
      await expect(svc.getPublicHighlightShare('tok2')).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('expired → 410', async () => {
      repo.findHighlightShareByToken.mockResolvedValue(
        buildShare({ expiresAt: new Date(Date.now() - 100) }),
      );
      const svc = make();
      await expect(svc.getPublicHighlightShare('tok2')).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('renderStatus≠ready → 409 clip_not_ready', async () => {
      const sh = buildShare();
      sh.highlight.renderStatus = 'queued';
      sh.highlight.renderedMp4Key = null as unknown as string;
      repo.findHighlightShareByToken.mockResolvedValue(sh);
      const svc = make();
      await expect(svc.getPublicHighlightShare('tok2')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('happy path: возвращает presigned URL', async () => {
      repo.findHighlightShareByToken.mockResolvedValue(buildShare());
      const svc = make();
      const r = await svc.getPublicHighlightShare('tok2');
      expect(r.title).toBe('Clip');
      expect(r.presignedMp4Url).toBe('https://s3/x');
      expect(repo.incrementHighlightShareView).toHaveBeenCalledWith('hs1');
    });
  });
});
