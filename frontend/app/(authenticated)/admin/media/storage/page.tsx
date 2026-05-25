import type { Metadata } from 'next';

import { StorageClient } from './StorageClient';

export const metadata: Metadata = {
  title: 'S3 хранилище — Z-Admin',
};

/**
 * Фаза 7 редизайна — `/admin/media/storage`.
 *
 * Обзор бакетов, статистика по объёмам, переключение провайдера S3
 * (severity='destructive', через AdminDangerZone).
 */
export default function AdminMediaStoragePage() {
  return <StorageClient />;
}
