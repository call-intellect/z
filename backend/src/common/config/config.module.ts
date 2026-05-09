import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { parseEnv } from './env.schema';
import { TypedConfigService } from './typed-config.service';

/**
 * Глобальный конфиг-модуль.
 *
 * - Валидирует `process.env` через zod на старте.
 * - При невалидной конфигурации печатает понятное сообщение и завершает процесс.
 * - Экспортирует `TypedConfigService` как единый источник доступа к ENV.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (raw) => {
        try {
          return parseEnv(raw);
        } catch (err) {
          const logger = new Logger('ConfigModule');
          const message = err instanceof Error ? err.message : String(err);
          logger.error(message);
          // Завершаем процесс — без валидной конфигурации запускаться нельзя.
          process.exit(1);
        }
      },
    }),
  ],
  providers: [TypedConfigService],
  exports: [TypedConfigService],
})
export class ConfigModule {}
