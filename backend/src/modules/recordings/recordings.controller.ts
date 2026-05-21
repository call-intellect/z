import {
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

import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { RecordingsService } from './recordings.service';

/**
 * Cookie-эндпоинты для управления записью встречи.
 *
 *   POST   /api/v1/meetings/:id/recording/start    — host стартует запись.
 *   POST   /api/v1/meetings/:id/recording/stop     — host останавливает.
 *   GET    /api/v1/meetings/:id/recording/download — presigned URL (host).
 *   DELETE /api/v1/meetings/:id/recording          — host удаляет досрочно.
 *
 * Все методы — только под `CookieAuthGuard`. Проверку `ownerId === userId`
 * делает `RecordingsService` (бросает `NotAuthorizedError`).
 */
@Controller('api/v1/meetings/:id/recording')
@UseGuards(CookieAuthGuard)
export class RecordingsController {
  constructor(@Inject(RecordingsService) private readonly recordings: RecordingsService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  async start(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.recordings.start(meetingId, user.id);
    return { ok: true };
  }

  @Post('stop')
  @HttpCode(HttpStatus.OK)
  async stop(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.recordings.stop(meetingId, user.id);
    return { ok: true };
  }

  @Get('download')
  async download(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ url: string; expires_at: string }> {
    const result = await this.recordings.getDownloadUrl(meetingId, user.id);
    return { url: result.url, expires_at: result.expiresAt.toISOString() };
  }

  @Get('audio-tracks')
  async audioTracks(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    tracks: Array<{
      id: string;
      participantName: string;
      livekitIdentity: string;
      durationSeconds: number;
      url: string;
      expiresAt: string;
    }>;
  }> {
    const tracks = await this.recordings.getAudioTracks(meetingId, user.id);
    return { tracks };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async deleteEarly(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.recordings.deleteEarly(meetingId, user.id);
    return { ok: true };
  }
}
