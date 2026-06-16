import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';

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

  async presignGet(
    key: string,
    ttlSeconds?: number,
    opts?: { responseContentType?: string; responseContentDisposition?: string },
  ): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = ttlSeconds ?? this.cfg.s3.presignedTtlSeconds;
    const command = new GetObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: key,
      ...(opts?.responseContentType ? { ResponseContentType: opts.responseContentType } : {}),
      ...(opts?.responseContentDisposition
        ? { ResponseContentDisposition: opts.responseContentDisposition }
        : {}),
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    this.logger.debug({ key, expiresIn }, 'S3 presignGet OK');
    return { url, expiresAt };
  }

  async presignPut(key: string, contentType: string, ttlSeconds = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
    this.logger.debug({ key, expiresIn: ttlSeconds, contentType }, 'S3 presignPut OK');
    return url;
  }

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
    const body = response.Body as unknown as {
      transformToByteArray?: () => Promise<Uint8Array>;
    };
    if (typeof body.transformToByteArray === 'function') {
      const bytes = await body.transformToByteArray();
      const buf = Buffer.from(bytes);
      this.logger.debug({ key, sizeBytes: buf.byteLength }, 'S3 getObject OK');
      return buf;
    }
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

  async putObject(args: { key: string; body: Buffer; contentType: string }): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.cfg.s3.bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
    });
    await this.client.send(command);
  }

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const resp = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.cfg.s3.bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    this.logger.debug({ prefix, count: keys.length }, 'S3 listKeys OK');
    return keys;
  }

  async getJson<T>(key: string): Promise<T> {
    const buffer = await this.getObject(key);
    return JSON.parse(buffer.toString('utf8')) as T;
  }

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
      this.logger.debug({ count: filtered.length }, 'S3 DeleteObjects: успешно');
    }
  }
}
