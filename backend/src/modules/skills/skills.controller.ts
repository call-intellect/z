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
  BatchCreateSkillsSchema,
  CreateSkillSchema,
  ListSkillsQuerySchema,
  UpdateSkillSchema,
  type BatchCreateSkillsDto,
  type CreateSkillDto,
  type ListSkillsQuery,
  type SkillDto,
  type SkillListItemDto,
  type UpdateSkillDto,
} from './dto/skills.dto';
import { SkillsService } from './services/skills.service';

@ApiTags('skills')
@Controller('api/v1/skills')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SkillsController {
  constructor(
    @Inject(SkillsService) private readonly skills: SkillsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список компетенций Org' })
  async list(
    @Query(new ZodValidationPipe(ListSkillsQuerySchema)) q: ListSkillsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: SkillListItemDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.skills.list({
      tenantId: t,
      q: q.q,
      includeDeleted: q.includeDeleted,
      limit: q.limit,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить компетенцию по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SkillDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.skills.get({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать компетенцию' })
  async create(
    @Body(new ZodValidationPipe(CreateSkillSchema)) body: CreateSkillDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SkillDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.skills.create({ tenantId: t, userId: user.id, body });
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Массово создать компетенции' })
  async createBatch(
    @Body(new ZodValidationPipe(BatchCreateSkillsSchema))
    body: BatchCreateSkillsDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: SkillDto[]; created: number; skipped: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.skills.createBatch({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить компетенцию' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSkillSchema)) body: UpdateSkillDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SkillDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.skills.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить компетенцию (soft-delete)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.skills.softDelete({ tenantId: t, userId: user.id, id });
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
    const ok = await this.rbac.canRead(userId, tenantId, 'skill');
    if (!ok) throw this.forbidden('Недостаточно прав для чтения компетенций');
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'skill');
    if (!ok) throw this.forbidden('Изменять компетенции может только владелец/администратор Org');
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'skill',
      act: 'delete',
    });
    if (!ok) throw this.forbidden('Удалять компетенции может только владелец/администратор Org');
  }

  private forbidden(message: string): ForbiddenException {
    return new ForbiddenException({
      ok: false,
      error: { code: 'forbidden', message },
    });
  }
}
