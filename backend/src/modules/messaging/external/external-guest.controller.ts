import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';

import { TypedConfigService } from '../../../common/config/index';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtService } from '../../auth/services/jwt.service';
import type { MessageDto } from '../dto/message.dto';
import { MessageService } from '../services/message.service';

import { AccessLinkService } from './access-link.service';
import {
  AccessExternalSchema,
  type AccessExternalDto,
  type AccessExternalResponse,
  GuestListMessagesQuerySchema,
  type GuestListMessagesQuery,
  type GuestListMessagesResponse,
  GuestSendMessageSchema,
  type GuestSendMessageDto,
  type GuestSendMessageResponse,
  type OkResponse,
  RegisterRequestCodeSchema,
  type RegisterRequestCodeDto,
  RegisterSchema,
  type RegisterDto,
  type RegisterResponse,
} from './dto/external-guest.dto';
import { ExternalConversationService } from './external-conversation.service';
import { ExternalGuestGuard, type ExternalGuestRequest } from './external-guest.guard';

const EXTERNAL_SESSION_COOKIE = 'z_external_session';
const GUEST_VISIBLE_ACCESS = new Set(['external', 'normal']);

@ApiTags('messaging / external guest')
@Controller('api/v1/external')
@UseGuards(ThrottlerGuard)
export class ExternalGuestController {
  constructor(
    @Inject(ExternalConversationService)
    private readonly external: ExternalConversationService,
    @Inject(AccessLinkService) private readonly accessLinks: AccessLinkService,
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Post('access')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Клиент открывает переписку по magic-link (без пароля)' })
  async access(
    @Body(new ZodValidationPipe(AccessExternalSchema)) body: AccessExternalDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessExternalResponse> {
    if (!this.cfg.externalChat.enabled) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'EXTERNAL_CHAT_DISABLED',
          message: 'Внешний чат с клиентами временно недоступен',
        },
      });
    }

    const { accessLink, conversationId } = await this.accessLinks.verifyToken(body.token);

    const { userId } = await this.external.ensureShadowClientUser({
      contactEmail: accessLink.contactEmail,
      contactPhone: accessLink.contactPhone,
    });

    await this.accessLinks.claimLink(accessLink.id, userId);
    await this.external.addClientMember(conversationId, userId);

    const sessionToken = this.jwt.signExternalGuestSession({
      userId,
      conversationId,
      accessLinkId: accessLink.id,
    });

    response.cookie(EXTERNAL_SESSION_COOKIE, sessionToken, {
      domain: this.cfg.auth.cookieDomain,
      httpOnly: true,
      secure: !this.cfg.runtime.isDevelopment,
      sameSite: 'lax',
      maxAge: this.jwt.externalGuestSessionTtlSeconds * 1000,
    });

    return { conversationId };
  }

  @Get('conversations/:id/messages')
  @UseGuards(ExternalGuestGuard)
  @ApiOperation({ summary: 'Клиент читает свою переписку (только external/normal)' })
  async listMessages(
    @Param('id') conversationId: string,
    @Query(new ZodValidationPipe(GuestListMessagesQuerySchema)) query: GuestListMessagesQuery,
  ): Promise<GuestListMessagesResponse> {
    const result = await this.messages.getMessages({
      conversationId,
      sinceSeq: query.sinceSeq ?? null,
      limit: query.limit,
    });
    const items: MessageDto[] = result.items.filter((m) => GUEST_VISIBLE_ACCESS.has(m.access));
    const nextSeq = items.length > 0 ? items[items.length - 1]!.seq : result.nextSeq;
    return { items, nextSeq };
  }

  @Post('conversations/:id/messages')
  @UseGuards(ExternalGuestGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Клиент отправляет сообщение в свою переписку (external)' })
  async sendMessage(
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(GuestSendMessageSchema)) body: GuestSendMessageDto,
    @Req() request: ExternalGuestRequest,
  ): Promise<GuestSendMessageResponse> {
    const guest = request.externalGuest!;
    await this.external.assertInboundRateLimit({ conversationId, userId: guest.userId });

    const tenantId = await this.external.getConversationTenantId(conversationId);
    const result = await this.messages.appendTicketMessage({
      tenantId,
      conversationId,
      authorUserId: guest.userId,
      content: body.content,
      access: 'external',
      authorType: 'human',
    });
    return { messageId: result.messageId, seq: result.seq };
  }

  @Post('register/request-code')
  @Throttle({ default: { ttl: 60 * 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Клиент запрашивает код дорегистрации (email/телефон)' })
  async requestRegisterCode(
    @Body(new ZodValidationPipe(RegisterRequestCodeSchema)) body: RegisterRequestCodeDto,
  ): Promise<OkResponse> {
    const { accessLink } = await this.accessLinks.verifyToken(body.token);
    await this.external.requestRegisterCode({
      accessLinkId: accessLink.id,
      email: body.email ?? null,
      phone: body.phone ?? null,
    });
    return { ok: true };
  }

  @Post('register')
  @Throttle({ default: { ttl: 60 * 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Клиент завершает дорегистрацию по коду (теневой → verified)' })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterDto,
  ): Promise<RegisterResponse> {
    const { accessLink } = await this.accessLinks.verifyToken(body.token);
    if (!accessLink.claimedByUserId) {
      throw new ServiceUnavailableException({
        ok: false,
        error: { code: 'EXTERNAL_NOT_CLAIMED', message: 'Сначала откройте переписку по ссылке' },
      });
    }
    await this.external.register({
      accessLinkId: accessLink.id,
      userId: accessLink.claimedByUserId,
      email: body.email ?? null,
      phone: body.phone ?? null,
      code: body.code,
    });
    return { ok: true, verified: true };
  }

  @Post('conversations/:id/report')
  @UseGuards(ExternalGuestGuard)
  @Throttle({ default: { ttl: 60 * 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Клиент жалуется на переписку (анти-абьюз)' })
  async report(
    @Param('id') conversationId: string,
    @Req() request: ExternalGuestRequest,
  ): Promise<OkResponse> {
    const guest = request.externalGuest!;
    await this.external.reportConversation({ conversationId, userId: guest.userId });
    return { ok: true };
  }
}
