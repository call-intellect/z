import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Source } from '@prisma/client';

import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { S3Service } from '../../../recordings/s3.service';
import type { SourceTestResultDto } from '../../../sources/dto/source.dto';

import {
  parseMangoConfig,
  type MangoCallConfig,
} from './mango-config.schema';

/**
 * Сервис Mango Office адаптера (Фаза 10 knowledge-core, Шаг 5).
 *
 * Зона ответственности:
 *   - Валидация webhook-подписи Mango (`sha256(apiKey + json + apiSalt)`).
 *   - Резолв Source + расшифровка apiKey/apiSalt.
 *   - Скачивание `recordUrl` (MP3) в S3 `phone-calls/<tenantId>/<callId>.mp3`.
 *
 * NB: на этой фазе НЕ создаём `Meeting(type='phone_call')` — см.
 * `plans/decisions-log.md` 2026-05-10. Хранится только `RawEvent`.
 * Транскрипция и интеграция с `transcribe.queue` — vNext (отдельный
 * воркер `phone-transcribe.worker`).
 */
@Injectable()
export class MangoAdapterService {
  private readonly logger = new Logger(MangoAdapterService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(S3Service) private readonly s3: S3Service,
  ) {}

  async loadActiveSource(sourceId: string): Promise<{
    source: Source;
    config: MangoCallConfig;
    apiKey: string;
    apiSalt: string;
  }> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'source_not_found', message: 'Mango-source не найден' },
      });
    }
    if (source.type !== 'phone_call') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'wrong_source_type', message: 'Source не phone_call' },
      });
    }
    if (!source.isActive) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'source_inactive', message: 'Source отключён' },
      });
    }
    const config = parseMangoConfig(source.config);
    return {
      source,
      config,
      apiKey: this.decryptIfNeeded(config.apiKey),
      apiSalt: this.decryptIfNeeded(config.apiSalt),
    };
  }

  /**
   * Mango подписывает запросы как `sign = sha256(apiKey + json + apiSalt)`,
   * где `json` — `application/x-www-form-urlencoded` form-field. Здесь мы
   * принимаем raw-string `json` (его передаст контроллер) и проверяем.
   */
  verifySignature(input: {
    apiKey: string;
    apiSalt: string;
    json: string;
    presented: string;
  }): boolean {
    const expected = createHash('sha256')
      .update(input.apiKey + input.json + input.apiSalt)
      .digest('hex');
    return expected === input.presented;
  }

  /**
   * Скачивает `recordUrl` из Mango в S3. Возвращает S3-key.
   * Не блокирует основной поток — caller использует try/catch.
   */
  async downloadRecording(input: {
    tenantId: string;
    callId: string;
    recordUrl: string;
  }): Promise<string> {
    const res = await fetch(input.recordUrl);
    if (!res.ok) {
      throw new Error(`Mango recordUrl ${res.status}: ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const key = `phone-calls/${input.tenantId}/${input.callId}.mp3`;
    await this.s3.putObject({ key, body: buf, contentType: 'audio/mpeg' });
    this.logger.log(
      { tenantId: input.tenantId, callId: input.callId, bytes: buf.byteLength },
      'mango: запись звонка сохранена в S3',
    );
    return key;
  }

  /**
   * Smoke-test для UI: подпись на тестовом payload должна сходиться.
   * Возвращает `ok:true`, если расшифровка ключей удалась и подпись считается.
   */
  test(source: Source): SourceTestResultDto {
    if (source.type !== 'phone_call') {
      return { ok: false, errorMessage: 'Source не phone_call' };
    }
    try {
      const cfg = parseMangoConfig(source.config);
      const apiKey = this.decryptIfNeeded(cfg.apiKey);
      const apiSalt = this.decryptIfNeeded(cfg.apiSalt);
      const json = '{"smoke":true}';
      const sign = createHash('sha256')
        .update(apiKey + json + apiSalt)
        .digest('hex');
      return { ok: true, details: { signSample: sign.slice(0, 8) + '…', extensionsCount: cfg.extensions.length } };
    } catch (err) {
      return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
    }
  }

  decryptIfNeeded(value: string): string {
    if (this.crypto.isEncrypted(value)) {
      return this.crypto.decrypt(value);
    }
    return value;
  }
}
