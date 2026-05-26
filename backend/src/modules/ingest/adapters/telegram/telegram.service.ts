import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Source } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { SourceTestResultDto } from '../../../sources/dto/source.dto';

import { parseTelegramConfig } from './telegram-config.schema';

/**
 * Сервис Telegram-адаптера (Фаза 10 knowledge-core).
 *
 *   - `registerWebhook(sourceId)`   — `setWebhook` Bot API при создании/активации.
 *   - `unregisterWebhook(sourceId)` — `deleteWebhook` при отключении.
 *   - `test(source)`                — `getMe` для smoke-теста.
 *   - `getDecryptedToken(source)`   — расшифровывает botToken для контроллера.
 *
 * Bot API: https://api.telegram.org/bot<token>/<method>.
 */
@Injectable()
export class TelegramAdapterService {
  private readonly logger = new Logger(TelegramAdapterService.name);

  static readonly BASE_API = 'https://api.telegram.org';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Полный URL webhook'а для регистрации в Telegram.
   * `https://<host>/api/v1/ingest/telegram/<sourceId>`
   */
  buildWebhookUrl(sourceId: string): string {
    return this.buildHostUrl(`/api/v1/ingest/telegram/${sourceId}`);
  }

  buildHostUrl(path: string): string {
    const host = this.cfg.publicHostUrl.replace(/\/+$/, '');
    return `${host}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  /**
   * Регистрирует webhook у Telegram. Не бросает, только логирует — caller
   * (`SourcesService.afterCreate`) получит fire-and-forget.
   */
  async registerWebhook(sourceId: string): Promise<void> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) {
      this.logger.warn({ sourceId }, 'telegram.registerWebhook: source не найден');
      return;
    }
    const cfg = parseTelegramConfig(source.config);
    const token = this.decryptIfNeeded(cfg.botToken);
    const url = this.buildWebhookUrl(sourceId);
    const body = {
      url,
      secret_token: cfg.webhookSecret,
      allowed_updates: ['message', 'channel_post'],
    };
    const res = await this.callBotApi(token, 'setWebhook', body);
    if (!res.ok) {
      this.logger.warn(
        { sourceId, description: res.description ?? 'unknown' },
        'telegram.registerWebhook: setWebhook failed',
      );
    } else {
      this.logger.log({ sourceId, url }, 'telegram.registerWebhook: ok');
    }
  }

  async unregisterWebhook(sourceId: string): Promise<void> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) return;
    const cfg = parseTelegramConfig(source.config);
    const token = this.decryptIfNeeded(cfg.botToken);
    const res = await this.callBotApi(token, 'deleteWebhook', {
      drop_pending_updates: false,
    });
    if (!res.ok) {
      this.logger.warn(
        { sourceId, description: res.description ?? 'unknown' },
        'telegram.unregisterWebhook: deleteWebhook failed',
      );
    }
  }

  /**
   * Smoke-test: getMe.
   */
  async test(source: Source): Promise<SourceTestResultDto> {
    if (source.type !== 'bot') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'wrong_source_type', message: 'Telegram test работает только для type=bot' },
      });
    }
    const cfg = parseTelegramConfig(source.config);
    const token = this.decryptIfNeeded(cfg.botToken);
    const res = await this.callBotApi(token, 'getMe', undefined);
    if (!res.ok) {
      return { ok: false, errorMessage: res.description ?? 'getMe failed' };
    }
    const result = res.result as { username?: string } | undefined;
    return {
      ok: true,
      details: {
        botUsername: result?.username ?? cfg.botUsername,
        canReceiveUpdates: true,
      },
    };
  }

  /**
   * Резолв Source по id с проверкой type=bot, isActive=true, парсингом config.
   * Бросает 404/400, если не подходит.
   */
  async loadActiveBotSource(sourceId: string): Promise<{
    source: Source;
    config: ReturnType<typeof parseTelegramConfig>;
    botToken: string;
  }> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'source_not_found', message: 'Telegram-source не найден' },
      });
    }
    if (source.type !== 'bot') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'wrong_source_type', message: 'Source не Telegram-бот' },
      });
    }
    if (!source.isActive) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'source_inactive', message: 'Source отключён' },
      });
    }
    const cfg = parseTelegramConfig(source.config);
    return { source, config: cfg, botToken: this.decryptIfNeeded(cfg.botToken) };
  }

  decryptIfNeeded(value: string): string {
    if (this.crypto.isEncrypted(value)) {
      return this.crypto.decrypt(value);
    }
    return value;
  }

  private async callBotApi(
    token: string,
    method: string,
    body: unknown,
  ): Promise<{ ok: boolean; result?: unknown; description?: string }> {
    const url = `${TelegramAdapterService.BASE_API}/bot${token}/${method}`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      this.logger.warn(
        { method, err: err instanceof Error ? err.message : String(err) },
        'telegram.callBotApi: network error',
      );
      return { ok: false, description: err instanceof Error ? err.message : String(err) };
    }
    let json: { ok: boolean; result?: unknown; description?: string };
    try {
      json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
    } catch {
      return { ok: false, description: `non-JSON response: ${res.status}` };
    }
    return json;
  }
}
