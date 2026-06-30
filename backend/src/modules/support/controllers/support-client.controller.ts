import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { ClientMessageSchema, type ClientMessageDto } from '../dto/client-message.dto';
import { CreateTicketSchema, type CreateTicketDto } from '../dto/create-ticket.dto';
import { RateTicketSchema, type RateTicketDto } from '../dto/rate-ticket.dto';
import { SupportAccessService } from '../services/support-access.service';
import { SupportIntakeService } from '../services/support-intake.service';

@ApiTags('support / client')
@ApiBearerAuth()
@Controller('api/v1/support')
@UseGuards(CookieAuthGuard)
export class SupportClientController {
  constructor(
    @Inject(SupportIntakeService)
    private readonly intake: SupportIntakeService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Статус поддержки для текущего пользователя' })
  async me(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ deskEnabled: boolean; isAgent: boolean }> {
    return this.access.getStatus(user.id);
  }

  @Post('tickets')
  @HttpCode(201)
  @ApiOperation({ summary: 'Создать обращение в поддержку' })
  async create(
    @Body(new ZodValidationPipe(CreateTicketSchema)) body: CreateTicketDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() callerOrgId: string | undefined,
  ): Promise<{ ticketId: string }> {
    return this.intake.createTicket(user.id, callerOrgId ?? null, body);
  }

  @Get('my-tickets')
  @ApiOperation({ summary: 'Мои обращения' })
  async listMine(@CurrentUser() user: CurrentUserPayload): Promise<{ items: unknown[] }> {
    return this.intake.listMyTickets(user.id);
  }

  @Get('my-tickets/:id')
  @ApiOperation({ summary: 'Детали моего обращения (только видимые сообщения)' })
  async getMine(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<unknown> {
    return this.intake.getMyTicket(user.id, id);
  }

  @Post('my-tickets/:id/messages')
  @HttpCode(201)
  @ApiOperation({ summary: 'Дописать сообщение в обращение' })
  async addMessage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ClientMessageSchema)) body: ClientMessageDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true; messageId: string }> {
    return this.intake.addMyMessage(user.id, id, body.message);
  }

  @Post('my-tickets/:id/rate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Оценить обращение (CSAT)' })
  async rate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RateTicketSchema)) body: RateTicketDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ ok: true }> {
    return this.intake.rateTicket(user.id, id, body.score, body.comment);
  }
}
