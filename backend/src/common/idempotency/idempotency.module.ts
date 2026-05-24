import { Global, Module } from '@nestjs/common';

import { IdempotencyMiddleware } from './idempotency.middleware';
import { IdempotencyService } from './idempotency.service';

/**
 * Общий модуль Idempotency-Key для tracker-эндпоинтов (POST issues / comments
 * / intake). Глобальный — `IdempotencyService` могут инжектить любые модули,
 * а `IdempotencyMiddleware` подключается из `AppModule.configure`.
 *
 * Не относится к Crossmark — у него собственный Postgres-store
 * `IdempotencyInterceptor` (см. `common/interceptors/idempotency.interceptor.ts`).
 */
@Global()
@Module({
  providers: [IdempotencyService, IdempotencyMiddleware],
  exports: [IdempotencyService, IdempotencyMiddleware],
})
export class IdempotencyModule {}
