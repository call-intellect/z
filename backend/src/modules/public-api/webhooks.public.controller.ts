import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BearerAuthGuard, RequireScope } from '../api-keys/bearer-auth.guard';
import { CurrentApiUserId } from '../api-keys/current-api-key.decorator';
import {
  CreateSubscriptionSchema,
  type CreateSubscriptionDto,
} from '../webhooks-out/dto/create-subscription.dto';
import { SubscriptionsService } from '../webhooks-out/subscriptions.service';

import { ApiAccessLogInterceptor } from './api-access-log.interceptor';

/**
 * Public API: webhook subscriptions (proxy на внутренние).
 * Используется внешними интеграциями для CRUD подписок без cookie-сессии.
 */
@ApiTags('public-webhooks')
@ApiBearerAuth()
@Controller('api/public/v1/webhooks/subscriptions')
@UseGuards(BearerAuthGuard)
@UseInterceptors(ApiAccessLogInterceptor)
export class WebhooksPublicController {
  constructor(@Inject(SubscriptionsService) private readonly svc: SubscriptionsService) {}

  @Get()
  @RequireScope('read')
  @ApiOperation({ summary: 'Список подписок' })
  list(@CurrentApiUserId() userId: string) {
    if (!userId) {
      throw new NotFoundException({ ok: false, error: { code: 'unauthorized' } });
    }
    return this.svc.list(userId).then((items) => ({ items }));
  }

  @Post()
  @RequireScope('write')
  @ApiOperation({ summary: 'Создать подписку (secret возвращается 1 раз)' })
  create(
    @CurrentApiUserId() userId: string,
    @Body(new ZodValidationPipe(CreateSubscriptionSchema)) dto: CreateSubscriptionDto,
  ) {
    return this.svc.create(userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScope('write')
  @ApiOperation({ summary: 'Удалить подписку' })
  async delete(
    @CurrentApiUserId() userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.svc.delete(id, userId);
  }
}
