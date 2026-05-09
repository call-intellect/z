import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { HmacGuard } from '../auth/guards/hmac.guard';

import {
  CrossmarkResultService,
  type CrossmarkResultDto,
} from './crossmark-result.service';
import {
  CrossmarkUsageService,
  type CrossmarkUsageDto,
} from './crossmark-usage.service';

const UsageQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});
type UsageQuery = z.infer<typeof UsageQuerySchema>;

/**
 * Дополнительные Crossmark-эндпоинты (Phase 8.1):
 *   - GET /integrations/crossmark/v1/meetings/:id/result — снэпшот результата.
 *   - GET /integrations/crossmark/v1/usage?from=&to=     — агрегация AiUsageLog.
 *
 * Все защищены `HmacGuard` (общая Crossmark-схема). Idempotency-ключи здесь
 * не нужны — оба эндпоинта read-only.
 */
@ApiExcludeController()
@Controller('integrations/crossmark/v1')
@UseGuards(HmacGuard)
export class CrossmarkResultController {
  constructor(
    @Inject(CrossmarkResultService)
    private readonly results: CrossmarkResultService,
    @Inject(CrossmarkUsageService) private readonly usage: CrossmarkUsageService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Get('meetings/:id/result')
  async getResult(@Param('id') id: string): Promise<CrossmarkResultDto> {
    const result = await this.results.getResult(id);
    this.metrics.incCrossmarkApiRequest('GET /meetings/:id/result', 200);
    return result;
  }

  @Get('usage')
  async getUsage(
    @Query(new ZodValidationPipe(UsageQuerySchema)) query: UsageQuery,
  ): Promise<CrossmarkUsageDto> {
    const result = await this.usage.getUsage(query.from, query.to);
    this.metrics.incCrossmarkApiRequest('GET /usage', 200);
    return result;
  }
}
