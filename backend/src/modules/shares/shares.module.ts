import { Module } from '@nestjs/common';

import { PublicShareHeadersInterceptor } from './public-share-headers.interceptor';
import { PublicShareController } from './public-share.controller';
import { SharesController } from './shares.controller';
import { SharesRepository } from './shares.repository';
import { SharesService } from './shares.service';

@Module({
  controllers: [SharesController, PublicShareController],
  providers: [SharesService, SharesRepository, PublicShareHeadersInterceptor],
  exports: [SharesService],
})
export class SharesModule {}
