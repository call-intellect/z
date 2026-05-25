/**
 * Доменная модель глобальных лимитов / квот для `/admin/platform/limits`.
 * Фаза 8 редизайна Z-Admin.
 *
 * Глобальные лимиты редактируются как обычные `AdminSetting` с префиксом
 * `limits.*` через `useAdminSettingEditor`. Здесь же — каталог тех ключей,
 * которые UI рендерит на первой вкладке «Глобальные».
 */

import { z, type ZodTypeAny } from 'zod';

export type LimitSpec = {
  key: string;
  label: string;
  description?: string;
  schema: ZodTypeAny;
  defaultValue: number;
};

const positiveInt = (def: number, max?: number) => {
  let s = z.number().int().min(1);
  if (typeof max === 'number') s = s.max(max);
  return s.default(def);
};

/**
 * Каталог глобальных лимитов. Список синхронизирован с ENV-переменными
 * `MAX_*` из `backend/src/common/config/env.schema.ts`. Если на бэке такого
 * `AdminSetting` нет — `useAdminSettingEditor` подхватит дефолт отсюда.
 */
export const GLOBAL_LIMITS: LimitSpec[] = [
  {
    key: 'limits.max_meeting_participants',
    label: 'Макс. участников встречи',
    description: 'Жёсткий лимит участников в одной LiveKit-комнате.',
    schema: positiveInt(10),
    defaultValue: 10,
  },
  {
    key: 'limits.max_meeting_duration_minutes',
    label: 'Макс. длительность встречи (мин)',
    description: 'После лимита LiveKit-комната принудительно закрывается.',
    schema: positiveInt(180),
    defaultValue: 180,
  },
  {
    key: 'limits.max_meetings_per_day_global',
    label: 'Макс. встреч в сутки (глобально)',
    description: 'Защита от штормов: не больше N встреч на всю платформу.',
    schema: positiveInt(10000),
    defaultValue: 10000,
  },
  {
    key: 'limits.max_recording_size_mb',
    label: 'Макс. размер записи (МБ)',
    description: 'Egress-задача отклоняет загрузку, если превышен размер.',
    schema: positiveInt(2048),
    defaultValue: 2048,
  },
  {
    key: 'limits.max_upload_file_size_mb',
    label: 'Макс. размер загружаемого файла (МБ)',
    description: 'Применяется ко всем модулям загрузки документов.',
    schema: positiveInt(100),
    defaultValue: 100,
  },
  {
    key: 'limits.max_concurrent_meetings_per_org',
    label: 'Макс. одновременных встреч на Org',
    schema: positiveInt(20),
    defaultValue: 20,
  },
  {
    key: 'limits.max_invites_per_meeting',
    label: 'Макс. приглашений на встречу',
    schema: positiveInt(50),
    defaultValue: 50,
  },
  {
    key: 'limits.max_api_keys_per_org',
    label: 'Макс. API-ключей на Org',
    schema: positiveInt(20),
    defaultValue: 20,
  },
];
