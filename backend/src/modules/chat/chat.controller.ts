import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { ChatAskSchema, type ChatAskDto } from './dto/chat.dto';
import { ChatService } from './chat.service';

/**
 * Эндпоинты AI-чата.
 *   POST /api/v1/meetings/:id/chat        — single-meeting (context-stuffing)
 *   GET  /api/v1/meetings/:id/chat/history
 *   POST /api/v1/chat                     — cross-meeting (RAG)
 *   GET  /api/v1/chat/history             — cross-meeting history
 */
@ApiTags('chat')
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class ChatController {
  constructor(@Inject(ChatService) private readonly svc: ChatService) {}

  @Post('meetings/:id/chat')
  @ApiOperation({ summary: 'AI-чат по одной встрече' })
  askSingle(
    @Param('id') meetingId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(ChatAskSchema)) dto: ChatAskDto,
  ) {
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
  @ApiOperation({ summary: 'AI-чат по архиву встреч (RAG)' })
  askCross(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(ChatAskSchema)) dto: ChatAskDto,
  ) {
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
  @ApiOperation({ summary: 'AI-чат по карточке (RAG среди встреч карточки)' })
  askCard(
    @Param('id') cardId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(ChatAskSchema)) dto: ChatAskDto,
  ) {
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
}
