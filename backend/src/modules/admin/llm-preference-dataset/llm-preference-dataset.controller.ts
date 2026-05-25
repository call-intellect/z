import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { PreferenceDatasetService } from '../../knowledge-core/services/preference-dataset.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

/**
 * W2.3 KC-Temporal (2026-05-25) — admin-endpoint для скачивания
 * preference-dataset в формате JSONL.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.3.
 *
 * Owner/super_admin only через `SuperAdminGuard`. Стиль (cookie-auth + audit
 * interceptor) — как `LlmRoutesController`.
 *
 * Фронтенд UI `/admin/llm/preference-dataset` — вне scope этой фазы; endpoint
 * предполагает прямой curl-вызов для оффлайн-retraining'а few-shot'ов.
 */
@ApiExcludeController()
@Controller('api/v1/admin/llm/preference-dataset')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class LlmPreferenceDatasetController {
  constructor(
    @Inject(PreferenceDatasetService)
    private readonly svc: PreferenceDatasetService,
  ) {}

  @Get()
  @Header('Content-Type', 'application/jsonl; charset=utf-8')
  async download(
    @Query('taskType') taskType?: string,
    @Query('label') label?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): Promise<string> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const n = limit ? Math.max(1, Math.min(50_000, Number(limit))) : 10_000;
    return this.svc.exportJsonl({
      taskType,
      label,
      from: fromDate && !isNaN(fromDate.getTime()) ? fromDate : undefined,
      to: toDate && !isNaN(toDate.getTime()) ? toDate : undefined,
      limit: n,
    });
  }
}
