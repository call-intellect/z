import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type { TeamSpotlightResponseDto } from '../dto/recognition.dto';
import { TeamSpotlightService } from '../services/team-spotlight.service';

@ApiTags('recognition / team-spotlight')
@ApiBearerAuth()
@Controller('api/v1/orgs/:orgId/recognition')
@UseGuards(CookieAuthGuard, TenantGuard)
export class TeamSpotlightController {
  constructor(
    @Inject(TeamSpotlightService) private readonly svc: TeamSpotlightService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('team-spotlight')
  @ApiOperation({
    summary: 'Недельный спотлайт команды — top 3-5 человек по Recognition',
  })
  async weekly(
    @Param('orgId') orgId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<TeamSpotlightResponseDto> {
    const t = this.requireTenant(tenantId);
    if (t !== orgId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'org_mismatch',
          message: 'URL :orgId и контекст организации не совпадают',
        },
      });
    }
    const canRead = await this.rbac.canRead(user.id, t, 'org');
    if (!canRead) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на просмотр Team Spotlight',
        },
      });
    }
    return this.svc.getWeekly(t);
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
