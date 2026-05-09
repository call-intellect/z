import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * `PrismaService`, `RedisService`, `TypedConfigService` поднимаются в
 * глобальных модулях (`PrismaModule`, `RedisModule`, `ConfigModule`),
 * поэтому здесь только контроллер.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
