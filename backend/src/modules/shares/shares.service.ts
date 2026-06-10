import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { HighlightShare, MeetingShare } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { pickPrimarySummary } from '../ai/utils/pick-primary-summary';
import { AuditLogService } from '../audit/audit-log.service';
import { extractKeyFromUrl } from '../recordings/s3-keys';
import { S3Service } from '../recordings/s3.service';

import type {
  CreateHighlightShareDto,
  CreateMeetingShareDto,
} from './dto/create-share.dto';
import { SharesRepository } from './shares.repository';

/**
 * Bundle public share-bundle для `/api/v1/public/share/:token`.
 * `videoUrl` — presigned (`S3Service.presignGet`) на mainVideoUrl, если
 * `allowVideo` и запись `ready`.
 */
export interface PublicMeetingSharePayload {
  meeting: {
    id: string;
    title: string;
    type: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
  };
  permissions: {
    allowVideo: boolean;
    allowTranscript: boolean;
    allowTasks: boolean;
    allowChapters: boolean;
    allowChat: boolean;
  };
  summary?: string;
  messages?: Array<{
    id: string;
    authorName: string;
    content: string;
    sentAt: string;
  }>;
  chapters?: Array<{
    id: string;
    startMs: number;
    endMs: number;
    title: string;
    summary: string | null;
    order: number;
  }>;
  tasks?: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    assigneeRaw: string | null;
    dueDate: string | null;
  }>;
  transcript?: {
    turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
    roomChat?: Array<{ sentAt: string; authorName: string; content: string }>;
    durationSeconds: number | null;
  };
  videoUrl?: {
    url: string;
    expiresAt: string;
  };
  expiresAt: string;
}

/**
 * Сервис публичных и приватных share-операций.
 *
 * Безопасность:
 *   - Токен — `randomBytes(cfg.share.tokenLengthBytes).toString('base64url')`,
 *     уникальный (UNIQUE constraint в БД).
 *   - При публичном просмотре считаем уникальные просмотры по `ipHash` за день
 *     (если уже видели сегодня — `viewCount` не инкрементим).
 *   - `ipHash = sha256(ip + cfg.hashing.ipDailySalt + dateString)`. Соль — daily,
 *     поэтому через день/после смены соли невозможно сопоставить тот же IP.
 */
@Injectable()
export class SharesService {
  private readonly logger = new Logger(SharesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SharesRepository) private readonly repo: SharesRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  // ─────────────────────────── meeting share ────────────────────────────

  async listByMeeting(meetingId: string, userId: string): Promise<MeetingShare[]> {
    await this.assertMeetingOwner(meetingId, userId);
    return this.repo.listByMeeting(meetingId);
  }

