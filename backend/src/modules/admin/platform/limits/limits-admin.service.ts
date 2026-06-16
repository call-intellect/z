import { Inject, Injectable } from '@nestjs/common';

import { AdminSettingsService } from '../../settings/admin-settings.service';

@Injectable()
export class LimitsAdminService {
  constructor(
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  async list() {
    return this.settings.list({ category: 'platform', section: 'limits' });
  }

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
