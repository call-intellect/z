import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';
import { AiQueueService } from '../ai-queue.service';

/**
 * HTTP-side сервис для фазы D (sub-TZ D §8).
 *
 *   - `getTranscript` — отдаёт presigned URL либо для оригинала (`merged.json`),
 *     либо для cleaned (`cleaned.json`) — по параметру `cleaned=true|false`.
 *   - `requestClean` — ставит job `ai.transcript-clean`. Rate-limit на endpoint
 *     уровне (Throttle), здесь — guard по статусу: ready/pending/not_started/failed.
 *   - `updateOrgSetting` — переключает `Org.transcriptCleaningAuto`.
 *
 * Auth-guard'ы (`CookieAuthGuard`, RBAC owner/admin) — на контроллере.
 * Здесь только бизнес-проверки.
 */
@Injectable()
export class TranscriptCleaningService {
  private readonly logger = new Logger(TranscriptCleaningService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Presigned URL на merged-json транскрипта (cleaned=false / default) или
   * cleaned-json (cleaned=true). Только для хоста встречи (Meeting.ownerId).
   *
   * Если `cleaned=true` и `cleaningStatus !== 'ready'` — `404` (NotFound) с
   * полем `reason: 'pending'|'not_started'|'failed'`. Это даёт UI'ю явный
   * сигнал, что нужно либо ждать, либо нажать «Очистить».
   */
  async getTranscript(args: {
    meetingId: string;
    userId: string;
    cleaned: boolean;
  }): Promise<{
    url: string;
    expiresAt: string;
    durationSeconds: number | null;
    cleaned: boolean;
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: args.meetingId },
      include: { transcript: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.ownerId !== args.userId) {
      throw new ForbiddenException('not_meeting_host');
    }
    const t = meeting.transcript;
    if (!t || !t.mergedS3Url) {
      throw new NotFoundException({ reason: 'transcript_not_ready' });
    }

    let key: string;
    if (args.cleaned) {
      const status = t.cleaningStatus ?? 'not_started';
      if (status !== 'ready' || !t.cleanedS3Url) {
        throw new NotFoundException({
          reason: status === 'ready' ? 'not_started' : status,
        });
      }
      key = t.cleanedS3Url;
    } else {
      key = t.mergedS3Url;
    }

    const presigned = await this.s3.presignGet(key);
    return {
      url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
      durationSeconds: t.totalDurationSeconds ?? null,
      cleaned: args.cleaned,
    };
  }

  /**
   * Запуск очистки. Допустимые состояния:
   *   - `ready`     → 200 already_clean (no enqueue);
   *   - `pending`   → 409 in_progress;
   *   - `failed`/`not_started`/null → enqueue → 202 queued.
   */
  async requestClean(args: {
    meetingId: string;
    userId: string;
  }): Promise<
    | { status: 'queued' }
    | { status: 'already_clean' }
  > {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: args.meetingId },
      include: { transcript: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.ownerId !== args.userId) {
      throw new ForbiddenException('not_meeting_host');
    }
    const t = meeting.transcript;
    if (!t || !t.mergedS3Url) {
      throw new NotFoundException({ reason: 'transcript_not_ready' });
    }
    const status = t.cleaningStatus;
    if (status === 'ready' && t.cleanedS3Url) {
      return { status: 'already_clean' };
    }
    if (status === 'pending') {
      throw new ConflictException({ status: 'in_progress' });
    }
    // failed / not_started / null → переставляем pending и enqueue.
    await this.prisma.transcript.update({
      where: { id: t.id },
      data: { cleaningStatus: 'pending' },
    });
    await this.queue.enqueueTranscriptClean(args.meetingId);
    this.logger.log({ meetingId: args.meetingId }, 'transcript-clean: enqueued (manual)');
    return { status: 'queued' };
  }

  /**
   * PATCH /api/v1/org/settings/transcript-cleaning — переключает auto-флаг.
   * Проверка owner/admin делается на уровне OrgsService.update (через RBAC).
   * Здесь только апдейт поля.
   */
  async setAuto(args: { orgId: string; userId: string; auto: boolean }): Promise<{ auto: boolean }> {
    // Минимальная проверка: пользователь — owner или admin Org'а. Делаем через
    // Membership.role; reuse RBAC не требуется (поле узкое).
    const membership = await this.prisma.membership.findFirst({
      where: { orgId: args.orgId, userId: args.userId, role: { in: ['owner', 'admin'] } },
    });
    if (!membership) {
      throw new ForbiddenException('only owner/admin can change org settings');
    }
    const updated = await this.prisma.org.update({
      where: { id: args.orgId },
      data: { transcriptCleaningAuto: args.auto },
      select: { transcriptCleaningAuto: true },
    });
    return { auto: updated.transcriptCleaningAuto };
  }
}
