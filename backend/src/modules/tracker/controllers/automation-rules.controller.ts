import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
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
  CreateAutomationRuleSchema,
  type CreateAutomationRuleDto,
} from '../dto/automation-rules/create-automation-rule.dto';
import {
  UpdateAutomationRuleSchema,
  type UpdateAutomationRuleDto,
} from '../dto/automation-rules/update-automation-rule.dto';
import {
  AutomationRulesService,
  type AutomationRuleResponseDto,
} from '../services/automation-rules.service';

@ApiTags('tracker / automation-rules')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class AutomationRulesController {
  constructor(
    @Inject(AutomationRulesService) private readonly svc: AutomationRulesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('automation-rules')
  @ApiOperation({ summary: 'Список правил автоматизации' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Query('projectId') projectId?: string,
  ): Promise<AutomationRuleResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list(t, projectId ?? null);
  }

  @Post('automation-rules')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать правило автоматизации (включено по умолчанию)' })
  async create(
    @Body(new ZodValidationPipe(CreateAutomationRuleSchema))
    body: CreateAutomationRuleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AutomationRuleResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(body, t, user.id);
  }

  @Patch('automation-rules/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить правило автоматизации' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAutomationRuleSchema))
    body: UpdateAutomationRuleDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AutomationRuleResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t);
  }

  @Delete('automation-rules/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить правило автоматизации' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.remove(id, t);
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
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав на изменение задач',
        },
      });
    }
  }
}
