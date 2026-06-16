import { Global, Module } from '@nestjs/common';

import { IdempotencyMiddleware } from './idempotency.middleware';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  providers: [IdempotencyService, IdempotencyMiddleware],
  exports: [IdempotencyService, IdempotencyMiddleware],
})
export class IdempotencyModule {}
