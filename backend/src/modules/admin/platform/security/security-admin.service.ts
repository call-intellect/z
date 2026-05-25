import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';

import { AdminSettingsService } from '../../settings/admin-settings.service';

/**
 * Admin-redesign Фаза 8 — `SecurityAdminService`.
 *
 * Управление security-критичными настройками: Argon2 параметры, TTL сессий,
 * TTL deep-link'ов. Хранение и история — общие с `AdminSettingsService`,
 * severity='high'.
 *
 * Реальная ротация `IP_HASH_DAILY_SALT` пока не реализована — выдаём 501.
 */

const SECURITY_KEYS = [
  'security.argon_memory_kb',
  'security.argon_iterations',
  'security.argon_parallelism',
  'security.session_ttl_seconds',
  'security.deep_link_ttl_seconds',
] as const;

@Injectable()
export class SecurityAdminService {
  constructor(
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  /** Список всех security-настроек (фильтр по жёсткому whitelist'у ключей). */
  async list() {
    // Дополнительно фильтруем по ключам — на случай, если в БД появятся
    // лишние записи platform/security, не относящиеся к нашим whitelist.
    const all = await this.settings.list({
      category: 'platform',
      section: 'security',
    });
    const allowed = new Set<string>(SECURITY_KEYS);
    return all.filter((s) => allowed.has(s.key));
  }

  /**
   * Обновить security-настройку. reason обязателен и валидируется на уровне
   * DTO (≥10 символов). severity='high' заложена в seed-настройках.
   */
  async update(args: {
    key: string;
    value: unknown;
    userId: string;
    reason: string;
  }): Promise<void> {
    if (!(SECURITY_KEYS as readonly string[]).includes(args.key)) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'security_key_not_allowed',
            message: `Ключ ${args.key} не входит в security-whitelist`,
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.settings.set(args.key, args.value, {
      userId: args.userId,
      reason: args.reason,
    });
  }

  /**
   * Ручная ротация `IP_HASH_DAILY_SALT`. Пока операция не реализована —
   * `pepperHash` ежедневный rotation крутится через cron внутри
   * crypto-сервиса, manual API ещё нет.
   *
   * Возвращаем 501 — будет реализовано на Фазе 9.
   */
  rotateIpSalt(): never {
    throw new HttpException(
      {
        ok: false,
        error: {
          code: 'not_implemented',
          message:
            'Manual rotate IP_HASH_DAILY_SALT не реализован. Ротация выполняется автоматически ежедневным cron-джобом (фаза 9 — manual trigger).',
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
