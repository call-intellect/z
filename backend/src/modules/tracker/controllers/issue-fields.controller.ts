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
  CreateFieldDefSchema,
  type CreateFieldDefDto,
} from '../dto/issue-fields/create-field-def.dto';
import {
  SetFieldValueSchema,
  type SetFieldValueDto,
} from '../dto/issue-fields/set-field-value.dto';
import {
  IssueFieldsService,
  type IssueFieldDefResponseDto,
  type IssueFieldValueResponseDto,
} from '../services/issue-fields.service';

@ApiTags('tracker / custom-fields')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class IssueFieldsController {
  constructor(
    @Inject(IssueFieldsService) private readonly svc: IssueFieldsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issue-fields')
  @ApiOperation({ summary: 'Список определений кастом-полей задач' })
  async listDefs(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
    @Query('projectId') projectId?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<IssueFieldDefResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listDefs(
      t,
      projectId ?? null,
      includeArchived === 'true',
    );
  }

  @Post('issue-fields')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать определение кастом-поля' })
  async createDef(
    @Body(new ZodValidationPipe(CreateFieldDefSchema)) body: CreateFieldDefDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueFieldDefResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.createDef(body, t);
  }

  @Delete('issue-fields/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Архивировать определение кастом-поля' })
  async archiveDef(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueFieldDefResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.archiveDef(id, t);
  }

  @Get('issues/:id/field-values')
  @ApiOperation({ summary: 'Значения кастом-полей задачи' })
  async listValues(
    @Param('id') issueId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueFieldValueResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.listValues(issueId, t);
  }

  @Post('issues/:id/field-values')
  @RequireSubscription()
  @ApiOperation({ summary: 'Задать значение кастом-поля задаче' })
  async setValue(
    @Param('id') issueId: string,
    @Body(new ZodValidationPipe(SetFieldValueSchema)) body: SetFieldValueDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<IssueFieldValueResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.setValue(issueId, body, t);
  }

  @Delete('issues/:id/field-values/:fieldId')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Снять значение кастом-поля с задачи' })
  async deleteValue(
    @Param('id') issueId: string,
    @Param('fieldId') fieldId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.deleteValue(issueId, fieldId, t);
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
