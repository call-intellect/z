import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  QuotaExceededError as AiQuotaExceededError,
  RegenerateConflictError,
  RegenerateService,
} from '../ai/services/regenerate.service';
import { RetryService } from '../ai/services/retry.service';
import { TranscriptCleaningService } from '../ai/services/transcript-cleaning.service';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import type { AccessInfo } from './domain/meeting.domain';
import {
  type AddInviteesDto,
  AddInviteesSchema,
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

const RegenerateMeetingSchema = z.object({
  expectedRecapVersion: z.coerce.number().int().min(1),
  templateId: z.string().min(1).optional(),
});
type RegenerateMeetingBody = z.infer<typeof RegenerateMeetingSchema>;

const RegenerateSectionSchema = z.object({
  expectedRecapVersion: z.coerce.number().int().min(1),
  sectionKey: z.string().min(1).max(100),
  userInstruction: z.string().max(2000).optional(),
});
type RegenerateSectionBody = z.infer<typeof RegenerateSectionSchema>;

const UpdateParticipantSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
type UpdateParticipantBody = z.infer<typeof UpdateParticipantSchema>;

/**
 * ТЗ 2026-06-06 knowledge-access (Фаза 7A) — установка закрытости встречи
 * постфактум. null = открыто; 'leadership' | 'council' | 'personal'.
 */
const SetClosedGroupSchema = z.object({
  closedGroupKind: z.enum(['leadership', 'council', 'personal']).nullable(),
});
type SetClosedGroupBody = z.infer<typeof SetClosedGroupSchema>;

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
    @Inject(RegenerateService) private readonly regenerate: RegenerateService,
    @Inject(TranscriptCleaningService)
    private readonly transcriptCleaning: TranscriptCleaningService,
  ) {}

  @Get(':id/access')
  @OptionalAuth()
  // Public endpoint (страница `/m/:id` его дёргает у анонимного гостя).
  // Лимит — 30 запросов в минуту с одного IP, защита от перебора meetingId.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
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
    const result = await this.meetings.list(user.id, {
      page: query.page,
      limit: query.limit,
      query: query.query,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      status: query.status,
      type: query.type,
      cardId: query.cardId,
    });
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
  @RequireSubscription()
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
        cardId: body.card_id ?? null,
        recordByDefault: body.record_by_default,
        invitees: body.invitees,
        closedGroupKind: body.closed_group_kind ?? null,
      },
      user.id,
    );
    return { id: meeting.id, url: `/m/${meeting.id}` };
  }

  /**
   * B5 (2026-06-06) — допригласить участников на joinable-встречу (host-only).
   * Идемпотентно: повтор того же userId/personId = no-op.
   *
   *   - 403 `not_meeting_host` — actor не хост встречи;
   *   - 404 `meeting_not_found` — встреча не найдена;
   *   - 409 `meeting_not_joinable` — встреча не scheduled/active.
   */
  @Post(':id/invitees')
  @RequireSubscription()
  @HttpCode(HttpStatus.CREATED)
  async addInvitees(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddInviteesSchema)) body: AddInviteesDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ added: number; skipped: number }> {
    return this.meetings.addInvitees(id, body.invitees, user.id);
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
   * Транскрипт встречи (host-only) — массив реплик `turns` для UI.
   *
   * Query: `?cleaned=true|false` (default false).
   *   - false → оригинал из БД-колонки `Transcript.turns` (источник правды).
   *   - true  → cleaned-транскрипт. Если cleaning не готов → 404 с
   *     `{ reason: 'pending'|'not_started'|'failed' }` (см. sub-TZ D §8.1).
   */
  @Get(':id/transcript')
  async getTranscript(
    @Param('id') id: string,
    @Query('cleaned') cleanedRaw: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{
    turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
    durationSeconds: number | null;
    cleaned: boolean;
  }> {
    const cleaned = cleanedRaw === 'true' || cleanedRaw === '1';
    return this.transcriptCleaning.getTranscript({
      meetingId: id,
      userId: user.id,
      cleaned,
    });
  }

  /**
   * Запуск очистки транскрипта от слов-паразитов (sub-TZ D §8.2).
   *
   * Auth: host встречи. Rate-limit: 1 в час на пользователя
   * (cleaning редкая операция, дорогой LLM-refine).
   * Идемпотентность по `Transcript.cleaningStatus`:
   *   - 'ready' → 200 already_clean (без enqueue);
   *   - 'pending' → 409 in_progress;
   *   - 'failed' / 'not_started' / null → 202 queued.
   */
  @Post(':id/transcript/clean')
  @RequireSubscription()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 3_600_000, limit: 1 } })
  async cleanTranscript(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ status: 'queued' | 'already_clean' }> {
    return this.transcriptCleaning.requestClean({
      meetingId: id,
      userId: user.id,
    });
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
  @RequireSubscription()
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
  @RequireSubscription()
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
  @RequireSubscription()
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
  @RequireSubscription()
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
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async finish(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; status: string; failureReason: string | null }> {
    const result = await this.hostControls.finish(meetingId, user.id);
    return { ok: true, status: result.status, failureReason: result.failureReason };
  }

  /**
   * Zoom-модель (commercial-reliability pack, 2026-05-30, Фаза 3): хост
   * переименовывает гостя встречи (`Participant.isRegisteredUser=false`)
   * после её окончания. Зарегистрированных трогать нельзя — их имя из аккаунта.
   *
   * Защита: хост-only (через `meetings.renameParticipant` → `getForUser`).
   *   - 403 `not_authorized` — actor не хост встречи;
   *   - 403 `participant_rename_forbidden` — попытка переименовать
   *     зарегистрированного участника;
   *   - 404 `participant_not_found` — participant не найден или принадлежит
   *     другой встрече (защита от path-traversal).
   */
  @Patch(':id/participants/:pid')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async updateParticipant(
    @Param('id') meetingId: string,
    @Param('pid') participantId: string,
    @Body(new ZodValidationPipe(UpdateParticipantSchema)) body: UpdateParticipantBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ id: string; name: string }> {
    const updated = await this.meetings.renameParticipant({
      meetingId,
      participantId,
      newName: body.name,
      actorUserId: user.id,
    });
    return { id: updated.id, name: updated.name };
  }

  /**
   * ТЗ 2026-06-06 knowledge-access (Фаза 7A) — пометить закрытость встречи
   * постфактум (host-only). null = открыто; 'leadership' | 'council' |
   * 'personal'. Читается на ingest (Ф3) для привязки блоков к закрытой группе.
   *
   *   - 403 `not_meeting_host` — actor не хост встречи (через `getForUser`);
   *   - 404 `meeting_not_found` — встреча не найдена.
   */
  @Patch(':id/closed-group')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async setClosedGroup(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(SetClosedGroupSchema)) body: SetClosedGroupBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ id: string; closedGroupKind: string | null }> {
    const updated = await this.meetings.setClosedGroupKind(
      meetingId,
      body.closedGroupKind,
      user.id,
    );
    return { id: updated.id, closedGroupKind: updated.closedGroupKind };
  }

  /**
   * Перезапуск AI-pipeline. Только хост встречи. Rate-limit 3/час на пользователя.
   * Перед вызовом проверяем ownership через `meetings.getForUser`, который
   * бросит `NotAuthorizedError` если пользователь не хост.
   */
  @Post(':id/retry-ai')
  @RequireSubscription()
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

  // ─────────────────────────── regenerate (M3a) ──────────────────────────

  /**
   * Полная регенерация AI-отчёта. Optimistic-lock через `expectedRecapVersion`.
   *
   *   - 200 OK с новым `recapVersion` — успех (jobs поставлены в очередь).
   *   - 409 `recap_version_mismatch` — версия успела измениться.
   *   - 429 `quota_exceeded` — `MAX_REGENERATE_PER_MEETING_PER_DAY`.
   */
  @Post(':id/regenerate')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async regenerateMeeting(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(RegenerateMeetingSchema)) body: RegenerateMeetingBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ recapVersion: number }> {
    try {
      return await this.regenerate.regenerateMeeting({
        meetingId,
        userId: user.id,
        expectedRecapVersion: body.expectedRecapVersion,
        ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      });
    } catch (err) {
      throw this.mapRegenerateError(err);
    }
  }

  /**
   * Регенерация одной секции `AiResult.structuredData[sectionKey]`.
   * Семантика статусов та же: 409 / 429.
   */
  @Post(':id/regenerate-section')
  @RequireSubscription()
  @HttpCode(HttpStatus.OK)
  async regenerateSection(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(RegenerateSectionSchema)) body: RegenerateSectionBody,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ recapVersion: number; newSectionValue: unknown }> {
    try {
      return await this.regenerate.regenerateSection({
        meetingId,
        userId: user.id,
        expectedRecapVersion: body.expectedRecapVersion,
        sectionKey: body.sectionKey,
        ...(body.userInstruction !== undefined
          ? { userInstruction: body.userInstruction }
          : {}),
      });
    } catch (err) {
      throw this.mapRegenerateError(err);
    }
  }

  // ─────────────────────────── soft-delete ───────────────────────────────

  @Delete(':id')
  @RequireSubscription()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMeeting(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.meetings.softDelete(meetingId, user.id);
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  /**
   * Маппинг ошибок RegenerateService → HttpException.
   * `RegenerateForbiddenError` мы не маппим тут отдельно — он наследуется
   * не от DomainError, поэтому будет 500 в `AllExceptionsFilter`. Для UI
   * этого достаточно, т.к. forbidden случается только если `userId` не
   * совпадает с ownerId, а на этом эндпоинте ownership уже подтверждён
   * (в RegenerateService.regenerateMeeting проверяет владельца — но
   * на cookie-флоу пользователь = owner, иначе вернётся 500 что мы
   * мапим как 403 здесь).
   */
  private mapRegenerateError(err: unknown): HttpException {
    if (err instanceof RegenerateConflictError) {
      return new ConflictException({
        ok: false,
        error: {
          code: 'recap_version_mismatch',
          message: `Версия отчёта уже изменилась (current=${err.currentVersion})`,
        },
      });
    }
    if (err instanceof AiQuotaExceededError) {
      const retryAfterSeconds = err.windowHours * 3600;
      return new HttpException(
        {
          ok: false,
          error: {
            code: 'quota_exceeded',
            message: `Превышен лимит регенераций (${err.limit} в ${err.windowHours}ч)`,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
        // Retry-After ставим через response.setHeader в фильтре нельзя — он
        // у нас не сохраняет HttpException-headers. Поэтому отдадим в payload.
        { description: `Retry-After: ${retryAfterSeconds}` },
      );
    }
    if (err instanceof Error && err.name === 'RegenerateForbiddenError') {
      return new HttpException(
        {
          ok: false,
          error: { code: 'forbidden', message: 'Нет прав на это действие' },
        },
        HttpStatus.FORBIDDEN,
      );
    }
    if (err instanceof HttpException) return err;
    if (err instanceof Error) {
      return new HttpException(err.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return new HttpException('Internal error', HttpStatus.INTERNAL_SERVER_ERROR);
  }

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
