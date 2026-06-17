import { Inject, Injectable, Logger } from '@nestjs/common';

import { AdminSettingsService } from '../../settings/admin-settings.service';

const CATEGORY = 'content';
const SECTION = 'copy-strings';

export interface CopyStringItem {
  key: string;
  value: string;
  updatedBy: string | null;
  updatedAt: Date;
  description: string | null;
}

@Injectable()
export class CopyStringsAdminService {
  private readonly logger = new Logger(CopyStringsAdminService.name);

  constructor(
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  async list(): Promise<{ items: CopyStringItem[] }> {
    const rows = await this.settings.list({
      category: CATEGORY,
      section: SECTION,
    });
    return {
      items: rows.map((r) => ({
        key: r.key,
        value: this.coerceValue(r.value),
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt,
        description: r.description,
      })),
    };
  }

  async update(
    key: string,
    value: string,
    userId: string | null,
    reason: string | null,
  ): Promise<{ ok: true }> {
    await this.settings.set(key, value, {
      userId,
      reason,
    });
    return { ok: true };
  }

  async bulkImport(
    entries: Record<string, string>,
    userId: string | null,
    reason: string | null,
  ): Promise<{ ok: true; imported: number }> {
    let imported = 0;
    for (const [key, value] of Object.entries(entries)) {
      try {
        await this.settings.set(key, value, { userId, reason });
        imported++;
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err), key },
          'CopyStringsAdminService.bulkImport: ошибка ключа',
        );
      }
    }
    return { ok: true, imported };
  }

  private coerceValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
