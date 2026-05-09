import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { TypedConfigService } from '../../common/config/index';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { type JoinMeetingDto, JoinMeetingSchema } from './dto/join-meeting.dto';
import { ParticipantsService } from './participants.service';

interface JoinResponse {
  participant_id: string;
  role: 'host' | 'guest';
  livekit_identity: string;
  livekit: {
    url: string;
    token: string | null;
  };
}

/**
 * `POST /api/v1/meetings/:id/join` — единый endpoint и для хоста, и для гостя.
 *
 *   - Cookie-авторизация **опциональна** (`@OptionalAuth()`):
 *       если cookie есть и юзер === host встречи → host-флоу;
 *       иначе → guest-флоу (требует `guest_name`).
 *   - Гостевая cookie `guest_session_<meetingId>` ставится **здесь** при первом
 *     успешном join'е и читается при повторных.
 */
@Controller('api/v1/meetings')
export class ParticipantsController {
  constructor(
    @Inject(ParticipantsService) private readonly service: ParticipantsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Post(':id/join')
  @UseGuards(CookieAuthGuard)
  @OptionalAuth()
  async join(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(JoinMeetingSchema)) body: JoinMeetingDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<JoinResponse> {
    const cookieName = ParticipantsService.guestCookieName(meetingId);
    const existingCookie = this.readCookie(request, cookieName);

    const result = await this.service.join({
      meetingId,
      userId: user?.id ?? null,
      guestName: body.guest_name ?? null,
      existingGuestCookie: existingCookie,
    });

    // Если сервис подписал новую guest-cookie — выставляем её.
    if (result.guestSessionCookie) {
      response.cookie(result.guestSessionCookie.name, result.guestSessionCookie.value, {
        domain: this.cfg.auth.cookieDomain,
        httpOnly: true,
        secure: !this.cfg.runtime.isDevelopment,
        sameSite: 'lax',
        maxAge: result.guestSessionCookie.maxAgeSeconds * 1000,
      });
    }

    return {
      participant_id: result.participantId,
      role: result.role,
      livekit_identity: result.livekitIdentity,
      livekit: result.livekit,
    };
  }

  private readCookie(req: Request, name: string): string | null {
    const fromParser = (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
    if (fromParser) return fromParser;

    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx);
      if (key === name) {
        return decodeURIComponent(trimmed.slice(idx + 1));
      }
    }
    return null;
  }
}
