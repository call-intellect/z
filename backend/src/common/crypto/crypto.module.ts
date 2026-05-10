import { Global, Module } from '@nestjs/common';

import { CryptoService } from './crypto.service';

/**
 * Глобальный CryptoModule (Фаза 10 knowledge-core).
 *
 * `CryptoService` доступен во всех модулях без явного импорта. Используется
 * адаптерами Telegram / Mango / Email для шифрования секретов в `Source.config`.
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
