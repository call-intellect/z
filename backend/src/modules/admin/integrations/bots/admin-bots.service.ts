import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import type { Channel } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { TelegramApiClient } from '../../../conversational/adapters/telegram-bot/telegram-api-client';
import { MaxApiClient } from '../../../conversational/adapters/max-bot/max-api-client';
import { AdminSettingsService } from '../../settings/admin-settings.service';

import type {
  BotStatusResponseDto,
  BotWebhookActionResponseDto,
  EmailInboxStatusResponseDto,
  EmailInboxTestResponseDto,
  MaskedSecret,
} from './dto/admin-bots.dto';

/**
 * Admin-redesign Фаза 6 — `AdminBotsService`.
 *
 * Источник истины для conversational-ботов из админки Z:
 *   - глобальный Telegram-бот: `Channel WHERE tenantId IS NULL AND kind='telegram_bot'`.
 *   - глобальный MAX-бот: `Channel WHERE tenantId IS NULL AND kind='max_bot'`.
 *   - email-inbox (IMAP) — пока только read-only ENV-снапшот; реальный
 *     ImapClient в коде есть (см. mail-inbox/), но тест-коннект — заглушка
 *     (TODO + 501) до отдельного ТЗ.
 *
 * Семантика commands:
 *   - set-webhook: вызываем Telegram API `setWebhook` / MAX API
 *     `subscribeWebhook`. URL по умолчанию — `${publicHostUrl}/api/v1/webhooks/<...>`.
 *   - delete-webhook: Telegram `deleteWebhook` / MAX `unsubscribeWebhook` по
 *     уже записанному в `Channel.config.webhookUrl`.
 *
 * Безопасность:
 *   - Токены никогда не возвращаем наружу — только masked.
 *   - Декриптуем из `Channel.config` через `CryptoService.decrypt` с
 *     legacy-fallback на plain-token.
 */
