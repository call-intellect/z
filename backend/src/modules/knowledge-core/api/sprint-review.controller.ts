import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import { SprintReviewService } from '../services/sprint-review.service';

@ApiTags('tracker / cycles')
@ApiBearerAuth()
@Controller('api/v1/cycles')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SprintReviewController {
  constructor(
    @Inject(SprintReviewService)
    private readonly svc: SprintReviewService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get(':id/review')
  @ApiOperation({
    summary: 'Получить финальный отчёт спринта (status: ready / pending / failed)',
  })
  async get(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.getCurrentReview({ cycleId: id, tenantId: t });
  }

  @Post(':id/review/regenerate')
  @RequireSubscription()
  @ApiOperation({
    summary: 'Сгенерировать финальный отчёт спринта заново (например, если AI был недоступен)',
  })
  async regenerate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.generateReview({
      cycleId: id,
      tenantId: t,
      reason: 'manual_regenerate',
    });
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

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'cycle');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'cycle');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для перегенерации отчёта',
        },
      });
    }
  }
}
