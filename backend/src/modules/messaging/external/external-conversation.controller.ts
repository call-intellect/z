import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';

import {
  StartExternalConversationSchema,
  type StartExternalConversationDto,
  type StartExternalConversationResponse,
} from './dto/external-conversation.dto';
import { ExternalConversationService } from './external-conversation.service';

@ApiTags('messaging / external')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ExternalConversationController {
  constructor(
    @Inject(ExternalConversationService)
    private readonly external: ExternalConversationService,
  ) {}

  @Post('external-conversations')
  @RequireSubscription()
  @ApiOperation({ summary: 'Сотрудник начинает внешний чат с клиентом (ссылка-приглашение)' })
  async start(
    @Body(new ZodValidationPipe(StartExternalConversationSchema))
    body: StartExternalConversationDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<StartExternalConversationResponse> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return this.external.startExternalConversation({
      tenantId,
      createdByUserId: user.id,
      clientContact: body.clientContact,
      title: body.title ?? null,
      message: body.message ?? null,
    });
  }
}
