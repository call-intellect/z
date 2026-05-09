import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import { TypedConfigService } from '../../common/config/index';

/**
 * Argon2id wrapper для standalone-аккаунтов.
 *
 * Параметры (memoryKb, iterations, parallelism) — из ENV `cfg.argon`,
 * defaults — OWASP 2024 (19 MiB / 2 / 1).
 *
 * Раздельный сервис нужен:
 *   1) чтобы не дублировать `argon2.hash(...opts)` в нескольких местах,
 *   2) чтобы все unit-тесты accounts могли мокнуть его одной строкой
 *      и не платить ~50ms за реальный hash на каждом ассерте.
 */
@Injectable()
export class PasswordService {
  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.cfg.argon.memoryKb,
      timeCost: this.cfg.argon.iterations,
      parallelism: this.cfg.argon.parallelism,
    });
  }

  /**
   * Проверка пароля. Если hash невалидный — возвращает false (а не throw).
   * Невалидный hash возможен у legacy/bcrypt-аккаунтов; AccountsService
   * в таких случаях не должен путать «неверный пароль» с «битый hash».
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
