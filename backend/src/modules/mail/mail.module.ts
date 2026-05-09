import { Global, Module } from '@nestjs/common';

import { DisposableEmailService } from './disposable-email.service';
import { MailService } from './mail.service';

/**
 * Глобальный модуль почты + проверки одноразовых доменов.
 *
 * Используется в `AccountsModule` (онбординг + reset password). Сделан
 * глобальным на случай, если в будущем нотификации/админ начнут отправлять
 * письма — не придётся повторно импортировать.
 */
@Global()
@Module({
  providers: [MailService, DisposableEmailService],
  exports: [MailService, DisposableEmailService],
})
export class MailModule {}
