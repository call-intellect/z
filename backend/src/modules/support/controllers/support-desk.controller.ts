import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { DeskAssignSchema, type DeskAssignDto } from '../dto/desk-assign.dto';
import { DeskListQuerySchema, type DeskListQueryDto } from '../dto/desk-list-query.dto';
import { DeskNoteSchema, type DeskNoteDto } from '../dto/desk-note.dto';
import { DeskReplySchema, type DeskReplyDto } from '../dto/desk-reply.dto';
import { DeskTransitionSchema, type DeskTransitionDto } from '../dto/desk-transition.dto';
import { SupportAccessGuard } from '../guards/support-access.guard';
import { SupportCloneService } from '../services/support-clone.service';
import { SupportDeskService } from '../services/support-desk.service';
import { SupportLearningService } from '../services/support-learning.service';

@ApiTags('support / desk')
@ApiBearerAuth()
@Controller('api/v1/support/desk')
@UseGuards(CookieAuthGuard, SupportAccessGuard)
export class SupportDeskController {
  constructor(
    @Inject(SupportDeskService) private readonly desk: SupportDeskService,
    @Inject(SupportCloneService) private readonly clone: SupportCloneService,
    @Inject(SupportLearningService)
    private readonly learning: SupportLearningService,
  ) {}

  @Get('meta')
  @ApiOperation({ summary: 'Справочники деска (статусы + сотрудники)' })
  async meta(): Promise<{
    states: { id: string; name: string; category: string }[];
    agents: { userId: string; name: string }[];
  }> {
    return this.desk.getMeta();
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Очередь тикетов деска (по view)' })
  async list(
    @Query(new ZodValidationPipe(DeskListQuerySchema)) query: DeskListQueryDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    return this.desk.listTickets(user.id, query);
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'Детали тикета (все сообщения)' })
  async getOne(@Param('id') id: string): Promise<unknown> {
    return this.desk.getTicket(id);
  }

  @Post('tickets/:id/reply')
  @HttpCode(201)
  @ApiOperation({ summary: 'Ответить клиенту (видимо клиенту)' })
  async reply(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeskReplySchema)) body: DeskReplyDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; messageId: string }> {
    return this.desk.reply(id, user.id, body.message, body.fromDraftMessageId);
  }

  @Post('tickets/:id/draft')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Сгенерировать черновик ответа клоном поддержки (Ф3)',
  })
  async draft(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ draftMessageId: string }> {
    return this.clone.generateDraft(id, user.id);
  }

  @Post('drafts/:messageId/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Принять черновик клона как есть (ответить клиенту, Ф3)',
  })
  async acceptDraft(
    @Param('messageId') messageId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.learning.accept(messageId, user.id);
  }

  @Post('drafts/:messageId/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Отклонить черновик клона (учебный сигнал, без ответа, Ф3)',
  })
  async rejectDraft(
    @Param('messageId') messageId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.learning.reject(messageId, user.id);
  }

  @Post('tickets/:id/note')
  @HttpCode(201)
  @ApiOperation({ summary: 'Внутренняя заметка (не видна клиенту)' })
  async note(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeskNoteSchema)) body: DeskNoteDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; messageId: string }> {
    return this.desk.note(id, user.id, body.message);
  }

  @Post('tickets/:id/assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Назначить сотрудника на тикет' })
  async assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeskAssignSchema)) body: DeskAssignDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.desk.assign(id, body.userId, user.id);
  }

  @Post('tickets/:id/transition')
  @HttpCode(200)
  @ApiOperation({ summary: 'Сменить статус тикета' })
  async transition(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DeskTransitionSchema)) body: DeskTransitionDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.desk.transition(id, user.id, body.status);
  }
}
