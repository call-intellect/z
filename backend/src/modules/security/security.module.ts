import { Global, Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { EncryptionService } from './encryption.service';
import { IpHashingService } from './ip-hashing.service';
import { PersonalDataDeletionService } from './personal-data-deletion.service';
import { PersonalDataController } from './personal-data.controller';
import { SsrfGuardService } from './ssrf-guard.service';

/**
 * Глобальный security-модуль. Cross-cutting сервисы:
 *   - `SsrfGuardService` — защита исходящих HTTP-запросов от SSRF.
 *   - `EncryptionService` — AES-256-GCM envelope encryption секретов at-rest.
 *   - `IpHashingService` — anti-cheat хеширование IP с daily salt.
 *   - `PersonalDataDeletionService` (Фаза 11) — eraseEntity для 152-ФЗ
 *      «право на удаление личных данных». Каскадно стирает
 *      RawEvent/evidence/entity-links и обезличивает Entity(person).
 *
 * Все сервисы — `@Injectable()` без сторонних зависимостей кроме
 * `TypedConfigService` (глобальный) и `S3Service` (provider'им локально,
 * как в RetentionModule — recordings-модуль HTTP-only).
 */
@Global()
@Module({
  controllers: [PersonalDataController],
  providers: [
    SsrfGuardService,
    EncryptionService,
    IpHashingService,
    PersonalDataDeletionService,
    S3Service,
  ],
  exports: [
    SsrfGuardService,
    EncryptionService,
    IpHashingService,
    PersonalDataDeletionService,
  ],
})
export class SecurityModule {}
