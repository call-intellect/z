import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { SuperAdminGuard } from '../../auth/guards/super-admin.guard';
import { SuperAdminAuditInterceptor } from '../super-admin.audit.interceptor';

import { ConciergeAnalyticsService } from './concierge-analytics.service';
import {
  ConciergeNoAnswerQuerySchema,
  type ConciergeNoAnswerQueryDto,
  ConciergeOverviewQuerySchema,
  type ConciergeOverviewQueryDto,
  ConciergeTopQueriesQuerySchema,
  type ConciergeTopQueriesQueryDto,
} from './dto/concierge-analytics.dto';

/**
 * Admin-redesign Фаза 2 — `ConciergeAnalyticsController`.
 *
 * Read-only GET-эндпоинты для UI Z-Admin раздела «Аналитика → Concierge».
 * Метрики по SBA γ-2 Concierge Agent: всего вопросов, no-answer-rate
 * (эвристика), активные пользователи, топ-запросы, no-answer-list.
 *
 * Если модель `ConciergeMessage` / `ConciergeConversation` отсутствует в
 * Prisma client'е — все эндпоинты возвращают 501 Not Implemented со
 * стандартным JSON-телом (см. ТЗ §2: «fallback при отсутствии модели чата»).
 *
 * Все эндпоинты под `CookieAuthGuard + SuperAdminGuard` и
 * `SuperAdminAuditInterceptor`.
 */
@ApiTags('admin-analytics-concierge')
@Controller('api/v1/admin/analytics/concierge')
@UseGuards(CookieAuthGuard, SuperAdminGuard)
@UseInterceptors(SuperAdminAuditInterceptor)
export class ConciergeAnalyticsController {
  constructor(
    @Inject(ConciergeAnalyticsService)
    private readonly svc: ConciergeAnalyticsService,
  ) {}

  /** Общая проверка наличия chat-модели. Кидает 501, если её нет. */
  private assertAvailable(): void {
    if (!this.svc.isAvailable()) {
      throw new HttpException(
        {
          ok: false,
          error: 'Concierge analytics not yet wired to chat module',
        },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
  }

  @Get('overview')
  @ApiOperation({
    summary:
      'Метрики Concierge-чата за период: вопросов, no-answer-rate (эвристика), активные пользователи.',
  })
  async overview(
    @Query(new ZodValidationPipe(ConciergeOverviewQuerySchema))
    q: ConciergeOverviewQueryDto,
  ) {
    this.assertAvailable();
    return this.svc.getOverview(q.period);
  }

  @Get('top-queries')
  @ApiOperation({
    summary:
      'Топ-вопросы по частоте за период (group by нормализованный content). Возвращает [] если модели нет.',
  })
  async topQueries(
    @Query(new ZodValidationPipe(ConciergeTopQueriesQuerySchema))
    q: ConciergeTopQueriesQueryDto,
  ) {
    this.assertAvailable();
    return { items: await this.svc.getTopQueries(q.period, q.limit) };
  }

  @Get('no-answer')
  @ApiOperation({
    summary:
      'Список последних вопросов, на которые Concierge не нашёл ответа (эвристика по маркерам).',
  })
  async noAnswer(
    @Query(new ZodValidationPipe(ConciergeNoAnswerQuerySchema))
    q: ConciergeNoAnswerQueryDto,
  ) {
    this.assertAvailable();
    return { items: await this.svc.getNoAnswerList(q.period, q.limit) };
  }
}