  async createMeetingShare(
    meetingId: string,
    userId: string,
    dto: CreateMeetingShareDto,
  ): Promise<MeetingShare> {
    await this.assertMeetingOwner(meetingId, userId);
    this.assertExpirationAllowed(dto.expirationDays);

    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + dto.expirationDays * 86_400_000);
    const share = await this.repo.create({
      token,
      meetingId,
      createdById: userId,
      allowVideo: dto.allowVideo,
      allowTranscript: dto.allowTranscript,
      allowTasks: dto.allowTasks,
      allowChapters: dto.allowChapters,
      allowChat: dto.allowChat,
      expiresAt,
    });
    await this.audit
      .log({
        action: 'share.create',
        userId,
        resourceId: share.id,
        metadata: {
          meetingId,
          expirationDays: dto.expirationDays,
          allowVideo: dto.allowVideo,
          allowTranscript: dto.allowTranscript,
          allowTasks: dto.allowTasks,
          allowChapters: dto.allowChapters,
          allowChat: dto.allowChat,
        },
      })
      .catch(() => undefined);
    return share;
  }

  async revokeMeetingShare(id: string, userId: string): Promise<void> {
    const share = await this.repo.findById(id);
    if (!share) throw new NotFoundException('share_not_found');
    await this.assertMeetingOwner(share.meetingId, userId);
    await this.repo.revoke(id);
    await this.audit
      .log({ action: 'share.revoke', userId, resourceId: id })
      .catch(() => undefined);
  }

  // ─────────────────────────── highlight share ──────────────────────────

  async listByHighlight(highlightId: string, userId: string): Promise<HighlightShare[]> {
    await this.assertHighlightOwner(highlightId, userId);
    return this.repo.listByHighlight(highlightId);
  }

  async createHighlightShare(
    highlightId: string,
    userId: string,
    dto: CreateHighlightShareDto,
  ): Promise<HighlightShare> {
    await this.assertHighlightOwner(highlightId, userId);
    this.assertExpirationAllowed(dto.expirationDays);

    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + dto.expirationDays * 86_400_000);
    const share = await this.repo.createHighlightShare({
      token,
      highlightId,
      createdById: userId,
      expiresAt,
    });
    await this.audit
      .log({
        action: 'share.create_clip',
        userId,
        resourceId: share.id,
        metadata: { highlightId, expirationDays: dto.expirationDays },
      })
      .catch(() => undefined);
    return share;
  }

  async revokeHighlightShare(id: string, userId: string): Promise<void> {
    const share = await this.repo.findHighlightShareById(id);
    if (!share) throw new NotFoundException('share_not_found');
    await this.assertHighlightOwner(share.highlightId, userId);
    await this.repo.revokeHighlightShare(id);
    await this.audit
      .log({ action: 'share.revoke_clip', userId, resourceId: id })
      .catch(() => undefined);
  }

  // ─────────────────────────── public ───────────────────────────────────

  /**
   * GET /api/v1/public/share/:token
   *
   * Проверки в строгом порядке:
   *   1. token найден      — иначе 404.
   *   2. revokedAt is null — иначе 410.
   *   3. expiresAt > now   — иначе 410.
   * Затем — записываем просмотр (один уникальный inc на ipHash в сутки).
   */
  async getPublicMeetingShare(
    token: string,
    visitor: { ip: string | null; userAgent: string | null; referrer: string | null },
  ): Promise<PublicMeetingSharePayload> {
    const share = await this.repo.findByToken(token);
    if (!share) throw new NotFoundException('share_not_found');
    if (share.revokedAt !== null) {
      throw new GoneException({
        ok: false,
        error: { code: 'share_revoked', message: 'Доступ к ссылке отозван' },
      });
    }
    if (share.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({
        ok: false,
        error: { code: 'share_expired', message: 'Срок действия ссылки истёк' },
      });
    }

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: share.meetingId },
      include: {
        chapters: { orderBy: { order: 'asc' } },
        tasks: true,
        aiResult: {
          select: { summaryFast: true, summary: true },
        },
        transcript: { select: { turns: true, roomChat: true, totalDurationSeconds: true } },
        recording: { select: { mainVideoUrl: true, status: true } },
      },
    });
    if (!meeting || meeting.deletedAt !== null) {
      throw new NotFoundException('share_not_found');
    }

    const payload: PublicMeetingSharePayload = {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        type: meeting.type,
        startedAt: meeting.startedAt?.toISOString() ?? null,
        endedAt: meeting.endedAt?.toISOString() ?? null,
        durationMs: meeting.durationMs,
      },
      permissions: {
        allowVideo: share.allowVideo,
        allowTranscript: share.allowTranscript,
        allowTasks: share.allowTasks,
        allowChapters: share.allowChapters,
        allowChat: share.allowChat,
      },
      expiresAt: share.expiresAt.toISOString(),
    };

    if (share.allowChat) {
      const rows = await this.repo.listRoomMessages(meeting.id);
      payload.messages = rows.map((m) => ({
        id: m.id,
        authorName: m.authorName,
        content: m.content,
        sentAt: m.sentAt.toISOString(),
      }));
    }

    const summary = meeting.aiResult ? pickPrimarySummary(meeting.aiResult) : '';
    if (summary) {
      payload.summary = summary;
    }

    if (share.allowChapters) {
      payload.chapters = meeting.chapters.map((c) => ({
        id: c.id,
        startMs: c.startMs,
        endMs: c.endMs,
        title: c.title,
        summary: c.summary,
        order: c.order,
      }));
    }

    if (share.allowTasks) {
      payload.tasks = meeting.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        assigneeRaw: t.assigneeRaw,
        dueDate: t.dueDate?.toISOString() ?? null,
      }));
    }

    if (share.allowTranscript && meeting.transcript?.turns) {
      const turns = meeting.transcript.turns as Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
      const roomChat = (meeting.transcript.roomChat as Array<{ sentAt: string; authorName: string; content: string }> | null) ?? undefined;
      payload.transcript = {
        turns,
        ...(roomChat && roomChat.length > 0 ? { roomChat } : {}),
        durationSeconds: meeting.transcript.totalDurationSeconds ?? null,
      };
    }

    if (
      share.allowVideo &&
      meeting.recording?.status === 'ready' &&
      meeting.recording.mainVideoUrl
    ) {
      try {
        const key = extractKeyFromUrl(
          meeting.recording.mainVideoUrl,
          this.cfg.s3.bucket,
        );
        const presigned = await this.s3.presignGet(key);
        payload.videoUrl = {
          url: presigned.url,
          expiresAt: presigned.expiresAt.toISOString(),
        };
      } catch (err) {
        this.logger.warn(
          `getPublicMeetingShare: cannot presign video: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Учёт просмотра — fire-and-forget по сути, но нам нужны await'ы для
    // корректности тестов. Если упадёт — не валим основной flow.
    await this.recordView(share.id, visitor).catch((err) => {
      this.logger.warn(
        `recordView failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return payload;
  }

  /**
   * GET /api/v1/public/share/clip/:token
   * Аналогичные проверки + наличие готового MP4 (`renderStatus=ready`).
   */
  async getPublicHighlightShare(
    token: string,
  ): Promise<{
    title: string;
    description: string | null;
    presignedMp4Url: string;
    expiresAt: string;
  }> {
    const share = await this.repo.findHighlightShareByToken(token);
    if (!share) throw new NotFoundException('share_not_found');
    if (share.revokedAt !== null) {
      throw new GoneException({
        ok: false,
        error: { code: 'share_revoked', message: 'Доступ к ссылке отозван' },
      });
    }
    if (share.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({
        ok: false,
        error: { code: 'share_expired', message: 'Срок действия ссылки истёк' },
      });
    }
    if (share.highlight.renderStatus !== 'ready' || !share.highlight.renderedMp4Key) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'clip_not_ready', message: 'Клип ещё не отрендерен' },
        },
        HttpStatus.CONFLICT,
      );
    }

    const presigned = await this.s3.presignGet(share.highlight.renderedMp4Key);
    await this.repo.incrementHighlightShareView(share.id).catch(() => undefined);
    return {
      title: share.highlight.title,
      description: share.highlight.description,
      presignedMp4Url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private async recordView(
    shareId: string,
    visitor: { ip: string | null; userAgent: string | null; referrer: string | null },
  ): Promise<void> {
    const ipHash = this.hashIp(visitor.ip ?? '');
    // Уникальный просмотр в сутки на пару (shareId, ipHash).
    const now = Date.now();
    const dayStart = new Date(now - (now % 86_400_000));
    const seenToday = await this.repo.countDistinctViewToday(shareId, ipHash, dayStart);
    const countView = seenToday === 0;
    await this.repo.incrementView(
      shareId,
      {
        ipHash,
        userAgent: visitor.userAgent,
        referrer: visitor.referrer,
      },
      countView,
    );
  }

  private hashIp(ip: string): string {
    const dateString = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    const salt = this.cfg.hashing.ipDailySalt;
    return createHash('sha256').update(`${ip}|${salt}|${dateString}`).digest('hex');
  }

  private generateToken(): string {
    return randomBytes(this.cfg.share.tokenLengthBytes).toString('base64url');
  }

  private assertExpirationAllowed(days: number): void {
    const allowed = this.cfg.share.allowedExpirationDays;
    if (!allowed.includes(days)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'expiration_not_allowed',
          message: `Допустимые значения expirationDays: ${allowed.join(', ')}`,
        },
      });
    }
  }

  private async assertMeetingOwner(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, deletedAt: true },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== userId) {
      throw new NotFoundException('meeting_not_found');
    }
  }

  private async assertHighlightOwner(highlightId: string, userId: string): Promise<void> {
    const highlight = await this.prisma.meetingHighlight.findUnique({
      where: { id: highlightId },
      select: { meetingId: true },
    });
    if (!highlight) {
      throw new NotFoundException('highlight_not_found');
    }
    await this.assertMeetingOwner(highlight.meetingId, userId);
  }
}
