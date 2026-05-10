import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { AdminFunctionsService } from '../services/admin-functions.service';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

/**
 * Z-Admin functions endpoints (Фаза 7 шаг 4).
 * Управление моделью функции делается через существующий
 * `LlmRoutesController` (PUT /api/v1/admin/llm-routes/:taskType) — DTO
 * расширен на все taskType из union.
 */
@ApiExcludeController()
@Controller('api/v1/admin/functions')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminFunctionsController {
  constructor(
    @Inject(AdminFunctionsService) private readonly svc: AdminFunctionsService,
  ) {}

  @Get()
  async list() {
    return this.svc.listFunctions();
  }

  @Get(':taskType')
  async detail(@Param('taskType') taskType: string) {
    const detail = await this.svc.getFunctionDetail(taskType);
    if (!detail) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'unknown_task_type', message: `Unknown taskType: ${taskType}` },
      });
    }
    return detail;
  }
}
