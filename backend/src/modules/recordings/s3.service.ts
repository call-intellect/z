import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

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
   *
   * `responseContentType` / `responseContentDisposition` перекрывают
   * заголовки в ответе S3 (через `response-content-*` query-параметры) вне
   * зависимости от того, с каким Content-Type объект был залит. Нужно для
   * inline-просмотра видео: egress-загрузка композита нередко проставляет
   * `binary/octet-stream`, из-за чего браузер/Vidstack отказывается проигрывать
   * mp4. Принудительный `video/mp4` + `inline` это лечит.
   */
  async presignGet(
    key: string,
    ttlSeconds?: number,
    opts?: { responseContentType?: string; responseContentDisposition?: string },
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = ttlSeconds ?? this.cfg.s3.presignedTtlSeconds;
    const command = new GetObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: key,
      ...(opts?.responseContentType
        ? { ResponseContentType: opts.responseContentType }
        : {}),
      ...(opts?.responseContentDisposition
        ? { ResponseContentDisposition: opts.responseContentDisposition }
        : {}),
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    this.logger.debug({ key, expiresIn }, 'S3 presignGet OK');
    return { url, expiresAt };
  }

  /**
   * Скачивает объект и возвращает Buffer. Используется AI-pipeline'ом
   * для подсасывания audio-дорожек перед отправкой в Vox.
   */
  async getObject(key: string): Promise<Buffer> {
    this.logger.debug({ key }, 'S3 getObject: читаем объект');
    const command = new GetObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: key,
    });
    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`S3 GetObject: пустой Body для ${key}`);
    }
    // SDK v3 возвращает sdk-stream-mixin — у него есть transformToByteArray().
    const body = response.Body as unknown as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };
    if (typeof body.transformToByteArray === 'function') {
      const bytes = await body.transformToByteArray();
      const buf = Buffer.from(bytes);
      this.logger.debug({ key, sizeBytes: buf.byteLength }, 'S3 getObject OK');
      return buf;
    }
    // Fallback: на NodeJS.Readable. Соберём вручную.
    const stream = response.Body as unknown as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        this.logger.debug({ key, sizeBytes: buf.byteLength }, 'S3 getObject OK (stream)');
        resolve(buf);
      });
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Загружает JSON-объект в S3. Используется AI-pipeline'ом для
   * сохранения transcripts/{track_*, index, merged}.json.
   */
  async putJson(key: string, data: unknown): Promise<void> {
    const body = Buffer.from(JSON.stringify(data), 'utf8');
    this.logger.debug({ key, sizeBytes: body.byteLength }, 'S3 putJson: записываем JSON');
    const command = new PutObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
    });
    await this.client.send(command);
    this.logger.debug({ key }, 'S3 putJson OK');
  }

  /**
   * Загрузка произвольного бинарного объекта (mp4, mp3, zip и т.п.).
   * `contentType` обязателен — без него браузер скачает файл с
   * `application/octet-stream`, что ломает inline-просмотр (видео/аудио).
   */
  async putObject(args: { key: string; body: Buffer; contentType: string }): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    });
    await this.client.send(command);
  }

  /**
   * Скачивает JSON-объект и парсит. Generic — caller типизирует.
   */
  async getJson<T>(key: string): Promise<T> {
    const buffer = await this.getObject(key);
    return JSON.parse(buffer.toString('utf8')) as T;
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
