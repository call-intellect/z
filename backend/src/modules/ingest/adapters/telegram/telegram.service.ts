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
import { TelegramApiClient } from '../../../conversational/adapters/telegram-bot/telegram-api-client';
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
 * 2026-05-26 (ТЗ plans/tz/2026-05-26-telegram-via-crossmark-proxy.md §3 п.10):
 * транспорт идёт через единый `TelegramApiClient` — он сам выбирает между
 * прокси `telegram.crossmark.ru` и `api.telegram.org`. Дублирующая
 * реализация `callBotApi` удалена.
 *
 * ⚠ Известное ограничение в прокси-режиме: per-source `setWebhook`/
 * `deleteWebhook` будет отвергнут прокси, т.к. прокси пропускает только
 * заранее зарегистрированных в нём ботов (см. /guide). Этот ingest-flow
 * нужно либо отключить (`TELEGRAM_PROXY_ENABLED=false`), либо
 * зарегистрировать бота в админке прокси отдельно. В основном
 * conversational-flow (один глобальный `@kora_bot`) проблемы нет —
 * `setWebhook` дёргает сам прокси при `upsertBot`.
 */
@Injectable()
export class TelegramAdapterService {
  private readonly logger = new Logger(TelegramAdapterService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(TelegramApiClient) private readonly tgApi: TelegramApiClient,
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
    if (this.cfg.telegramProxy.enabled) {
      this.logger.warn(
        { sourceId },
        'telegram.registerWebhook: TELEGRAM_PROXY_ENABLED=true — прокси пропускает только зарегистрированные боты. Per-source ingest setWebhook может вернуть 401/403.',
      );
    }
    try {
      await this.tgApi.setWebhook({
        token,
        url,
        secretToken: cfg.webhookSecret,
        allowedUpdates: ['message'],
      });
      this.logger.log({ sourceId, url }, 'telegram.registerWebhook: ok');
    } catch (err) {
      this.logger.warn(
        { sourceId, err: err instanceof Error ? err.message : String(err) },
        'telegram.registerWebhook: setWebhook failed',
      );
    }
  }

  async unregisterWebhook(sourceId: string): Promise<void> {
    const source = await this.prisma.source.findUnique({ where: { id: sourceId } });
    if (!source) return;
    const cfg = parseTelegramConfig(source.config);
    const token = this.decryptIfNeeded(cfg.botToken);
    try {
      await this.tgApi.deleteWebhook({ token });
    } catch (err) {
      this.logger.warn(
        { sourceId, err: err instanceof Error ? err.message : String(err) },
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
    try {
      const me = await this.tgApi.getMe({ token });
      return {
        ok: true,
        details: {
          botUsername: me.username ?? cfg.botUsername,
          canReceiveUpdates: true,
        },
      };
    } catch (err) {
      return {
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
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
}
