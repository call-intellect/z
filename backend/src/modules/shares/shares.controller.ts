import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import {
  type CreateHighlightShareDto,
  CreateHighlightShareSchema,
  type CreateMeetingShareDto,
  CreateMeetingShareSchema,
} from './dto/create-share.dto';
import { SharesService } from './shares.service';

/**
 * Приватные share-эндпоинты (требуют CookieAuth).
 *
 *   `GET    /api/v1/meetings/:id/shares`        — список ссылок встречи
 *   `POST   /api/v1/meetings/:id/shares`        — создать
 *   `DELETE /api/v1/shares/:id`                  — revoke (revokedAt = now)
 *   `GET    /api/v1/highlights/:id/shares`      — список ссылок клипа
 *   `POST   /api/v1/highlights/:id/shares`      — создать клип-ссылку
 *   `DELETE /api/v1/highlight-shares/:id`        — revoke клип-ссылку
 */
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class SharesController {
  constructor(@Inject(SharesService) private readonly shares: SharesService) {}

  // ─────────────────────────── meeting shares ───────────────────────────

  @Get('meetings/:id/shares')
  async listMeeting(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<SharesController['mapMeetingShare']>[] }> {
    const items = await this.shares.listByMeeting(meetingId, user.id);
    return { items: items.map((s) => this.mapMeetingShare(s)) };
  }

  @Post('meetings/:id/shares')
  @HttpCode(HttpStatus.CREATED)
  async createMeeting(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(CreateMeetingShareSchema)) body: CreateMeetingShareDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<SharesController['mapMeetingShare']>> {
    const share = await this.shares.createMeetingShare(meetingId, user.id, body);
    return this.mapMeetingShare(share);
  }

  @Delete('shares/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeMeeting(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.shares.revokeMeetingShare(id, user.id);
  }

  // ─────────────────────────── highlight shares ─────────────────────────

  @Get('highlights/:id/shares')
  async listHighlight(
    @Param('id') highlightId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<SharesController['mapHighlightShare']>[] }> {
    const items = await this.shares.listByHighlight(highlightId, user.id);
    return { items: items.map((s) => this.mapHighlightShare(s)) };
  }

  @Post('highlights/:id/shares')
  @HttpCode(HttpStatus.CREATED)
  async createHighlight(
    @Param('id') highlightId: string,
    @Body(new ZodValidationPipe(CreateHighlightShareSchema)) body: CreateHighlightShareDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<SharesController['mapHighlightShare']>> {
    const share = await this.shares.createHighlightShare(highlightId, user.id, body);
    return this.mapHighlightShare(share);
  }

  @Delete('highlight-shares/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeHighlight(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.shares.revokeHighlightShare(id, user.id);
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private mapMeetingShare(s: {
    id: string;
    token: string;
    meetingId: string;
    allowVideo: boolean;
    allowTranscript: boolean;
    allowTasks: boolean;
    allowChapters: boolean;
    expiresAt: Date;
    revokedAt: Date | null;
    viewCount: number;
    lastViewedAt: Date | null;
    createdAt: Date;
  }): {
    id: string;
    token: string;
    meetingId: string;
    permissions: {
      allowVideo: boolean;
      allowTranscript: boolean;
      allowTasks: boolean;
      allowChapters: boolean;
    };
    expiresAt: string;
    revokedAt: string | null;
    viewCount: number;
    lastViewedAt: string | null;
    createdAt: string;
  } {
    return {
      id: s.id,
      token: s.token,
      meetingId: s.meetingId,
      permissions: {
        allowVideo: s.allowVideo,
        allowTranscript: s.allowTranscript,
        allowTasks: s.allowTasks,
        allowChapters: s.allowChapters,
      },
      expiresAt: s.expiresAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
      viewCount: s.viewCount,
      lastViewedAt: s.lastViewedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private mapHighlightShare(s: {
    id: string;
    token: string;
    highlightId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    viewCount: number;
    lastViewedAt: Date | null;
    createdAt: Date;
  }): {
    id: string;
    token: string;
    highlightId: string;
    expiresAt: string;
    revokedAt: string | null;
    viewCount: number;
    lastViewedAt: string | null;
    createdAt: string;
  } {
    return {
      id: s.id,
      token: s.token,
      highlightId: s.highlightId,
      expiresAt: s.expiresAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
      viewCount: s.viewCount,
      lastViewedAt: s.lastViewedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    };
  }
}
