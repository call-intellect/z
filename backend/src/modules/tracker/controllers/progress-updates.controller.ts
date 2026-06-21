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
  CreateProgressUpdateSchema,
  type CreateProgressUpdateDto,
} from '../dto/progress-updates/create-progress-update.dto';
import {
  UpdateProgressUpdateSchema,
  type UpdateProgressUpdateDto,
} from '../dto/progress-updates/update-progress-update.dto';
import {
  ProgressUpdatesService,
  type ProgressUpdateResponseDto,
} from '../services/progress-updates.service';

@ApiTags('tracker / progress')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ProgressUpdatesController {
  constructor(
    @Inject(ProgressUpdatesService)
    private readonly svc: ProgressUpdatesService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('issues/:id/progress-updates')
  @ApiOperation({ summary: 'Лента обновлений прогресса задачи' })
  async list(
    @Param('id') issueId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProgressUpdateResponseDto[]> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.findByIssue(issueId, t);
  }

  @Post('issues/:id/progress-updates')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать обновление прогресса (вручную)' })
  async create(
    @Param('id') issueId: string,
    @Body(new ZodValidationPipe(CreateProgressUpdateSchema))
    body: CreateProgressUpdateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProgressUpdateResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create(issueId, body, t, user.id);
  }

  @Patch('progress-updates/:id')
  @RequireSubscription()
  @ApiOperation({ summary: 'Изменить обновление прогресса (только автор)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProgressUpdateSchema))
    body: UpdateProgressUpdateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProgressUpdateResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update(id, body, t, user.id);
  }

  @Post('progress-updates/:id/confirm')
  @RequireSubscription()
  @ApiOperation({
    summary: 'Подтвердить авто-черновик Коры (pending → accepted | edited)',
  })
  async confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProgressUpdateSchema))
    body: UpdateProgressUpdateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ProgressUpdateResponseDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.confirm(id, body, t, user.id);
  }

  @Delete('progress-updates/:id')
  @RequireSubscription()
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить обновление прогресса (автор или admin)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<void> {
    const t = this.requireTenant(tenantId);
    const ctx = await this.rbac.loadContext(user.id, t);
    const isAdmin =
      ctx?.role === 'admin' || ctx?.role === 'owner' || !!ctx?.isSuperAdmin;
    await this.svc.softDelete(id, t, user.id, isAdmin);
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
