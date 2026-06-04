import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { S3Service } from '../../recordings/s3.service';
import { AiQueueService } from '../ai-queue.service';

import type { DialogTurn } from './prompts/common';

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
   * Транскрипт встречи для UI — массив реплик (`turns`). Только для хоста
   * встречи (Meeting.ownerId).
   *
   *   - `cleaned=false` (default) — оригинал из БД-колонки `Transcript.turns`
   *     (источник правды; не зависит от S3).
   *   - `cleaned=true` — очищенный транскрипт из `cleaned.json` (S3). Если
   *     `cleaningStatus !== 'ready'` — `404` (NotFound) с полем
   *     `reason: 'pending'|'not_started'|'failed'`, чтобы UI понимал: ждать
   *     или нажать «Очистить».
   *
   * Формат `turns` (`DialogTurn`) совпадает с фронтовым `TranscriptTurn`
   * (`{ speaker, text, startSec, endSec }`) — маппинг 1:1.
   */
  async getTranscript(args: {
    meetingId: string;
    userId: string;
    cleaned: boolean;
  }): Promise<{
    turns: DialogTurn[];
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
    if (!t || t.turns === null) {
      throw new NotFoundException({ reason: 'transcript_not_ready' });
    }

    if (args.cleaned) {
      const status = t.cleaningStatus ?? 'not_started';
      if (status !== 'ready' || !t.cleanedS3Url) {
        throw new NotFoundException({
          reason: status === 'ready' ? 'not_started' : status,
        });
      }
      const cleanedDoc = await this.s3.getJson<{ turns?: DialogTurn[] }>(t.cleanedS3Url);
      return {
        turns: cleanedDoc?.turns ?? [],
        durationSeconds: t.totalDurationSeconds ?? null,
        cleaned: true,
      };
    }

    return {
      turns: (t.turns as unknown as DialogTurn[]) ?? [],
      durationSeconds: t.totalDurationSeconds ?? null,
      cleaned: false,
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
