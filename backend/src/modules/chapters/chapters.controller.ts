import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { ChaptersService } from './chapters.service';
import { type CreateChapterDto, CreateChapterSchema } from './dto/create-chapter.dto';
import { type UpdateChapterDto, UpdateChapterSchema } from './dto/update-chapter.dto';

@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class ChaptersController {
  constructor(@Inject(ChaptersService) private readonly chapters: ChaptersService) {}

  @Get('meetings/:id/chapters')
  async list(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<ChaptersController['mapChapter']>[] }> {
    const items = await this.chapters.listByMeeting(meetingId, user.id);
    return { items: items.map((c) => this.mapChapter(c)) };
  }

  @Post('meetings/:id/chapters')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(CreateChapterSchema)) body: CreateChapterDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<ChaptersController['mapChapter']>> {
    const chapter = await this.chapters.create(meetingId, user.id, body);
    return this.mapChapter(chapter);
  }

  @Patch('chapters/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChapterSchema)) body: UpdateChapterDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<ChaptersController['mapChapter']>> {
    const chapter = await this.chapters.update(id, user.id, body);
    return this.mapChapter(chapter);
  }

  @Delete('chapters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload): Promise<void> {
    await this.chapters.delete(id, user.id);
  }

  @Post('meetings/:id/chapters/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  async regenerate(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ status: 'queued' }> {
    return this.chapters.regenerate(meetingId, user.id);
  }

  private mapChapter(c: {
    id: string;
    meetingId: string;
    startMs: number;
    endMs: number;
    title: string;
    summary: string | null;
    order: number;
    extractorVersion: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): {
    id: string;
    meetingId: string;
    startMs: number;
    endMs: number;
    title: string;
    summary: string | null;
    order: number;
    extractorVersion: string | null;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: c.id,
      meetingId: c.meetingId,
      startMs: c.startMs,
      endMs: c.endMs,
      title: c.title,
      summary: c.summary,
      order: c.order,
      extractorVersion: c.extractorVersion ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
