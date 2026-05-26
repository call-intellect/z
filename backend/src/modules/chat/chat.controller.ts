import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { TypedConfigService } from '../../common/config/index';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { ChatService } from './chat.service';
import { ChatV2AskSchema, type ChatV2AskDto } from './dto/chat-v2.dto';
import { ChatAskSchema, type ChatAskDto } from './dto/chat.dto';

/**
 * Эндпоинты AI-чата.
 *   POST /api/v1/meetings/:id/chat        — single-meeting (legacy / V2 по флагу)
 *   GET  /api/v1/meetings/:id/chat/history
 *   POST /api/v1/chat                     — cross-meeting (legacy / V2 по флагу)
 *   GET  /api/v1/chat/history             — cross-meeting history
 *   POST /api/v1/cards/:id/chat           — card chat (legacy / V2 по флагу)
 *   GET  /api/v1/cards/:id/chat/history
 *   POST /api/v1/chat/v2                  — unified chat v2 (5 scope: org/meeting/card/theme/entity)
 *
 * Switching legacy↔V2: ENV `CHAT_V2_ENABLED` (см. cfg.knowledgeCore.chatV2Enabled).
 * Когда ON — единые «backwards-compatible» эндпоинты делегируются в `ChatService.askXV2`.
 * Когда OFF — работают legacy `askX`. История чата общая (`MeetingChatMessage`),
 * формат citations совместим.
 *
 * @deprecated SBA α-5 — все новые клиенты должны использовать
 *   `POST /api/v1/chat-v2/messages` (см. `ChatV2Controller`). Этот контроллер
 *   остаётся для обратной совместимости с фронтом /chat и API-клиентами,
 *   которые ещё не мигрировали. План удаления — отдельный sub-TZ в β/γ.
 */
@ApiTags('chat')
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly svc: ChatService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Post('meetings/:id/chat')
  @ApiOperation({ summary: 'AI-чат по одной встрече' })
  askSingle(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(ChatAskSchema)) dto: ChatAskDto,
  ) {
    if (this.cfg.knowledgeCore.chatV2Enabled) {
      return this.svc.askSingleMeetingV2({
        userId: user.id,
        meetingId,
        message: dto.message,
      });
    }
    return this.svc.askSingleMeeting({
      userId: user.id,
      meetingId,
      message: dto.message,
    });
  }

  @Get('meetings/:id/chat/history')
  @ApiOperation({ summary: 'История чата по встрече' })
  meetingHistory(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.getMeetingHistory(user.id, meetingId).then((items) => ({ items }));
  }

  @Post('chat')
  @ApiOperation({ summary: 'AI-чат по архиву встреч (RAG / org-scope V2)' })
  askCross(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(ChatAskSchema)) dto: ChatAskDto,
  ) {
    if (this.cfg.knowledgeCore.chatV2Enabled) {
      return this.svc.askCrossMeetingV2({
        userId: user.id,
        message: dto.message,
      });
    }
    return this.svc.askCrossMeeting({
      userId: user.id,
      message: dto.message,
    });
  }

  @Get('chat/history')
  @ApiOperation({ summary: 'История cross-meeting чата' })
  crossHistory(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.getCrossHistory(user.id).then((items) => ({ items }));
  }

  @Post('cards/:id/chat')
  @ApiOperation({ summary: 'AI-чат по карточке (RAG среди встреч карточки / V2)' })
  askCard(
    @Param('id') cardId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(ChatAskSchema)) dto: ChatAskDto,
  ) {
    if (this.cfg.knowledgeCore.chatV2Enabled) {
      return this.svc.askCardV2({
        userId: user.id,
        cardId,
        message: dto.message,
      });
    }
    return this.svc.askCard({
      userId: user.id,
      cardId,
      message: dto.message,
    });
  }

  @Get('cards/:id/chat/history')
  @ApiOperation({ summary: 'История чата по карточке' })
  cardHistory(
    @Param('id') cardId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.getCardHistory(user.id, cardId).then((items) => ({ items }));
  }

  // ─────────────────────────── ChatV2: новый unified endpoint ─────────

  /**
   * `POST /api/v1/chat/v2` — единый AI-чат поверх IdeaBlock'ов с 5 scope.
   * Доступен только когда `CHAT_V2_ENABLED=true`. При выключенном флаге —
   * 503 `chat_v2_disabled`.
   */
  @Post('chat/v2')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI-чат v2 (org/meeting/card/theme/entity)' })
  askUnified(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(ChatV2AskSchema)) dto: ChatV2AskDto,
  ) {
    if (!this.cfg.knowledgeCore.chatV2Enabled) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'chat_v2_disabled',
          message: 'AI-чат v2 не включён на бэкенде (CHAT_V2_ENABLED=false)',
        },
      });
    }
    return this.svc.askUnifiedV2({
      userId: user.id,
      scope: dto.scope,
      scopeId: dto.scopeId ?? null,
      message: dto.query,
    });
  }
}
