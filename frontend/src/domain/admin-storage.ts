export type StorageProviderApi = "yandex" | "selectel" | "sbercloud" | "minio";

export type StorageBucketApiDto = {
  name: string;
  provider: StorageProviderApi;
  endpoint: string;
  objectsCount: number;
  sizeBytes: number;
  status: string;
};

export type StorageStatsApiDto = {
  totalBytes: number;
  totalObjects: number;
  forecastNextMonthBytes: number | null;
  growthBytesPerDay: number | null;
  largestBucket: string | null;
  checkedAt: string;
};

export type StorageOverviewApiDto = {
  currentProvider: StorageProviderApi;
  buckets: StorageBucketApiDto[];
  stats: StorageStatsApiDto;
};

export const STORAGE_PROVIDER_LABELS: Record<StorageProviderApi, string> = {
  yandex: "Yandex Object Storage",
  selectel: "Selectel S3",
  sbercloud: "SberCloud OBS",
  minio: "MinIO (self-hosted)",
};

export type StorageBucketDomain = {
  name: string;
  provider: StorageProviderApi;
  providerLabel: string;
  endpoint: string;
  objectsCount: number;
  sizeBytes: number;
  sizeGB: number;
  status: string;
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

const BYTES_IN_GB = 1024 ** 3;

function bytesToGB(bytes: number): number {
  return Math.round((bytes / BYTES_IN_GB) * 100) / 100;
}

const STATUS_LABELS: Record<string, string> = {
  ok: "ок",
  warning: "предупреждение",
  error: "ошибка",
  unreachable: "недоступен",
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
