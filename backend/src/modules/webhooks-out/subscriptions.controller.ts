import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import {
  CreateSubscriptionSchema,
  type CreateSubscriptionDto,
} from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

@ApiTags('webhooks')
@Controller('api/v1/webhooks/subscriptions')
@UseGuards(CookieAuthGuard)
export class SubscriptionsController {
  constructor(
    @Inject(SubscriptionsService) private readonly svc: SubscriptionsService,
    @Inject(WebhookDispatcherService) private readonly dispatcher: WebhookDispatcherService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список подписок (без plaintext secret)' })
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.list(user.id).then((items) => ({ items }));
  }

  @Post()
  @ApiOperation({
    summary: 'Создать подписку',
    description: 'secret возвращается ОДИН раз. Сохраните для проверки HMAC-подписи.',
  })
  create(
    @CurrentUser() user: CurrentUserPayload,
    @Body(new ZodValidationPipe(CreateSubscriptionSchema)) dto: CreateSubscriptionDto,
  ) {
    return this.svc.create(user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить подписку' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.svc.delete(id, user.id);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Журнал доставок подписки' })
  async deliveries(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const limit = limitRaw ? Math.max(1, Math.min(100, Number(limitRaw))) : 50;
    const offset = offsetRaw ? Math.max(0, Number(offsetRaw)) : 0;
    const items = await this.svc.listDeliveries(id, user.id, limit, offset);
    return { items };
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Тестовая доставка с фейковым event' })
  async test(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const sub = await this.svc.findOwned(id, user.id);
    const payload = this.svc.buildTestPayload('meeting.completed');
    const { deliveryId } = await this.dispatcher.dispatchOne({
      subscriptionId: sub.id,
      event: 'meeting.completed',
      payload,
    });
    return { deliveryId };
  }
}
