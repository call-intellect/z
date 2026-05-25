import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { IcsFeedService } from './services/ics-feed.service';

/**
 * Публичный контроллер ICS-feed календаря пользователя.
 *
 * `GET /api/v1/calendar/:userId.ics?token=<secret>` — БЕЗ `CookieAuthGuard`
 * и `TenantGuard`. Авторизация — по совпадению `token` с
 * `User.calendarFeedToken` (генерируется через
 * `POST /api/v1/me/calendar/feed/generate`).
 *
 * При любой ошибке доступа отдаём 404 (не 401/403), чтобы не палить факт
 * существования пользователя.
 */
@ApiTags('events')
@Controller('api/v1')
export class IcsFeedController {
  constructor(
    @Inject(IcsFeedService) private readonly icsFeed: IcsFeedService,
  ) {}

  @Get('calendar/:userId.ics')
  @ApiOperation({
    summary: 'Публичный ICS-feed календаря пользователя (по токену)',
  })
  async feed(
    @Param('userId') userId: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!token || typeof token !== 'string' || token.length === 0) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'feed_not_found', message: 'Лента календаря не найдена' },
      });
    }
    const body = await this.icsFeed.buildFeed({ userId, token });
    if (body === null) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'feed_not_found', message: 'Лента календаря не найдена' },
      });
    }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline; filename="kora-calendar.ics"');
    res.status(200).send(body);
  }
}
