/**
 * Доменная модель настроек безопасности для `/admin/platform/security`.
 * Фаза 8 редизайна Z-Admin.
 *
 * Все значения — это обычные `AdminSetting` с префиксом `security.*`.
 * UI редактирует их через `useAdminSettingEditor` (severity='high').
 *
 * Ротация IP-salt — отдельный POST-эндпоинт.
 */

import { z, type ZodTypeAny } from 'zod';

export type SecuritySpec = {
  key: string;
  label: string;
  description?: string;
  schema: ZodTypeAny;
  defaultValue: number;
};

const positiveInt = (def: number, min = 1, max?: number) => {
  let s = z.number().int().min(min);
  if (typeof max === 'number') s = s.max(max);
  return s.default(def);
};

/**
 * Параметры Argon2id и TTL-сессий/диплинков. Значения соответствуют дефолтам
 * `backend/src/common/config/env.schema.ts` (ARGON_*, SESSION_TTL_SECONDS,
 * DEEP_LINK_TTL_SECONDS).
 */
export const SECURITY_SETTINGS: SecuritySpec[] = [
  {
    key: 'security.argon_memory_kb',
    label: 'Argon2: память (КБ)',
    description: 'Объём RAM для одного hash-вызова. Чем больше — тем дольше brute-force.',
    schema: positiveInt(65536, 1024, 2_097_152),
    defaultValue: 65536,
  },
  {
    key: 'security.argon_iterations',
    label: 'Argon2: итераций',
    description: 'Количество проходов. Влияет на CPU-время.',
    schema: positiveInt(3, 1, 20),
    defaultValue: 3,
  },
  {
    key: 'security.argon_parallelism',
    label: 'Argon2: параллелизм',
    description: 'Сколько потоков использовать. Должно соответствовать числу ядер.',
    schema: positiveInt(1, 1, 32),
    defaultValue: 1,
  },
  {
    key: 'security.session_ttl_seconds',
    label: 'TTL сессии (сек)',
    description: 'Срок жизни access-cookie. После — пользователь идёт по refresh-flow.',
    schema: positiveInt(3600, 60, 60 * 60 * 24 * 30),
    defaultValue: 3600,
  },
  {
    key: 'security.deep_link_ttl_seconds',
    label: 'TTL deep-link (сек)',
    description: 'Срок жизни одноразовой ссылки (magic-link, invite, share).',
    schema: positiveInt(600, 60, 60 * 60 * 24 * 7),
    defaultValue: 600,
  },
];
