import {
  ListObjectsV2Command,
  S3Client,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { AdminSettingsService } from '../../settings/admin-settings.service';

import type {
  BucketStatsDto,
  StorageStatsResponseDto,
  SwitchProviderResponseDto,
} from './dto/admin-storage.dto';

@Injectable()
export class AdminStorageService {
  private readonly logger = new Logger(AdminStorageService.name);
  private s3Client: S3Client | null = null;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  async listBuckets(): Promise<BucketStatsDto[]> {
    const s3 = this.cfg.s3;
    const bucketName = s3.bucket;
    if (!bucketName) {
      return [];
    }

    const stat = await this.statBucket(bucketName);
    return [stat];
  }

  async getStats(): Promise<StorageStatsResponseDto> {
    const buckets = await this.listBuckets();
    const totalObjects = buckets.reduce((sum, b) => sum + b.objectsCount, 0);
    const totalBytes = buckets.reduce((sum, b) => sum + b.bytesTotal, 0);
    return {
      buckets,
      totalObjects,
      totalBytes,
      collectedAt: new Date().toISOString(),
    };
  }

  async switchProvider(args: {
    provider: string;
    reason: string;
    userId: string;
  }): Promise<SwitchProviderResponseDto> {
    await this.settings.set('storage.provider', args.provider, {
      userId: args.userId,
      reason: args.reason,
    });
    this.logger.warn(
      `admin-storage: storage.provider → ${args.provider} (user=${args.userId}, reason="${args.reason}"). ` +
        'Маркер обновлён, реальный endpoint требует смены S3_ENDPOINT_URL в ENV + рестарта.',
    );
    return {
      ok: true,
      provider: args.provider,
      appliedAt: new Date().toISOString(),
    };
  }

  private async statBucket(bucket: string): Promise<BucketStatsDto> {
    const s3 = this.cfg.s3;
    const endpoint = s3.endpointUrl ?? '';
    const region = s3.region ?? null;

    try {
      const client = this.getClient();
      const output = (await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 1000,
        }),
      )) as ListObjectsV2CommandOutput;

      const contents = output.Contents ?? [];
      const objectsCount = contents.length;
      const bytesTotal = contents.reduce((sum, obj) => sum + Number(obj.Size ?? 0), 0);
      const truncated = output.IsTruncated === true;

      return {
        name: bucket,
        endpoint,
        region,
        objectsCount,
        bytesTotal,
        truncated,
        ok: true,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, bucket }, 'admin-storage: ListObjectsV2 failed');
      return {
        name: bucket,
        endpoint,
        region,
        objectsCount: 0,
        bytesTotal: 0,
        truncated: false,
        ok: false,
        error: message,
      };
    }
  }

  private getClient(): S3Client {
    if (!this.s3Client) {
      const s3 = this.cfg.s3;
      this.s3Client = new S3Client({
        region: s3.region,
        endpoint: s3.endpointUrl,
        credentials: {
          accessKeyId: s3.accessKey,
          secretAccessKey: s3.secretKey,
        },
        forcePathStyle: true,
      });
    }
    return this.s3Client;
  }
}
