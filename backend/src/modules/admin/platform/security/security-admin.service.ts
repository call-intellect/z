import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AdminSettingsService } from '../../settings/admin-settings.service';

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

  async list() {
    const all = await this.settings.list({
      category: 'platform',
      section: 'security',
    });
    const allowed = new Set<string>(SECURITY_KEYS);
    return all.filter((s) => allowed.has(s.key));
  }

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
