import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { parseEnv } from './env.schema';
import { TypedConfigService } from './typed-config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: (raw: Record<string, unknown>) => {
        try {
          return parseEnv(raw);
        } catch (err) {
          const logger = new Logger('ConfigModule');
          const message = err instanceof Error ? err.message : String(err);
          logger.error(message);
          const isTest =
            process.env['NODE_ENV'] === 'test' ||
            process.env['VITEST'] === 'true' ||
            typeof (globalThis as Record<string, unknown>)['__vitest_worker__'] !== 'undefined';
          if (isTest) {
            throw err instanceof Error ? err : new Error(message);
          }
          process.exit(1);
        }
      },
    }),
  ],
  providers: [TypedConfigService],
  exports: [TypedConfigService],
})
export class ConfigModule {}