@Injectable()
export class AdminBotsService {
  private readonly logger = new Logger(AdminBotsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(TelegramApiClient) private readonly telegramApi: TelegramApiClient,
    @Inject(MaxApiClient) private readonly maxApi: MaxApiClient,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  // ─────────────────────────── telegram ────────────────────────────────

  async getTelegramStatus(): Promise<BotStatusResponseDto> {
    const channel = await this.findGlobalChannel('telegram_bot');
    const tokenEnc = channel ? this.readEncField(channel, 'botToken') : '';
    const decryptedToken = tokenEnc ? this.tryDecrypt(tokenEnc) : '';
    const rps = await this.readGlobalRps('telegram');
    const quietHours = await this.readQuietHours('telegram');

    return {
      kind: 'telegram',
      channelExists: !!channel,
      token: this.maskToken(decryptedToken),
      webhookUrl: channel ? this.readStrField(channel, 'webhookUrl') : null,
      lastWebhookAt: null,
      globalRps: rps,
      quietHours,
      status: channel?.status ?? null,
      apiBase: this.cfg.telegramBot.apiBase,
    };
  }

  async setTelegramWebhook(args: {
    url?: string;
  }): Promise<BotWebhookActionResponseDto> {
    const channel = await this.findGlobalChannel('telegram_bot');
    if (!channel) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message:
            'Глобальный канал Telegram-бота ещё не создан. Сначала задайте токен в /admin/system/telegram-bot.',
        },
      });
    }
    const token = this.tryDecrypt(this.readEncField(channel, 'botToken'));
    if (!token) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'token_not_set',
          message: 'Токен бота не установлен.',
        },
      });
    }
    const webhookUrl = (args.url ?? this.computeTelegramWebhookUrl()).trim();
    this.assertHttps(webhookUrl);
    const secret = this.tryDecrypt(this.readEncField(channel, 'webhookSecret'));
    if (!secret) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'webhook_secret_missing',
          message:
            'Секрет webhook не задан. Сначала «Перенастроить webhook» в /admin/system/telegram-bot — он сгенерирует секрет.',
        },
      });
    }
    try {
      await this.telegramApi.setWebhook({
        token,
        url: webhookUrl,
        secretToken: secret,
      });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'telegram_set_webhook_failed',
          message: `Telegram отверг setWebhook: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        },
      });
    }
    await this.updateConfig(channel, (cur) => ({
      ...cur,
      webhookUrl,
    }));
    this.logger.log(
      `admin: Telegram setWebhook → ${webhookUrl} (channelId=${channel.id})`,
    );
    return {
      ok: true,
      webhookUrl,
      appliedAt: new Date().toISOString(),
    };
  }

  async deleteTelegramWebhook(): Promise<BotWebhookActionResponseDto> {
    const channel = await this.findGlobalChannel('telegram_bot');
    if (!channel) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: 'Глобальный канал Telegram-бота ещё не создан.',
        },
      });
    }
    const token = this.tryDecrypt(this.readEncField(channel, 'botToken'));
    if (!token) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'token_not_set',
          message: 'Токен бота не установлен — нечего удалять.',
        },
      });
    }
    try {
      await this.telegramApi.deleteWebhook({ token });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'telegram_delete_webhook_failed',
          message: `Telegram отверг deleteWebhook: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        },
      });
    }
    await this.updateConfig(channel, (cur) => {
      const next = { ...cur };
      delete next['webhookUrl'];
      return next;
    });
    this.logger.log(`admin: Telegram deleteWebhook channelId=${channel.id}`);
    return {
      ok: true,
      webhookUrl: null,
      appliedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────── max ─────────────────────────────────────

  async getMaxStatus(): Promise<BotStatusResponseDto> {
    const channel = await this.findGlobalChannel('max_bot');
    const tokenEnc = channel
      ? this.readEncField(channel, 'accessToken')
      : '';
    const decryptedToken = tokenEnc ? this.tryDecrypt(tokenEnc) : '';
    const rps = await this.readGlobalRps('max');
    const quietHours = await this.readQuietHours('max');

    return {
      kind: 'max',
      channelExists: !!channel,
      token: this.maskToken(decryptedToken),
      webhookUrl: channel ? this.readStrField(channel, 'webhookUrl') : null,
      lastWebhookAt: null,
      globalRps: rps,
      quietHours,
      status: channel?.status ?? null,
      apiBase: this.cfg.maxBot.apiBase,
    };
  }

  async setMaxWebhook(args: {
    url?: string;
  }): Promise<BotWebhookActionResponseDto> {
    const channel = await this.findGlobalChannel('max_bot');
    if (!channel) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message:
            'Глобальный канал MAX-бота ещё не создан. Создайте per-tenant канал или подготовьте глобальную запись.',
        },
      });
    }
    const accessToken = this.tryDecrypt(
      this.readEncField(channel, 'accessToken'),
    );
    if (!accessToken) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'token_not_set',
          message: 'Access token MAX-бота не установлен.',
        },
      });
    }
    const webhookUrl = (args.url ?? this.computeMaxWebhookUrl()).trim();
    this.assertHttps(webhookUrl);
    try {
      await this.maxApi.subscribeWebhook({ accessToken, url: webhookUrl });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'max_subscribe_webhook_failed',
          message: `MAX отверг subscribe: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        },
      });
    }
    await this.updateConfig(channel, (cur) => ({
      ...cur,
      webhookUrl,
    }));
    this.logger.log(
      `admin: MAX subscribeWebhook → ${webhookUrl} (channelId=${channel.id})`,
    );
    return {
      ok: true,
      webhookUrl,
      appliedAt: new Date().toISOString(),
    };
  }

  async deleteMaxWebhook(): Promise<BotWebhookActionResponseDto> {
    const channel = await this.findGlobalChannel('max_bot');
    if (!channel) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'channel_not_configured',
          message: 'Глобальный канал MAX-бота ещё не создан.',
        },
      });
    }
    const accessToken = this.tryDecrypt(
      this.readEncField(channel, 'accessToken'),
    );
    if (!accessToken) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'token_not_set',
          message: 'Access token MAX-бота не установлен — нечего удалять.',
        },
      });
    }
    const webhookUrl = this.readStrField(channel, 'webhookUrl');
    if (!webhookUrl) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'webhook_url_unknown',
          message:
            'В config канала не записан webhookUrl — MAX-API требует точный URL для unsubscribe.',
        },
      });
    }
    try {
      await this.maxApi.unsubscribeWebhook({ accessToken, url: webhookUrl });
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'max_unsubscribe_webhook_failed',
          message: `MAX отверг unsubscribe: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`,
        },
      });
    }
    await this.updateConfig(channel, (cur) => {
      const next = { ...cur };
      delete next['webhookUrl'];
      return next;
    });
    this.logger.log(`admin: MAX unsubscribeWebhook channelId=${channel.id}`);
    return {
      ok: true,
      webhookUrl: null,
      appliedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────── email inbox ────────────────────────────

  async getEmailInboxStatus(): Promise<EmailInboxStatusResponseDto> {
    const mi = this.cfg.mailInbox;
    return {
      enabled: !!mi.enabled,
      host: mi.imapHost ?? null,
      port: mi.imapPort ?? null,
      user: mi.imapUser ?? null,
      tls: !!mi.imapTls,
      folder: mi.imapFolder ?? null,
      pollCron: mi.pollCron ?? null,
      maxPerRun: mi.maxPerRun ?? null,
      domain: mi.domain ?? null,
      // TODO: завести `AdminSetting` `mailInbox.lastFetchAt` либо метрику
      //       Prometheus → таскать её сюда через AlertingService. На текущей
      //       фазе админка показывает null + подпись «настройте метрику».
      lastFetchAt: null,
    };
  }

  async testEmailInboxConnection(): Promise<EmailInboxTestResponseDto> {
    // ImapClient как готовый класс в проекте не выделен — поллер сидит в
    // mail-inbox и собирается через `imapflow` напрямую внутри cron. Чтобы
    // не дублировать конструкцию (риск падения на dev'е), на этой фазе
    // отдаём 501 с понятным сообщением. Отдельным ТЗ можно вынести
    // ImapClient как сервис и вернуться сюда.
    throw new NotImplementedException({
      ok: false,
      error: {
        code: 'imap_test_not_implemented',
        message:
          'Тест IMAP-коннекта ещё не подключён. Проверьте `MAIL_INBOX_*` ENV и логи `ImapPollCron` — поллер логирует connect-ошибки.',
      },
    });
  }

  // ─────────────────────────── helpers ─────────────────────────────────

  private async findGlobalChannel(
    kind: 'telegram_bot' | 'max_bot',
  ): Promise<Channel | null> {
    return this.prisma.channel.findFirst({
      where: { tenantId: null, kind },
    });
  }

  private async updateConfig(
    channel: Channel,
    mutate: (cur: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const cur = (channel.config as Record<string, unknown> | null) ?? {};
    const next = mutate(cur);
    await this.prisma.channel.update({
      where: { id: channel.id },
      data: { config: next as object },
    });
  }

  private readEncField(channel: Channel, field: string): string {
    const cfg = (channel.config as Record<string, unknown> | null) ?? {};
    const value = cfg[field];
    return typeof value === 'string' ? value : '';
  }

  private readStrField(channel: Channel, field: string): string | null {
    const cfg = (channel.config as Record<string, unknown> | null) ?? {};
    const value = cfg[field];
    return typeof value === 'string' && value ? value : null;
  }

  private tryDecrypt(value: string): string {
    if (!value) return '';
    if (!this.crypto.isEncrypted(value)) return value;
    try {
      return this.crypto.decrypt(value);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'admin-bots: decrypt failed — считаем пустым',
      );
      return '';
    }
  }

  private maskToken(token: string): MaskedSecret {
    if (!token) {
      return { isSet: false, lastChars: null };
    }
    const lastChars =
      token.length <= 4 ? `****${token}` : `****${token.slice(-4)}`;
    return { isSet: true, lastChars };
  }

  private computeTelegramWebhookUrl(): string {
    const base = this.cfg.publicHostUrl.replace(/\/+$/, '');
    return `${base}/api/v1/webhooks/telegram-bot`;
  }

  private computeMaxWebhookUrl(): string {
    const base = this.cfg.publicHostUrl.replace(/\/+$/, '');
    return `${base}/api/v1/webhooks/max-bot`;
  }

  private assertHttps(url: string): void {
    if (!/^https:\/\//i.test(url)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'webhook_url_invalid',
          message: 'Webhook URL должен начинаться с https://',
        },
      });
    }
  }

  /**
   * RPS читаем сначала из AdminSetting, потом из ENV. Это позволяет
   * переключать лимит без рестарта (см. ТЗ §3 «AdminSetting → ENV
   * fallback»).
   */
  private async readGlobalRps(kind: 'telegram' | 'max'): Promise<number> {
    const key = `conversational.${kind}_bot_global_rps`;
    const dynamic = await this.settings.get<number>(key);
    if (typeof dynamic === 'number' && Number.isFinite(dynamic)) {
      return dynamic;
    }
    return kind === 'telegram'
      ? this.cfg.telegramBot.globalRps
      : this.cfg.maxBot.globalRps;
  }

  private async readQuietHours(
    kind: 'telegram' | 'max',
  ): Promise<string | null> {
    const key = `conversational.${kind}_quiet_hours`;
    const value = await this.settings.get<string>(key);
    return typeof value === 'string' && value ? value : null;
  }
}
