import { Global, Module } from '@nestjs/common';

import { ApiKeysController } from './api-keys.controller';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';
import { BearerAuthGuard } from './bearer-auth.guard';

/**
 * @Global — `BearerAuthGuard` нужен в `PublicApiModule` (отдельный модуль),
 * проще держать как глобальный экспорт, чем заводить in-scope guard.
 */
@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeysRepository, BearerAuthGuard],
  exports: [ApiKeysService, BearerAuthGuard],
})
export class ApiKeysModule {}
