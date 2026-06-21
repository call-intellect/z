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
  CreateIssueTemplateSchema,
  type CreateIssueTemplateDto,
} from '../dto/recurrences/create-issue-template.dto';
import {
  UpdateIssueTemplateSchema,
  type UpdateIssueTemplateDto,
} from '../dto/recurrences/update-issue-template.dto';
import {
  IssueTemplatesService,
  type IssueTemplateResponseDto,
} from '../services/issue-templates.service';

@ApiTags('tracker / issue-templates')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class IssueTemplatesController {
  constructor(
    @Inject(IssueTemplatesService) private readonly svc: IssueTemplatesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issue-templates')
  @ApiOperation({ summary: 'Список шаблонов задач' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Query('projectId') projectId?: string,
  ): Promise<IssueTemplateResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list(t, projectId ?? null);
  }

  @Post('issue-templates')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать шаблон задачи' })
  async create(
    @Body(new ZodValidationPipe(CreateIssueTemplateSchema))
    body: CreateIssueTemplateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueTemplateResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(body, t, user.id);
  }

  @Patch('issue-templates/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить шаблон задачи' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIssueTemplateSchema))
    body: UpdateIssueTemplateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueTemplateResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t);
  }

  @Post('issue-templates/:id/instantiate')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать задачу из шаблона' })
  async instantiate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Query('projectId') projectId?: string,
  ): Promise<{ issueId: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.instantiate(id, t, user.id, projectId ?? null);
  }

  @Delete('issue-templates/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить шаблон задачи' })
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
