import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../common/prisma/prisma.service';
import { BearerAuthGuard, RequireScope } from '../api-keys/bearer-auth.guard';
import { CurrentApiUserId } from '../api-keys/current-api-key.decorator';
import { RequireEntitlement } from '../entitlements/require-entitlement.decorator';

import { ApiAccessLogInterceptor } from './api-access-log.interceptor';

/**
 * Public REST API: meetings & связанные сущности.
 *
 * Все эндпоинты:
 *   - под `/api/public/v1`
 *   - защищены `BearerAuthGuard`
 *   - `read` scope обязателен (по дефолту в guard)
 *   - данные возвращаются для `userId` владельца ключа
 */
@ApiTags('public-meetings')
@ApiBearerAuth()
@Controller('api/public/v1')
@UseGuards(BearerAuthGuard)
@UseInterceptors(ApiAccessLogInterceptor)
@RequireEntitlement('feature.public_api')
export class MeetingsPublicController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('meetings')
  @RequireScope('read')
  @ApiOperation({ summary: 'Список встреч (по userId владельца ключа)' })
  async list(
    @CurrentApiUserId() userId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw))) : 50;
    const offset = offsetRaw ? Math.max(0, Number(offsetRaw)) : 0;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where: { ownerId: userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          startedAt: true,
          endedAt: true,
          durationMs: true,
          createdAt: true,
        },
      }),
      this.prisma.meeting.count({
        where: { ownerId: userId, deletedAt: null },
      }),
    ]);
    return { items, total };
  }

  @Get('meetings/:id')
  @RequireScope('read')
  @ApiOperation({ summary: 'Детали встречи' })
  async get(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
  ) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, ownerId: userId, deletedAt: null },
      include: { aiResult: true },
    });
    if (!meeting) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Meeting not found' },
      });
    }
    return meeting;
  }

  @Get('meetings/:id/tasks')
  @RequireScope('read')
  @ApiOperation({ summary: 'Задачи встречи' })
  async tasks(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
  ) {
    await this.assertOwned(id, userId);
    const items = await this.prisma.task.findMany({
      where: { meetingId: id, userId },
      orderBy: { createdAt: 'asc' },
    });
    return { items };
  }

  @Get('meetings/:id/chapters')
  @RequireScope('read')
  @ApiOperation({ summary: 'Главы встречи' })
  async chapters(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
  ) {
    await this.assertOwned(id, userId);
    const items = await this.prisma.meetingChapter.findMany({
      where: { meetingId: id },
      orderBy: { startMs: 'asc' },
    });
    return { items };
  }

  private async assertOwned(meetingId: string, userId: string): Promise<void> {
    const m = await this.prisma.meeting.findFirst({
      where: { id: meetingId, ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    if (!m) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Meeting not found' },
      });
    }
  }
}
