import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import type { AccessInfo } from './domain/meeting.domain';
import {
  type ListMeetingsQuery,
  ListMeetingsQuerySchema,
} from './dto/list-meetings.dto';
import type { MeetingForUserDto } from './dto/meeting-public.dto';
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
  constructor(@Inject(MeetingsService) private readonly meetings: MeetingsService) {}

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
