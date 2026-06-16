import { Global, Module } from '@nestjs/common';

import { S3Service } from '../recordings/s3.service';

import { EncryptionService } from './encryption.service';
import { IpHashingService } from './ip-hashing.service';
import { PersonalDataDeletionService } from './personal-data-deletion.service';
import { PersonalDataController } from './personal-data.controller';
import { SsrfGuardService } from './ssrf-guard.service';

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
  exports: [SsrfGuardService, EncryptionService, IpHashingService, PersonalDataDeletionService],
})
export class SecurityModule {}
