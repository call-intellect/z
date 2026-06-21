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
  CreateIssueRecurrenceSchema,
  type CreateIssueRecurrenceDto,
} from '../dto/recurrences/create-issue-recurrence.dto';
import {
  UpdateIssueRecurrenceSchema,
  type UpdateIssueRecurrenceDto,
} from '../dto/recurrences/update-issue-recurrence.dto';
import {
  IssueRecurrencesService,
  type IssueRecurrenceResponseDto,
} from '../services/issue-recurrences.service';

@ApiTags('tracker / issue-recurrences')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class IssueRecurrencesController {
  constructor(
    @Inject(IssueRecurrencesService)
    private readonly svc: IssueRecurrencesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issue-recurrences')
  @ApiOperation({ summary: 'Список повторений задач проекта' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Query('projectId') projectId?: string,
  ): Promise<IssueRecurrenceResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    if (!projectId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'project_required', message: 'Не указан проект' },
      });
    }
    return this.svc.list(t, projectId);
  }

  @Post('issue-recurrences')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать повторение задачи' })
  async create(
    @Body(new ZodValidationPipe(CreateIssueRecurrenceSchema))
    body: CreateIssueRecurrenceDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueRecurrenceResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(body, t, user.id);
  }

  @Patch('issue-recurrences/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить повторение задачи' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateIssueRecurrenceSchema))
    body: UpdateIssueRecurrenceDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueRecurrenceResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t);
  }

  @Delete('issue-recurrences/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить повторение задачи' })
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
