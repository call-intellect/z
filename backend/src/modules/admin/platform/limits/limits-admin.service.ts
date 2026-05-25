import { Inject, Injectable } from '@nestjs/common';

import { AdminSettingsService } from '../../settings/admin-settings.service';

/**
 * Admin-redesign Фаза 8 — `LimitsAdminService`.
 *
 * Тонкая обёртка над `AdminSettingsService` для категории `platform` / секции
 * `limits` (глобальные `MAX_*` и т.п.). Логика хранения / истории /
 * pub-sub'а — внутри AdminSettingsService, здесь только удобный shortcut
 * для UI.
 */
@Injectable()
export class LimitsAdminService {
  constructor(
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  /** Список всех лимитов: AdminSetting where category='platform' section='limits'. */
  async list() {
    return this.settings.list({ category: 'platform', section: 'limits' });
  }

  /**
   * Обновить лимит. Использует AdminSettingsService.set, который пишет в БД,
   * AdminSettingHistory, SuperAdminAccessLog и публикует invalidation.
   */
  async update(args: {
    key: string;
    value: unknown;
    userId: string;
    reason?: string | null;
  }): Promise<void> {
    await this.settings.set(args.key, args.value, {
      userId: args.userId,
      reason: args.reason ?? null,
    });
  }
}
