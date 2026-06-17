import { z } from 'zod';

export const SwitchProviderSchema = z.object({
  provider: z.enum(['yandex', 'selectel', 'sbercloud', 'minio']),
  reason: z.string().trim().min(10).max(1000),
});
export type SwitchProviderDto = z.infer<typeof SwitchProviderSchema>;

export interface BucketStatsDto {
  name: string;
  endpoint: string;
  region: string | null;
  objectsCount: number;
  bytesTotal: number;
  truncated: boolean;
  ok: boolean;
  error: string | null;
}

export interface StorageStatsResponseDto {
  buckets: BucketStatsDto[];
  totalObjects: number;
  totalBytes: number;
  collectedAt: string;
}

export interface SwitchProviderResponseDto {
  ok: true;
  provider: string;
  appliedAt: string;
}
