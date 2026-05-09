import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MeetingChapter } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AiQueueService } from '../ai/ai-queue.service';

import type { CreateChapterDto } from './dto/create-chapter.dto';
import type { UpdateChapterDto } from './dto/update-chapter.dto';
import { ChaptersRepository } from './chapters.repository';

/**
 * Сервис глав встречи. Генерация — через `AiQueueService.enqueueChapters`
 * (asynchronous, отдельный воркер). Ручные правки — синхронные.
 */
@Injectable()
export class ChaptersService {
  private readonly logger = new Logger(ChaptersService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChaptersRepository) private readonly repo: ChaptersRepository,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
  ) {}

  async listByMeeting(meetingId: string, userId: string): Promise<MeetingChapter[]> {
    await this.assertMeetingOwner(meetingId, userId);
    return this.repo.listByMeeting(meetingId);
  }

  async create(
    meetingId: string,
    userId: string,
    dto: CreateChapterDto,
  ): Promise<MeetingChapter> {
    await this.assertMeetingOwner(meetingId, userId);
    const order =
      dto.order !== undefined
        ? dto.order
        : await this.repo.countByMeeting(meetingId);
    return this.repo.create({
      meetingId,
      startMs: dto.startMs,
      endMs: dto.endMs,
      title: dto.title,
      summary: dto.summary ?? null,
      order,
    });
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateChapterDto,
  ): Promise<MeetingChapter> {
    const chapter = await this.repo.findById(id);
    if (!chapter) throw new NotFoundException('chapter_not_found');
    await this.assertMeetingOwner(chapter.meetingId, userId);
    return this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
      ...(dto.startMs !== undefined ? { startMs: dto.startMs } : {}),
      ...(dto.endMs !== undefined ? { endMs: dto.endMs } : {}),
      ...(dto.order !== undefined ? { order: dto.order } : {}),
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const chapter = await this.repo.findById(id);
    if (!chapter) throw new NotFoundException('chapter_not_found');
    await this.assertMeetingOwner(chapter.meetingId, userId);
    await this.repo.delete(id);
  }

  /**
   * Идемпотентность: если `chaptersStatus IN (queued, processing)` — 409.
   * Иначе ставим `queued` и ставим job в очередь.
   */
  async regenerate(meetingId: string, userId: string): Promise<{ status: 'queued' }> {
    await this.assertMeetingOwner(meetingId, userId);
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { chaptersStatus: true },
    });
    if (!meeting) throw new NotFoundException('meeting_not_found');
    if (meeting.chaptersStatus === 'queued' || meeting.chaptersStatus === 'processing') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'chapters_already_running',
          message: 'Регенерация уже запущена',
        },
      });
    }
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { chaptersStatus: 'queued' },
    });
    await this.queue.enqueueChapters(meetingId);
    this.logger.log(`chapters.regenerate enqueued meeting=${meetingId}`);
    return { status: 'queued' };
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private async assertMeetingOwner(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, deletedAt: true },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== userId) {
      throw new NotFoundException('meeting_not_found');
    }
  }
}
