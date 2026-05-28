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
import { RequireSubscription } from '../../billing/guards/require-subscription.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import {
  CreateLabelSchema,
  type CreateLabelDto,
  ListLabelsQuerySchema,
  type ListLabelsQuery,
  UpdateLabelSchema,
  type UpdateLabelDto,
} from '../dto/labels/create-label.dto';
import type { LabelResponseDto } from '../services/labels.service';
import { LabelsService } from '../services/labels.service';

/**
 * REST `/api/v1/labels` — метки задач. Доступ read — все members; write/delete —
 * RBAC ResourceType='project' (write).
 */
@ApiTags('tracker / labels')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class LabelsController {
  constructor(
    @Inject(LabelsService) private readonly svc: LabelsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('labels')
  @ApiOperation({ summary: 'Список меток (фильтр по projectId)' })
  async list(
    @Query(new ZodValidationPipe(ListLabelsQuerySchema)) query: ListLabelsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<LabelResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findAll(t, query);
  }

  @Post('labels')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать метку (admin / project_manager)' })
  async create(
    @Body(new ZodValidationPipe(CreateLabelSchema)) body: CreateLabelDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<LabelResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(body, t);
  }

  @Patch('labels/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить метку' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLabelSchema)) body: UpdateLabelDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<LabelResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t);
  }

  @Delete('labels/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить метку' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    await this.svc.delete(id, t);
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
    const ok = await this.rbac.canRead(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет доступа к меткам' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'project');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Только admin / owner могут управлять метками',
        },
      });
    }
  }
}
