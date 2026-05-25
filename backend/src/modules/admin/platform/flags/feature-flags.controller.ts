import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../../super-admin.audit.interceptor';

import {
  CreateFeatureFlagSchema,
  type CreateFeatureFlagDto,
  ResolveQuerySchema,
  type ResolveQueryDto,
  SetOverrideSchema,
  type SetOverrideDto,
  UpdateFeatureFlagSchema,
  type UpdateFeatureFlagDto,
} from './dto/feature-flags.dto';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Admin-redesign Фаза 8 — `FeatureFlagsController`.
 *
 * UI `/admin/platform/feature-flags` — CRUD флагов, точечные orgOverride
 * и debug-resolve для тенанта.
 */
@ApiTags('admin-platform-feature-flags')
@Controller('api/v1/admin/platform/feature-flags')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class FeatureFlagsController {
  constructor(
    @Inject(FeatureFlagsService)
    private readonly svc: FeatureFlagsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список всех feature flags (отсортирован по category/key).' })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Создать feature flag.' })
  async create(
    @Body(new ZodValidationPipe(CreateFeatureFlagSchema))
    dto: CreateFeatureFlagDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.create({
      key: dto.key,
      description: dto.description,
      defaultValue: dto.defaultValue,
      category: dto.category,
      userId: user.id,
    });
  }

  @Patch(':key')
  @ApiOperation({
    summary:
      'Обновить feature flag: defaultValue / orgOverrides / rolloutPercent / description / category.',
  })
  async update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateFeatureFlagSchema))
    dto: UpdateFeatureFlagDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.update({
      key,
      patch: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.defaultValue !== undefined ? { defaultValue: dto.defaultValue } : {}),
        ...(dto.rolloutPercent !== undefined
          ? { rolloutPercent: dto.rolloutPercent }
          : {}),
        ...(dto.orgOverrides !== undefined
          ? { orgOverrides: dto.orgOverrides }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
      },
      userId: user.id,
    });
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Удалить feature flag.' })
  remove(@Param('key') key: string) {
    return this.svc.delete(key);
  }

  @Get(':key/resolve')
  @ApiOperation({
    summary:
      'Debug: вернуть effective value флага для конкретного tenantId. Учитывает overrides и rolloutPercent.',
  })
  resolve(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(ResolveQuerySchema)) q: ResolveQueryDto,
  ) {
    return this.svc.resolve(key, q.tenantId);
  }

  @Put(':key/override/:tenantId')
  @ApiOperation({ summary: 'Установить orgOverride для tenantId.' })
  async setOverride(
    @Param('key') key: string,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(SetOverrideSchema)) dto: SetOverrideDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.setOverride({
      key,
      tenantId,
      value: dto.value,
      userId: user.id,
    });
  }

  @Delete(':key/override/:tenantId')
  @ApiOperation({ summary: 'Снять orgOverride для tenantId.' })
  async clearOverride(
    @Param('key') key: string,
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.clearOverride({
      key,
      tenantId,
      userId: user.id,
    });
  }
}
