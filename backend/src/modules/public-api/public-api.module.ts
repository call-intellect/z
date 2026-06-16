import { Module } from '@nestjs/common';

import { CardsModule } from '../cards/cards.module';

import { ApiAccessLogInterceptor } from './api-access-log.interceptor';
import { CardsPublicController } from './cards.public.controller';
import { MeetingsPublicController } from './meetings.public.controller';
import { WebhooksPublicController } from './webhooks.public.controller';

@Module({
  imports: [CardsModule],
  controllers: [MeetingsPublicController, WebhooksPublicController, CardsPublicController],
  providers: [ApiAccessLogInterceptor],
})
export class PublicApiModule {}
