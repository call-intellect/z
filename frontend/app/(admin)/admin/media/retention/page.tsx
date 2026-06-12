import type { Metadata } from 'next';

import { RetentionClient } from './RetentionClient';

export const metadata: Metadata = {
  title: 'Сроки хранения',
};

/**
 * Фаза 7 редизайна — `/admin/media/retention`.
 *
 * Управление политиками retention: записи встреч, журналы доступа,
 * доставки webhook, soft-delete grace. UI через RetentionClient.
 */
export default function AdminMediaRetentionPage() {
  return <RetentionClient />;
}
