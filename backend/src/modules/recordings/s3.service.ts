import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { TypedConfigService } from '../../common/config/index';

/**
 * Тонкий S3-клиент для работы с записями встреч.
 *
 *   - `presignGet` — выдача временного URL host'у/партнёру для скачивания.
 *   - `delete`     — массовое удаление по ключам (cron retention + ручное удаление host'ом).
 *
 * Конфиг — из `cfg.s3.*`. `forcePathStyle: true` — обязательно для MinIO/Selectel/SberCloud.
 */
@Injectable()
export class S3Service implements OnModuleDestroy {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {
    this.client = new S3Client({
      region: this.cfg.s3.region,
      endpoint: this.cfg.s3.endpointUrl,
      credentials: {
        accessKeyId: this.cfg.s3.accessKey,
        secretAccessKey: this.cfg.s3.secretKey,
      },
      forcePathStyle: true,
    });
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  /**
   * Возвращает presigned URL для скачивания (`GetObject`).
   * `ttlSeconds` по умолчанию — `cfg.s3.presignedTtlSeconds`.
   */
  async presignGet(
    key: string,
    ttlSeconds?: number,
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = ttlSeconds ?? this.cfg.s3.presignedTtlSeconds;
    const command = new GetObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    return { url, expiresAt };
  }

  /**
   * Массовое удаление. AWS S3 `DeleteObjects` принимает до 1000 за вызов —
   * на наших объёмах одна запись = composite + ≤10 audio-треков, что в один
   * batch помещается с запасом.
   *
   * Если массив пустой — no-op.
   */
  async delete(keys: string[]): Promise<void> {
    const filtered = keys.filter((k) => k.length > 0);
    if (filtered.length === 0) return;

    const command = new DeleteObjectsCommand({
      Bucket: this.cfg.s3.bucket,
      Delete: {
        Objects: filtered.map((Key) => ({ Key })),
        Quiet: true,
      },
    });
    const result = await this.client.send(command);
    if (result.Errors && result.Errors.length > 0) {
      this.logger.warn(
        { errors: result.Errors.map((e) => ({ key: e.Key, code: e.Code })) },
        'S3 DeleteObjects: часть объектов не удалилась',
      );
    } else {
      this.logger.debug(
        { count: filtered.length },
        'S3 DeleteObjects: успешно',
      );
    }
  }
}
