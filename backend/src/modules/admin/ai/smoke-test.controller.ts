import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { AdminSmokeTestService } from './smoke-test.service';

/**
 * Admin-redesign Фаза 3 — `/api/v1/admin/ai/smoke-test/*`.
 *
 * Все эндпоинты под `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor`. Триггер обычно — кнопка «Прогнать smoke-test»
 * в админке Z, раздел AI / Модели и провайдеры.
 */

const PROVIDER_NAME_RX = /^[a-z0-9-]{2,40}$/;
const ProviderParamSchema = z.object({
  provider: z.string().regex(PROVIDER_NAME_RX, 'provider должен быть slug'),
});
type ProviderParamDto = z.infer<typeof ProviderParamSchema>;

const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type HistoryQueryDto = z.infer<typeof HistoryQuerySchema>;

@ApiExcludeController()
@Controller('api/v1/admin/ai/smoke-test')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class AdminSmokeTestController {
  constructor(
    @Inject(AdminSmokeTestService)
    private readonly svc: AdminSmokeTestService,
  ) {}

  /**
   * Параллельный smoke-test всех активных LLM-провайдеров.
   * ВАЖНО: маршрут объявлен раньше `:provider`, чтобы Nest не сматчил
   * `all` как имя провайдера.
   */
  @Post('all')
  @ApiOperation({ summary: 'Прогнать smoke-test для всех активных LLM-провайдеров.' })
  async runAll(@CurrentUser() user: CurrentUserPayload | null | undefined) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    const items = await this.svc.runForAllActive(user.id);
    return { items };
  }

  /**
   * История последних smoke-test прогонов (in-memory ring-buffer, до 200).
   */
  @Get('history')
  @ApiOperation({ summary: 'История последних smoke-test прогонов.' })
  async history(
    @Query(new ZodValidationPipe(HistoryQuerySchema)) q: HistoryQueryDto,
  ) {
    const items = this.svc.getHistory(q.limit);
    return { items };
  }

  /**
   * Smoke-test одного провайдера по имени (slug).
   * Возвращает `{ provider, status, latencyMs, error?, startedAt }`.
   */
  @Post(':provider')
  @ApiOperation({ summary: 'Прогнать smoke-test для одного LLM-провайдера.' })
  async runOne(
    @Param(new ZodValidationPipe(ProviderParamSchema)) params: ProviderParamDto,
    @CurrentUser() user: CurrentUserPayload | null | undefined,
  ) {
    if (!user || !user.id) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_user_context' },
      });
    }
    return this.svc.runForProvider(params.provider, user.id);
  }
}
