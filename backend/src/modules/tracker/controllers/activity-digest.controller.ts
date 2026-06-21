import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  IssueActivityDigestService,
  type IssueActivityDigestDto,
} from '../services/issue-activity-digest.service';

@ApiTags('tracker')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ActivityDigestController {
  constructor(
    @Inject(IssueActivityDigestService)
    private readonly svc: IssueActivityDigestService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issues/:id/activity-digest')
  @RequireSubscription()
  @ApiOperation({
    summary: 'AI-сводка изменений по задаче с прошлого захода (catch-up)',
  })
  async digest(
    @Param('id') issueId: string,
    @Query('since') since: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueActivityDigestDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getActivityDigest({
      issueId,
      tenantId: t,
      since: this.parseSince(since),
    });
  }

  private parseSince(since: string | undefined): Date | null {
    if (!since) return null;
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_since', message: 'Некорректная дата since' },
      });
    }
    return parsed;
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Организация не определена',
        },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на чтение задач',
        },
      });
    }
  }
}
