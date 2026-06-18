import { Controller, Get, Inject, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import {
  KnowledgeByOrgQuerySchema,
  type KnowledgeByOrgQueryDto,
  KnowledgeGrowthQuerySchema,
  type KnowledgeGrowthQueryDto,
  KnowledgeOverviewQuerySchema,
  type KnowledgeOverviewQueryDto,
} from './dto/knowledge-analytics.dto';
import { KnowledgeAnalyticsService } from './knowledge-analytics.service';

@ApiTags('admin-analytics-knowledge')
@Controller('api/v1/admin/analytics/knowledge')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class KnowledgeAnalyticsController {
  constructor(
    @Inject(KnowledgeAnalyticsService)
    private readonly svc: KnowledgeAnalyticsService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Сводка по объёму knowledge-core: totals + 7d growth по 10 типам сущностей.',
  })
  async overview(
    @Query(new ZodValidationPipe(KnowledgeOverviewQuerySchema))
    q: KnowledgeOverviewQueryDto,
  ) {
    return this.svc.getOverview(q.period);
  }

  @Get('by-org')
  @ApiOperation({
    summary:
      'Топ Org по объёму графа за период: blocks/entities/themes (сортировка — по blocks DESC).',
  })
  async byOrg(
    @Query(new ZodValidationPipe(KnowledgeByOrgQuerySchema))
    q: KnowledgeByOrgQueryDto,
  ) {
    return this.svc.getByOrg(q.period, q.limit);
  }

  @Get('growth')
  @ApiOperation({
    summary:
      'Ежедневный рост блоков/тем/сущностей за период (week=7 точек, month=30 точек) — для line chart.',
  })
  async growth(
    @Query(new ZodValidationPipe(KnowledgeGrowthQuerySchema))
    q: KnowledgeGrowthQueryDto,
  ) {
    return this.svc.getGrowth(q.period);
  }
}
