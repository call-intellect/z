/**
 * API-клиент для глоссария и UI-строк — Z-Admin Фаза 5.
 *
 * Записи хранятся в `AdminSetting` с `category='content'`, `section` —
 * либо `'copy-strings'` (UI-копия), либо `'glossary'` (термины). value у
 * обеих секций — обычная строка.
 *
 * Получение списка идёт через существующий `/api/v1/admin/settings?category=content`
 * (с опциональным `section`). Запись — через `useAdminSettingEditor` или
 * прямой POST на `/admin/settings/:key`.
 *
 * Бэкенд этих секций может быть ещё не засеян — фронт показывает
 * `AdminEmpty` с подсказкой про bulk-import.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';

export type AdminSettingRowApi = {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: string;
  schemaId: string | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
  comment: string | null;
};

export const COPY_SECTIONS = {
  GLOSSARY: 'glossary',
  UI_STRINGS: 'copy-strings',
} as const;

export type CopySection =
  (typeof COPY_SECTIONS)[keyof typeof COPY_SECTIONS];

export const adminCopyStringsApi = {
  /** Список admin-settings в категории content / section. */
  list: (section?: CopySection) =>
    apiClient.get<AdminSettingRowApi[]>(
      `/api/v1/admin/settings${buildQuery({
        category: 'content',
        section: section ?? '',
      })}`,
    ),

  /** Прямое сохранение значения (используется, если не задействуем editor-хук). */
  set: (key: string, value: string, reason?: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}`,
      reason ? { value, reason } : { value },
    ),
};
