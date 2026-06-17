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
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';

import { ChatService } from './chat.service';
import { ChatV2AskSchema, type ChatV2AskDto } from './dto/chat-v2.dto';
import { ChatAskSchema, type ChatAskDto } from './dto/chat.dto';

@ApiTags('chat')
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly svc: ChatService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Post('meetings/:id/chat')
  @RequireSubscription()
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
  meetingHistory(@Param('id') meetingId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.getMeetingHistory(user.id, meetingId).then((items) => ({ items }));
  }

  @Post('chat')
  @RequireSubscription()
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
  @RequireSubscription()
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
  cardHistory(@Param('id') cardId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.svc.getCardHistory(user.id, cardId).then((items) => ({ items }));
  }

  @Post('chat/v2')
  @RequireSubscription()
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
