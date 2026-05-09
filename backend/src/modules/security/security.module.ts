import { Global, Module } from '@nestjs/common';

import { EncryptionService } from './encryption.service';
import { IpHashingService } from './ip-hashing.service';
import { SsrfGuardService } from './ssrf-guard.service';

/**
 * Глобальный security-модуль. Cross-cutting сервисы:
 *   - `SsrfGuardService` — защита исходящих HTTP-запросов от SSRF.
 *   - `EncryptionService` — AES-256-GCM envelope encryption секретов at-rest.
 *   - `IpHashingService` — anti-cheat хеширование IP с daily salt.
 *
 * Все сервисы — `@Injectable()` без сторонних зависимостей кроме
 * `TypedConfigService` (глобальный).
 */
@Global()
@Module({
  providers: [SsrfGuardService, EncryptionService, IpHashingService],
  exports: [SsrfGuardService, EncryptionService, IpHashingService],
})
export class SecurityModule {}
