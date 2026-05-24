import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { PublicShareHeadersInterceptor } from './public-share-headers.interceptor';
import { type PublicMeetingSharePayload, SharesService } from './shares.service';

/**
 * Публичные share-эндпоинты. БЕЗ CookieAuth — доступ по токену в URL.
 *
 *   `GET /api/v1/public/share/:token`        — встреча
 *   `GET /api/v1/public/share/clip/:token`   — клип
 *
 * Локально подключаем `PublicShareHeadersInterceptor` — ставит
 * `Referrer-Policy`, `X-Robots-Tag`, `Cache-Control`. Глобальной регистрации
 * нет — мы хотим эти заголовки строго на этих двух эндпоинтах.
 *
 * Phase F.6 (2026-05-24-ui-api-modernization): `@Throttle` ограничивает
 * частоту запросов на public read-эндпоинты, чтобы исключить brute-force
 * перебор токенов / scraping. Лимит: 60 запросов / минуту на IP (значение
 * из ThrottlerModule.forRoot default или per-route override).
 */
@Controller('api/v1/public/share')
@UseInterceptors(PublicShareHeadersInterceptor)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicShareController {
  constructor(@Inject(SharesService) private readonly shares: SharesService) {}

  @Get(':token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getMeeting(
    @Param('token') token: string,
    @Req() req: Request,
  ): Promise<PublicMeetingSharePayload> {
    return this.shares.getPublicMeetingShare(token, {
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'] ?? null,
      referrer:
        (req.headers['referer'] as string | undefined) ??
        (req.headers['referrer'] as string | undefined) ??
        null,
    });
  }

  @Get('clip/:token')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getClip(
    @Param('token') token: string,
  ): Promise<{
    title: string;
    description: string | null;
    presignedMp4Url: string;
    expiresAt: string;
  }> {
    return this.shares.getPublicHighlightShare(token);
  }

  private extractIp(req: Request): string | null {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
      const first = xff.split(',')[0]?.trim();
      if (first && first.length > 0) return first;
    }
    if (Array.isArray(xff) && xff.length > 0) {
      return xff[0] ?? null;
    }
    return req.ip ?? null;
  }
}
