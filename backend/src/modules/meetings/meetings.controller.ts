import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RetryService } from '../ai/services/retry.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import type { AccessInfo } from './domain/meeting.domain';
import {
  type CreateMeetingForUserDto,
  CreateMeetingForUserSchema,
} from './dto/create-meeting.dto';
import {
  type ListMeetingsQuery,
  ListMeetingsQuerySchema,
} from './dto/list-meetings.dto';
import type { MeetingForUserDto } from './dto/meeting-public.dto';
import { HostControlsService } from './host-controls.service';
import { MeetingsService } from './meetings.service';

/**
 * Cookie endpoints для встреч (для фронта).
 *
 *   GET /api/v1/meetings/:id/access — optional cookie. Возвращает роль,
 *      нужна странице `/m/:id` ДО того как мы решили показывать что-то юзеру.
 *   GET /api/v1/meetings           — список встреч пользователя (он — host).
 *   GET /api/v1/meetings/:id       — детали встречи (только host'у).
 *
 * Все mutating endpoints (`/join`, `/leave`, controls) — в других контроллерах.
 */
@Controller('api/v1/meetings')
@UseGuards(CookieAuthGuard)
export class MeetingsController {
  constructor(
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(HostControlsService) private readonly hostControls: HostControlsService,
    @Inject(RetryService) private readonly retry: RetryService,
  ) {}

  @Get(':id/access')
  @OptionalAuth()
  async access(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ): Promise<AccessInfo> {
    return this.meetings.getAccess(id, user?.id ?? null);
  }

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListMeetingsQuerySchema)) query: ListMeetingsQuery,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    items: ReturnType<MeetingsController['mapMeetingSummary']>[];
    page: number;
    limit: number;
    total: number;
  }> {
    const result = await this.meetings.list(user.id, query);
    return {
      items: result.items.map((m) => this.mapMeetingSummary(m)),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

  /**
   * Создание встречи под уже залогиненного юзера (Фаза 7.5).
   * Возвращает `id` — фронт делает редирект на `/m/<id>`.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateMeetingForUserSchema)) body: CreateMeetingForUserDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ id: string; url: string }> {
    const meeting = await this.meetings.createForUser(
      {
        type: body.type,
        title: body.title,
        customPrompt: body.custom_prompt ?? null,
      },
      user.id,
    );
    return { id: meeting.id, url: `/m/${meeting.id}` };
  }

  // ─────────────────────────── result page (Фаза 7.6) ────────────────────

  /**
   * Полные данные result-страницы для host'а.
   */
  @Get(':id/result')
  async getResult(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): ReturnType<MeetingsService['getResult']> {
    return this.meetings.getResult(id, user.id);
  }

  /**
   * Краткий стейт для polling'а.
   */
  @Get(':id/result/status')
  async getResultStatus(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): ReturnType<MeetingsService['getResultStatus']> {
    return this.meetings.getResultStatus(id, user.id);
  }

  /**
   * Presigned URL на merged transcript (host).
   */
  @Get(':id/transcript')
  async getTranscript(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): ReturnType<MeetingsService['getTranscript']> {
    return this.meetings.getTranscript(id, user.id);
  }

  @Get(':id')
  async getOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<MeetingForUserDto> {
    const meeting = await this.meetings.getForUser(id, user.id);
    return {
      id: meeting.id,
      title: meeting.title,
      type: meeting.type,
      status: meeting.status,
      startedAt: meeting.startedAt?.toISOString() ?? null,
      endedAt: meeting.endedAt?.toISOString() ?? null,
      failureReason: meeting.failureReason ?? null,
      createdAt: meeting.createdAt.toISOString(),
      customPrompt: meeting.customPrompt ?? null,
      participants: meeting.participants.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        livekitIdentity: p.livekitIdentity,
        isRegisteredUser: p.isRegisteredUser,
        joinedAt: p.joinedAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
      })),
    };
  }

  // ─────────────────────────── host controls ─────────────────────────────

  @Post(':id/participants/:pid/mute')
  @HttpCode(HttpStatus.OK)
  async muteParticipant(
    @Param('id') meetingId: string,
    @Param('pid') participantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.hostControls.muteParticipant(meetingId, participantId, user.id);
    return { ok: true };
  }

  @Post(':id/participants/:pid/unmute')
  @HttpCode(HttpStatus.OK)
  async unmuteParticipant(
    @Param('id') meetingId: string,
    @Param('pid') participantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.hostControls.unmuteParticipant(meetingId, participantId, user.id);
    return { ok: true };
  }

  @Post(':id/participants/:pid/kick')
  @HttpCode(HttpStatus.OK)
  async kickParticipant(
    @Param('id') meetingId: string,
    @Param('pid') participantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.hostControls.kickParticipant(meetingId, participantId, user.id);
    return { ok: true };
  }

  @Post(':id/participants/:pid/lower-hand')
  @HttpCode(HttpStatus.OK)
  async lowerHand(
    @Param('id') meetingId: string,
    @Param('pid') participantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.hostControls.lowerHand(meetingId, participantId, user.id);
    return { ok: true };
  }

  @Post(':id/finish')
  @HttpCode(HttpStatus.OK)
  async finish(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    await this.hostControls.finish(meetingId, user.id);
    return { ok: true };
  }

  /**
   * Перезапуск AI-pipeline. Только хост встречи. Rate-limit 3/час на пользователя.
   * Перед вызовом проверяем ownership через `meetings.getForUser`, который
   * бросит `NotAuthorizedError` если пользователь не хост.
   */
  @Post(':id/retry-ai')
  @HttpCode(HttpStatus.OK)
  async retryAi(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; stage: string }> {
    // Проверка ownership: getForUser кидает NotAuthorizedError для не-хоста.
    await this.meetings.getForUser(meetingId, user.id);
    const result = await this.retry.retry(meetingId, 'user', user.id);
    return { ok: true, stage: result.stage };
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private mapMeetingSummary(m: {
    id: string;
    title: string;
    type: string;
    status: string;
    startedAt: Date | null;
    endedAt: Date | null;
    createdAt: Date;
  }): {
    id: string;
    title: string;
    type: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    createdAt: string;
  } {
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      status: m.status,
      startedAt: m.startedAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
