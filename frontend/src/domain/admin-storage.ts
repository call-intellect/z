/**
 * Доменная модель для `/admin/media/storage` — S3-хранилище (бакеты,
 * статистика, переключение провайдера). Фаза 7 редизайна Z-Admin.
 *
 * Контракт backend: `AdminStorageController` под префиксом
 * `/api/v1/admin/media/storage`. Защита — `SuperAdminGuard`.
 *
 * Переключение провайдера — это `AdminSetting` с ключом `storage.provider`
 * (severity='destructive'), редактируется через `useAdminSettingEditor`,
 * вызывает POST /admin/media/storage/switch.
 */

// ────────────────────────── ApiDto ──────────────────────────

export type StorageProviderApi = 'yandex' | 'selectel' | 'sbercloud' | 'minio';

export type StorageBucketApiDto = {
  name: string;
  provider: StorageProviderApi;
  endpoint: string;
  objectsCount: number;
  /** Размер в байтах. */
  sizeBytes: number;
  /** "ok" | "warning" | "error" | … серверный enum. */
  status: string;
};

export type StorageStatsApiDto = {
  /** Общий объём всех бакетов в байтах. */
  totalBytes: number;
  totalObjects: number;
  /** Прогноз роста за следующий месяц в байтах. null = недостаточно данных. */
  forecastNextMonthBytes: number | null;
  /** Скорость прироста за последние 7 дней (байт/день). */
  growthBytesPerDay: number | null;
  /** Самый «тяжёлый» бакет (по размеру). */
  largestBucket: string | null;
  checkedAt: string;
};

export type StorageOverviewApiDto = {
  currentProvider: StorageProviderApi;
  buckets: StorageBucketApiDto[];
  stats: StorageStatsApiDto;
};

// ────────────────────────── DomainModel ──────────────────────────

export const STORAGE_PROVIDER_LABELS: Record<StorageProviderApi, string> = {
  yandex: 'Yandex Object Storage',
  selectel: 'Selectel S3',
  sbercloud: 'SberCloud OBS',
  minio: 'MinIO (self-hosted)',
};

export type StorageBucketDomain = {
  name: string;
  provider: StorageProviderApi;
  providerLabel: string;
  endpoint: string;
  objectsCount: number;
  sizeBytes: number;
  /** Размер в гигабайтах, округлён до 2 знаков. */
  sizeGB: number;
  status: string;
  /** Локализованная подпись статуса. */
  statusLabel: string;
};

export type StorageStatsDomain = {
  totalBytes: number;
  totalGB: number;
  totalObjects: number;
  forecastNextMonthBytes: number | null;
  forecastNextMonthGB: number | null;
  growthBytesPerDay: number | null;
  growthGBPerDay: number | null;
  largestBucket: string | null;
  checkedAt: Date;
};

export type StorageOverviewDomain = {
  currentProvider: StorageProviderApi;
  currentProviderLabel: string;
  buckets: StorageBucketDomain[];
  stats: StorageStatsDomain;
};

// ────────────────────────── Mappers ──────────────────────────

const BYTES_IN_GB = 1024 ** 3;

function bytesToGB(bytes: number): number {
  return Math.round((bytes / BYTES_IN_GB) * 100) / 100;
}

const STATUS_LABELS: Record<string, string> = {
  ok: 'ок',
  warning: 'предупреждение',
  error: 'ошибка',
  unreachable: 'недоступен',
};

export function storageBucketFromApi(
  api: StorageBucketApiDto,
): StorageBucketDomain {
  return {
    name: api.name,
    provider: api.provider,
    providerLabel: STORAGE_PROVIDER_LABELS[api.provider] ?? api.provider,
    endpoint: api.endpoint,
    objectsCount: api.objectsCount,
    sizeBytes: api.sizeBytes,
    sizeGB: bytesToGB(api.sizeBytes),
    status: api.status,
    statusLabel: STATUS_LABELS[api.status] ?? api.status,
  };
}

export function storageStatsFromApi(
  api: StorageStatsApiDto,
): StorageStatsDomain {
  return {
    totalBytes: api.totalBytes,
    totalGB: bytesToGB(api.totalBytes),
    totalObjects: api.totalObjects,
    forecastNextMonthBytes: api.forecastNextMonthBytes,
    forecastNextMonthGB:
      api.forecastNextMonthBytes !== null
        ? bytesToGB(api.forecastNextMonthBytes)
        : null,
    growthBytesPerDay: api.growthBytesPerDay,
    growthGBPerDay:
      api.growthBytesPerDay !== null ? bytesToGB(api.growthBytesPerDay) : null,
    largestBucket: api.largestBucket,
    checkedAt: new Date(api.checkedAt),
  };
}

export function storageOverviewFromApi(
  api: StorageOverviewApiDto,
): StorageOverviewDomain {
  return {
    currentProvider: api.currentProvider,
    currentProviderLabel:
      STORAGE_PROVIDER_LABELS[api.currentProvider] ?? api.currentProvider,
    buckets: api.buckets.map(storageBucketFromApi),
    stats: storageStatsFromApi(api.stats),
  };
}
