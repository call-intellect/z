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
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';

import { type CreateHighlightDto, CreateHighlightSchema } from './dto/create-highlight.dto';
import { type UpdateHighlightDto, UpdateHighlightSchema } from './dto/update-highlight.dto';
import { HighlightsService } from './highlights.service';

@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class HighlightsController {
  constructor(@Inject(HighlightsService) private readonly highlights: HighlightsService) {}

  @Get('meetings/:id/highlights')
  async list(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: ReturnType<HighlightsController['mapHighlight']>[] }> {
    const items = await this.highlights.listByMeeting(meetingId, user.id);
    return { items: items.map((h) => this.mapHighlight(h)) };
  }

  @Post('meetings/:id/highlights')
  @RequireSubscription()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(CreateHighlightSchema)) body: CreateHighlightDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<HighlightsController['mapHighlight']>> {
    const h = await this.highlights.create(meetingId, user.id, body);
    return this.mapHighlight(h);
  }

  @Patch('highlights/:id')
  @RequireSubscription()
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateHighlightSchema)) body: UpdateHighlightDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ReturnType<HighlightsController['mapHighlight']>> {
    const h = await this.highlights.update(id, user.id, body);
    return this.mapHighlight(h);
  }

  @Delete('highlights/:id')
  @RequireSubscription()
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload): Promise<void> {
    await this.highlights.delete(id, user.id);
  }

  @Post('highlights/:id/render-mp4')
  @RequireSubscription()
  @HttpCode(HttpStatus.ACCEPTED)
  async renderMp4(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<
    | { status: 'queued'; renderStatus: 'queued' }
    | { status: 'ready'; url: string; expiresAt: string }
  > {
    return this.highlights.startRender(id, user.id);
  }

  @Get('highlights/:id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.highlights.getDownloadUrl(id, user.id);
  }

  private mapHighlight(h: {
    id: string;
    meetingId: string;
    createdById: string;
    startMs: number;
    endMs: number;
    title: string;
    description: string | null;
    renderedMp4Key: string | null;
    renderStatus: string;
    renderError: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): {
    id: string;
    meetingId: string;
    createdById: string;
    startMs: number;
    endMs: number;
    title: string;
    description: string | null;
    renderStatus: string;
    renderError: string | null;
    hasRenderedMp4: boolean;
    createdAt: string;
    updatedAt: string;
  } {
    return {
      id: h.id,
      meetingId: h.meetingId,
      createdById: h.createdById,
      startMs: h.startMs,
      endMs: h.endMs,
      title: h.title,
      description: h.description,
      renderStatus: h.renderStatus,
      renderError: h.renderError,
      hasRenderedMp4: !!h.renderedMp4Key,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    };
  }
}
