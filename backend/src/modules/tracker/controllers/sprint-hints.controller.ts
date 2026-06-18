import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import type { SprintHintResponseDto } from '../dto/sprint-hints/sprint-hint.dto';
import { SprintHintsService } from '../services/sprint-hints.service';

@ApiTags('tracker / sprint-hints')
@ApiBearerAuth()
@Controller('api/v1/sprint-hints')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SprintHintsController {
  constructor(
    @Inject(SprintHintsService) private readonly svc: SprintHintsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post(':id/dismiss')
  @RequireSubscription()
  @ApiOperation({ summary: 'Закрыть подсказку (статус → dismissed)' })
  async dismiss(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SprintHintResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.dismiss({ hintId: id, tenantId: t, userId: user.id });
  }

  @Post(':id/resolve')
  @RequireSubscription()
  @ApiOperation({ summary: 'Пометить подсказку выполненной (статус → resolved)' })
  async resolve(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SprintHintResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.resolve({ hintId: id, tenantId: t, userId: user.id });
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

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'sprint_hint');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для управления подсказками спринта',
        },
      });
    }
  }
}
