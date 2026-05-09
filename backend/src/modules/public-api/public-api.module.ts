import { Module } from '@nestjs/common';

import { CardsModule } from '../cards/cards.module';

import { ApiAccessLogInterceptor } from './api-access-log.interceptor';
import { CardsPublicController } from './cards.public.controller';
import { MeetingsPublicController } from './meetings.public.controller';
import { WebhooksPublicController } from './webhooks.public.controller';

/**
 * Public REST API. Все контроллеры под `/api/public/v1`, защищены
 * `BearerAuthGuard` (глобально через `ApiKeysModule`).
 *
 * Swagger Bearer-секция формируется из `@ApiBearerAuth()` декораторов в
 * контроллерах. UI выставляется в `main.ts` отдельным маршрутом
 * `/api/public/v1/docs`.
 */
@Module({
  imports: [CardsModule],
  controllers: [
    MeetingsPublicController,
    WebhooksPublicController,
    CardsPublicController,
  ],
  providers: [ApiAccessLogInterceptor],
})
export class PublicApiModule {}
