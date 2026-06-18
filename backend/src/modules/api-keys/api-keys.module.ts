import { Global, Module } from '@nestjs/common';

import { ApiKeysController } from './api-keys.controller';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';
import { BearerAuthGuard } from './bearer-auth.guard';

@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeysRepository, BearerAuthGuard],
  exports: [ApiKeysService, BearerAuthGuard],
})
export class ApiKeysModule {}
