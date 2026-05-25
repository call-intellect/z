import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import {
  CreatePlanSchema,
  type CreatePlanDto,
  UpdatePlanSchema,
  type UpdatePlanDto,
} from './dto/plans.dto';
import { AdminPlansService } from './plans.service';

const HardQuerySchema = z.object({
  hard: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(false),
});
type HardQuery = z.infer<typeof HardQuerySchema>;

/**
 * Admin-redesign Фаза 4 — `AdminPlansController`.
 *
 * Все эндпоинты под `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor`. UI Z-Admin вкладка «Тенанты → Тарифы».
 *
 * Префикс `/admin/orgs/plans` (по ТЗ — Plans хранятся под Org-категорией,
 * так как Plan напрямую влияет на OrgEntitlement.tier).
 */
@ApiTags('admin-plans')
@Controller('api/v1/admin/orgs/plans')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminPlansController {
  constructor(
    @Inject(AdminPlansService) private readonly svc: AdminPlansService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Список Plan (тарифов продукта), отсортирован по sortOrder + количество Org на каждом тарифе.',
  })
  list() {
    return this.svc.list();
  }

  @Post()
  @ApiOperation({ summary: 'Создать новый Plan.' })
  create(@Body(new ZodValidationPipe(CreatePlanSchema)) dto: CreatePlanDto) {
    return this.svc.create({
      id: dto.id,
      displayName: dto.displayName,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      features: dto.features,
      quotas: dto.quotas,
      ...(dto.monthlyPriceRub !== undefined
        ? { monthlyPriceRub: dto.monthlyPriceRub }
        : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить Plan (partial). Поддерживает isActive для restore.' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePlanSchema)) dto: UpdatePlanDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Удалить Plan. По умолчанию soft (isActive=false). ?hard=true — hard-delete; 400 если есть Org с этим tier.',
  })
  remove(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(HardQuerySchema)) q: HardQuery,
  ) {
    if (q.hard) return this.svc.hardDelete(id);
    return this.svc.softDelete(id);
  }

  @Get(':id/usage')
  @ApiOperation({
    summary:
      'Список первых 10 Org, использующих этот Plan, + общий счётчик использований.',
  })
  usage(@Param('id') id: string) {
    return this.svc.getUsage(id);
  }
}
