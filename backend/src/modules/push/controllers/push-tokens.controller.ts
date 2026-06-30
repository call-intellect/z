import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  type RegisterPushTokenBody,
  RegisterPushTokenBodySchema,
  type UnregisterPushTokenBody,
  UnregisterPushTokenBodySchema,
} from '../dto/push-token.dto';
import { PushService } from '../services/push.service';

@ApiTags('push-tokens')
@Controller('api/v1/push/tokens')
@UseGuards(CookieAuthGuard, TenantGuard)
export class PushTokensController {
  constructor(@Inject(PushService) private readonly push: PushService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Зарегистрировать push-токен устройства (apns/fcm/rustore/webpush)' })
  async register(
    @Body(new ZodValidationPipe(RegisterPushTokenBodySchema)) body: RegisterPushTokenBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; id: string }> {
    const t = this.requireTenant(tenantId);
    const row = await this.push.registerToken({
      tenantId: t,
      userId: user.id,
      transport: body.transport,
      token: body.token,
      deviceInfo: body.deviceInfo ?? null,
    });
    return { ok: true, id: row.id };
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Деактивировать push-токен' })
  async unregister(
    @Body(new ZodValidationPipe(UnregisterPushTokenBodySchema)) body: UnregisterPushTokenBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ ok: true; deactivated: number }> {
    this.requireTenant(tenantId);
    const result = await this.push.unregisterToken({
      userId: user.id,
      token: body.token,
      ...(body.transport ? { transport: body.transport } : {}),
    });
    return { ok: true, deactivated: result.deactivated };
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }
}
