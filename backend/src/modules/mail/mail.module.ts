import { Global, Module } from '@nestjs/common';

import { DisposableEmailService } from './disposable-email.service';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService, DisposableEmailService],
  exports: [MailService, DisposableEmailService],
})
export class MailModule {}
