import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  BatchCreateJobDescriptionsSchema,
  CreateJobDescriptionSchema,
  ListJobDescriptionsQuerySchema,
  UpdateJobDescriptionSchema,
  type BatchCreateJobDescriptionsDto,
  type CreateJobDescriptionDto,
  type JobDescriptionDto,
  type JobDescriptionListItemDto,
  type ListJobDescriptionsQuery,
  type UpdateJobDescriptionDto,
} from './dto/job-descriptions.dto';
import { JobDescriptionsService } from './services/job-descriptions.service';

@ApiTags('job-descriptions')
@Controller('api/v1/job-descriptions')
@UseGuards(CookieAuthGuard, TenantGuard)
export class JobDescriptionsController {
  constructor(
    @Inject(JobDescriptionsService) private readonly svc: JobDescriptionsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список должностных инструкций' })
  async list(
    @Query(new ZodValidationPipe(ListJobDescriptionsQuerySchema))
    q: ListJobDescriptionsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: JobDescriptionListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({
      tenantId: t,
      roleId: q.roleId,
      includeDeleted: q.includeDeleted,
      limit: q.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить должностную инструкцию' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<JobDescriptionDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать должностную инструкцию' })
  async create(
    @Body(new ZodValidationPipe(CreateJobDescriptionSchema))
    body: CreateJobDescriptionDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<JobDescriptionDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.create({ tenantId: t, userId: user.id, body });
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Массово создать должностные инструкции' })
  async createBatch(
    @Body(new ZodValidationPipe(BatchCreateJobDescriptionsSchema))
    body: BatchCreateJobDescriptionsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: JobDescriptionDto[]; created: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.createBatch({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить должностную инструкцию (увеличивает version)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateJobDescriptionSchema))
    body: UpdateJobDescriptionDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<JobDescriptionDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.svc.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить должностную инструкцию (soft-delete)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.svc.softDelete({ tenantId: t, userId: user.id, id });
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'job-description');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения должностных инструкций');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'job-description');
    if (!ok)
      throw this.forbidden(
        'Изменять должностные инструкции может только владелец/администратор Org',
      );
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'job-description',
      act: 'delete',
    });
    if (!ok)
      throw this.forbidden(
        'Удалять должностные инструкции может только владелец/администратор Org',
      );
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
