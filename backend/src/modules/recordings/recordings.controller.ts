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
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';

import { RecordingsService } from './recordings.service';

@Controller('api/v1/meetings/:id/recording')
@UseGuards(CookieAuthGuard)
export class RecordingsController {
  constructor(@Inject(RecordingsService) private readonly recordings: RecordingsService) {}

  @Post('start')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async start(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.recordings.start(meetingId, user.id);
    return { ok: true };
  }

  @Post('stop')
  @RequireSubscription()
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
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async deleteEarly(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.recordings.deleteEarly(meetingId, user.id);
    return { ok: true };
  }
}
