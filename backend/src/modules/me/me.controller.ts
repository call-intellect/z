import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import { MeService, type MeProfileDto } from './me.service';

/**
 * `GET /api/v1/me/profile` — кто я в контексте текущей Org (X-Org-Id).
 */
@ApiTags('me')
@Controller('api/v1/me')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MeController {
  constructor(@Inject(MeService) private readonly svc: MeService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Профиль текущего пользователя в текущей Org' })
  async profile(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MeProfileDto> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return this.svc.getProfile({ tenantId, userId: user.id });
  }
}
