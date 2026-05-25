/**
 * Admin-redesign Фаза 5 — unit-тесты `CopyStringsAdminService`.
 *
 * Покрываем:
 *   1) list(): прокидывает фильтры category=content + section=copy-strings.
 *   2) update(): зовёт AdminSettingsService.set() с user-id и reason.
 *   3) bulkImport(): импортирует все пары; считает успешные записи; ошибка
 *      одной пары не валит всю операцию.
 */

import { describe, expect, it, vi } from 'vitest';

import type { AdminSettingsService } from '../../settings/admin-settings.service';

import { CopyStringsAdminService } from './copy-strings-admin.service';

function buildSettings(
  override: Partial<AdminSettingsService> = {},
): AdminSettingsService {
  const list = vi.fn(
    async (filters: { category?: string; section?: string }) => {
      void filters;
      return [
        {
          key: 'ui.signin.title',
          value: 'Войти',
          category: 'content',
          section: 'copy-strings',
          severity: 'low',
          schemaId: null,
          description: 'Заголовок страницы входа',
          updatedBy: 'user-1',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          comment: null,
        },
      ];
    },
  );
  const set = vi.fn(async () => undefined);
  return { list, set, ...override } as unknown as AdminSettingsService;
}

describe('CopyStringsAdminService', () => {
  it('list(): прокидывает фильтры category=content + section=copy-strings', async () => {
    const settings = buildSettings();
    const svc = new CopyStringsAdminService(settings);
    const res = await svc.list();
    expect(res.items.length).toBe(1);
    expect(res.items[0]?.key).toBe('ui.signin.title');
    expect(res.items[0]?.value).toBe('Войти');
    expect(settings.list).toHaveBeenCalledWith({
      category: 'content',
      section: 'copy-strings',
    });
  });

  it('update(): зовёт AdminSettingsService.set() с user-id и reason', async () => {
    const settings = buildSettings();
    const svc = new CopyStringsAdminService(settings);
    const res = await svc.update('ui.signin.title', 'Sign in', 'user-1', 'A/B-тест');
    expect(res.ok).toBe(true);
    expect(settings.set).toHaveBeenCalledWith('ui.signin.title', 'Sign in', {
      userId: 'user-1',
      reason: 'A/B-тест',
    });
  });

  it('bulkImport(): импортирует все пары, ошибка одной не валит всю операцию', async () => {
    const set = vi.fn(async (key: string) => {
      if (key === 'ui.broken') throw new Error('boom');
    });
    const settings = buildSettings({ set } as Partial<AdminSettingsService>);
    const svc = new CopyStringsAdminService(settings);

    const res = await svc.bulkImport(
      { 'ui.a': 'A', 'ui.broken': 'B', 'ui.c': 'C' },
      'user-1',
      'import',
    );
    expect(res.imported).toBe(2);
    expect(set).toHaveBeenCalledTimes(3);
  });
});
