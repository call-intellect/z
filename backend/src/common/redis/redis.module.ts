import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';

/**
 * Глобальный Redis-модуль. `RedisService` доступен везде через DI.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
