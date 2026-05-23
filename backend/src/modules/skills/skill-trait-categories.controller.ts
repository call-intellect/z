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
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  CreateSkillTraitCategorySchema,
  ListSkillTraitCategoriesQuerySchema,
  MergeSkillTraitCategoriesSchema,
  UpdateSkillTraitCategorySchema,
  type CreateSkillTraitCategoryDto,
  type ListSkillTraitCategoriesQuery,
  type MergeSkillTraitCategoriesDto,
  type MergeSkillTraitCategoriesResultDto,
  type SkillTraitCategoryDto,
  type UpdateSkillTraitCategoryDto,
} from './dto/skill-trait-categories.dto';
import { SkillTraitCategoryService } from './services/skill-trait-categories.service';

/**
 * SBA γ-1 доделки — REST API для SkillTraitCategory.
 *
 *   GET    /api/v1/skills/categories
 *   GET    /api/v1/skills/categories/:id
 *   POST   /api/v1/skills/categories
 *   PATCH  /api/v1/skills/categories/:id
 *   DELETE /api/v1/skills/categories/:id
 *   POST   /api/v1/skills/categories/merge
 *
 * RBAC: ResourceType 'skill_category' (см. policy.csv).
 */
@ApiTags('skills')
@Controller('api/v1/skills/categories')
@UseGuards(CookieAuthGuard, TenantGuard)
export class SkillTraitCategoriesController {
  constructor(
    @Inject(SkillTraitCategoryService)
    private readonly service: SkillTraitCategoryService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список эмерджентных категорий навыковых черт' })
  async list(
    @Query(new ZodValidationPipe(ListSkillTraitCategoriesQuerySchema))
    query: ListSkillTraitCategoriesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ items: SkillTraitCategoryDto[]; total: number }> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.service.list({ tenantId: t, query });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить категорию по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SkillTraitCategoryDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.service.getById({ tenantId: t, id });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать категорию (admin/owner)' })
  async create(
    @Body(new ZodValidationPipe(CreateSkillTraitCategorySchema))
    body: CreateSkillTraitCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SkillTraitCategoryDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.service.create({ tenantId: t, userId: user.id, body });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить категорию' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSkillTraitCategorySchema))
    body: UpdateSkillTraitCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SkillTraitCategoryDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.service.update({ tenantId: t, userId: user.id, id, body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить пустую категорию (soft-delete)' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; deletedAt: string }> {
    const t = this.requireTenant(tenantId);
    await this.requireDelete(user.id, t);
    return this.service.softDelete({ tenantId: t, userId: user.id, id });
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Слить две категории в одну (source soft-deleted, traits перепривязаны)',
  })
  async merge(
    @Body(new ZodValidationPipe(MergeSkillTraitCategoriesSchema))
    body: MergeSkillTraitCategoriesDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MergeSkillTraitCategoriesResultDto> {
    const t = this.requireTenant(tenantId);
    await this.requireWrite(user.id, t);
    return this.service.merge({
      tenantId: t,
      userId: user.id,
      sourceId: body.sourceId,
      targetId: body.targetId,
      via: 'rest',
    });
  }

  // ─────────────────────────── helpers ────────────────────────────

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
    const ok = await this.rbac.canRead(userId, tenantId, 'skill_category');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Нет прав на чтение категорий' },
      });
    }
  }

  private async requireWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'skill_category');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Изменять категории может admin/owner или куратор' },
      });
    }
  }

  private async requireDelete(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.check({
      userId,
      tenantId,
      obj: 'skill_category',
      act: 'delete',
    });
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Удалять категории может только admin/owner' },
      });
    }
  }
}
