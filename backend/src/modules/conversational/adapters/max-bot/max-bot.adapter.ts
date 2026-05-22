import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  Channel,
  ChannelBinding,
  ChannelKind,
  DataClass,
  Notification,
  NotificationDelivery,
} from '@prisma/client';

import { CryptoService } from '../../../../common/crypto/crypto.service';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ChannelRegistry } from '../../channel-registry';
import { ConversationalLinkCodeService } from '../../link-code.service';
import type {
  ConversationalJson,
  IChannel,
  InboundMessage,
} from '../../types/channel.types';

import { MaxApiClient, MaxApiError } from './max-api-client';
import type {
  MaxBotChannelConfig,
  MaxInlineKeyboardAttachment,
  MaxMessage,
  MaxUpdate,
} from './max.types';

/**
 * MAX Bot ChannelAdapter (SBA β-1).
 *
 * Параллельная реализация `TelegramBotChannelAdapter`. MAX Bot API
 * (dev.max.ru/docs-api, context7 verified 2026-05-22):
 *   - sendMessage:    `POST /messages`
 *   - subscribe webhook: `POST /subscriptions { url }`
 *   - inline keyboard: `attachments[0]={type:'inline_keyboard', payload:{buttons:[[{type:'callback', text, payload}]]}}`
 *   - update types:   `message_created` (новое сообщение боту),
 *                     `message_callback` (нажатие callback-кнопки),
 *                     ... (полный набор уточняется по факту на проде).
 *
 * Внимание: формат webhook-update'а MAX задокументирован в dev.max.ru,
 * но в context7 представлен фрагментарно. Поэтому парсер `ingestUpdate`
 * предусматривает defensive-парсинг по нескольким возможным полям
 * (`sender`/`from`, `chat_id`/`user_id`), а реальная финальная адаптация
 * — после smoke-теста на проде (см. SMOKE.md). Это явный TODO,
 * зафиксированный в final-отчёте β-1.
 *
 * `maxDataClass='internal'` — MAX внешний канал, sensitive/private туда
 * не уходит.
 */
@Injectable()
export class MaxBotChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(MaxBotChannelAdapter.name);
  readonly kind: ChannelKind = 'max_bot';
  readonly maxDataClass: DataClass = 'internal';

  /** Префикс callback payload — должен помещаться в ограниченное поле. */
  static readonly PROBE_CALLBACK_PREFIX = 'pq';

  constructor(
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(MaxApiClient) private readonly api: MaxApiClient,
    @Inject(ConversationalLinkCodeService)
    private readonly linkCode: ConversationalLinkCodeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  // ─────────────────────────────── send ────────────────────────────

  async send(args: {
    delivery: NotificationDelivery;
    notification: Notification;
    binding: ChannelBinding;
    channel: Channel;
  }): Promise<{ externalMessageId: string | null }> {
    const config = this.readChannelConfig(args.channel);
    if (!config.accessToken) {
      throw new Error(
        `MaxBotChannelAdapter.send: accessToken пустой (channelId=${args.channel.id})`,
      );
    }
    const userIdOrChat = args.binding.externalId;
    if (!userIdOrChat) {
      throw new Error(
        `MaxBotChannelAdapter.send: binding.externalId пустой (bindingId=${args.binding.id})`,
      );
    }

    const text = this.renderText(args.notification);
    const attachments = this.renderInlineKeyboard(args.notification);

    try {
      const result = await this.api.sendMessage({
        accessToken: config.accessToken,
        chatId: userIdOrChat,
        text,
        attachments,
      });
      const mid = result.message?.mid ?? null;
      return { externalMessageId: mid };
    } catch (err) {
      if (err instanceof MaxApiError && !err.transient) {
        throw new Error(`max_final:${err.code}:${err.message}`);
      }
      throw err;
    }
  }

  // ─────────────────────────────── ingest ──────────────────────────

  /**
   * IChannel.ingest — заглушка, см. `TelegramBotChannelAdapter.ingest`:
   * у MAX-адаптера нужен tenantId+channel, поэтому webhook controller
   * вызывает `ingestUpdate(...)` напрямую.
   */
  async ingest(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _rawMessage: ConversationalJson,
  ): Promise<InboundMessage> {
    throw new Error(
      'MaxBotChannelAdapter.ingest: используйте ingestUpdate(update, tenantId, channel)',
    );
  }

  async ingestUpdate(args: {
    update: MaxUpdate;
    tenantId: string;
    channel: Channel;
  }): Promise<InboundMessage | null> {
    const { update, tenantId, channel } = args;
    const config = this.readChannelConfig(channel);
    const updateType = update.update_type ?? 'unknown';

    if (updateType === 'message_callback' && update.callback) {
      this.metrics.incMaxBotWebhookReceived({ type: 'message_callback' });
      return this.handleCallback({
        callback: update.callback,
        tenantId,
        channel,
      });
    }

    if (updateType === 'message_created' || update.message) {
      this.metrics.incMaxBotWebhookReceived({
        type: updateType === 'message_created' ? 'message_created' : 'message',
      });
      return this.handleMessage({
        message: update.message,
        tenantId,
        channel,
        config,
      });
    }

    this.metrics.incMaxBotWebhookReceived({ type: updateType || 'unknown' });
    this.logger.debug(
      { updateType },
      'max inbound: неизвестный/неподдерживаемый тип update — игнор',
    );
    return null;
  }

  // ─────────────────────────────── parseResponse (stub) ─────────────

  async parseResponse(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _args: {
      rawMessage: ConversationalJson;
      openProbes: Notification[];
    },
  ): Promise<null> {
    return null;
  }

  // ─────────────────────────────── handlers ────────────────────────

  private async handleMessage(args: {
    message: MaxMessage | undefined;
    tenantId: string;
    channel: Channel;
    config: MaxBotChannelConfig;
  }): Promise<InboundMessage | null> {
    const { message, tenantId, channel, config } = args;
    if (!message) return null;

    const text = (message.body?.text ?? '').trim();
    if (!text) {
      this.logger.debug('max inbound: пустой text — игнор');
      return null;
    }

    const senderId = message.sender?.user_id;
    const chatId = message.recipient?.chat_id ?? senderId;
    if (!senderId || chatId === undefined) {
      this.logger.debug('max inbound: нет sender.user_id или recipient — игнор');
      return null;
    }

    const externalUserId = String(senderId);

    // /link <code> — без binding'а.
    const linkMatch = text.match(/^\/link(?:\s+(.+))?$/i);
    if (linkMatch) {
      this.metrics.incMaxBotWebhookReceived({ type: 'command' });
      const code = linkMatch[1]?.trim();
      await this.handleLink({
        code,
        externalUserId,
        chatId,
        tenantId,
        channel,
        config,
      });
      return null;
    }

    // Все остальные команды требуют binding.
    const binding = await this.prisma.channelBinding.findFirst({
      where: { channelId: channel.id, externalId: externalUserId },
    });
    if (!binding || !binding.verifiedAt) {
      await this.replyToUserBestEffort({
        config,
        chatId,
        text:
          'Аккаунт не привязан. Зайдите в личный кабинет, получите код привязки и отправьте сюда: /link <код>.',
      });
      return null;
    }

    if (text.startsWith('/')) {
      this.metrics.incMaxBotWebhookReceived({ type: 'command' });
      return this.parseSlashCommand({ rawText: text, binding, tenantId });
    }

    return {
      type: 'free_note',
      userId: binding.userId,
      tenantId,
      text,
      metadata: { source: 'max_bot', chatId },
      originChannelBindingId: binding.id,
    };
  }

  private async handleCallback(args: {
    callback: NonNullable<MaxUpdate['callback']>;
    tenantId: string;
    channel: Channel;
  }): Promise<InboundMessage | null> {
    const { callback, tenantId, channel } = args;
    const payload = callback.payload ?? '';
    const senderId = callback.user?.user_id;
    if (!senderId) {
      this.logger.debug('max callback: нет user.user_id — игнор');
      return null;
    }
    const parts = payload.split(':');
    if (parts[0] !== MaxBotChannelAdapter.PROBE_CALLBACK_PREFIX) {
      this.logger.debug({ payload }, 'max callback: неизвестный prefix — игнор');
      return null;
    }
    const notificationId = parts[1];
    const optionIndex = Number(parts[2]);
    if (!notificationId || !Number.isFinite(optionIndex)) {
      this.logger.debug({ payload }, 'max callback: невалидный payload — игнор');
      return null;
    }

    const binding = await this.prisma.channelBinding.findFirst({
      where: { channelId: channel.id, externalId: String(senderId) },
    });
    if (!binding) return null;

    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    let optionText: string | null = null;
    if (notification?.payload && typeof notification.payload === 'object') {
      const options = (notification.payload as { options?: string[] }).options;
      if (Array.isArray(options) && options[optionIndex]) {
        optionText = options[optionIndex];
      }
    }

    return {
      type: 'response',
      userId: binding.userId,
      tenantId,
      notificationId,
      payload: {
        kind: 'option',
        optionIndex,
        optionText,
      },
      originChannelBindingId: binding.id,
    };
  }

  private async handleLink(args: {
    code: string | undefined;
    externalUserId: string;
    chatId: number | string;
    tenantId: string;
    channel: Channel;
    config: MaxBotChannelConfig;
  }): Promise<void> {
    const { code, externalUserId, chatId, tenantId, channel, config } = args;
    if (!code) {
      await this.replyToUserBestEffort({
        config,
        chatId,
        text:
          'Использование: /link <код>. Код берётся в личном кабинете — раздел «Каналы».',
      });
      return;
    }
    const userId = await this.linkCode.consume({ kind: 'max_bot', code });
    if (!userId) {
      await this.replyToUserBestEffort({
        config,
        chatId,
        text: 'Код невалиден или истёк. Получите новый в личном кабинете.',
      });
      return;
    }
    await this.prisma.channelBinding.upsert({
      where: {
        channelId_externalId: {
          channelId: channel.id,
          externalId: externalUserId,
        },
      },
      update: { userId, verifiedAt: new Date() },
      create: {
        userId,
        channelId: channel.id,
        externalId: externalUserId,
        verifiedAt: new Date(),
      },
    });
    this.logger.log(
      `max /link: tenantId=${tenantId} userId=${userId} maxUserId=${externalUserId}`,
    );
    await this.replyToUserBestEffort({
      config,
      chatId,
      text:
        'Готово! Аккаунт привязан. Теперь сюда будут приходить вопросы и уведомления Коры. Доступные команды: /ask, /note, /idea, /status, /myideas, /help.',
    });
  }

  private parseSlashCommand(args: {
    rawText: string;
    binding: ChannelBinding;
    tenantId: string;
  }): InboundMessage | null {
    const { rawText, binding, tenantId } = args;
    const match = rawText.match(/^\/(\w+)(?:\s+([\s\S]+))?$/);
    if (!match) return null;
    const cmd = match[1]!.toLowerCase();
    const tail = match[2]?.trim() ?? '';

    if (cmd === 'ask') {
      if (!tail) {
        return {
          type: 'command',
          userId: binding.userId,
          tenantId,
          commandName: 'help',
          originChannelBindingId: binding.id,
        };
      }
      return {
        type: 'chat_query',
        userId: binding.userId,
        tenantId,
        question: tail,
        originChannelBindingId: binding.id,
      };
    }
    if (cmd === 'note') {
      if (!tail) return null;
      return {
        type: 'free_note',
        userId: binding.userId,
        tenantId,
        text: tail,
        metadata: { source: 'max_bot', command: 'note' },
        originChannelBindingId: binding.id,
      };
    }
    if (cmd === 'idea') {
      if (!tail) return null;
      return {
        type: 'free_note',
        userId: binding.userId,
        tenantId,
        text: tail,
        metadata: { source: 'max_bot', command: 'idea', tag: 'idea' },
        originChannelBindingId: binding.id,
      };
    }
    if (cmd === 'status' || cmd === 'myideas' || cmd === 'help' || cmd === 'start') {
      return {
        type: 'command',
        userId: binding.userId,
        tenantId,
        commandName: cmd === 'start' ? 'help' : cmd,
        args: tail || undefined,
        originChannelBindingId: binding.id,
      };
    }
    return {
      type: 'command',
      userId: binding.userId,
      tenantId,
      commandName: 'help',
      originChannelBindingId: binding.id,
    };
  }

  // ─────────────────────────────── render helpers ───────────────────

  private renderText(notification: Notification): string {
    const payload =
      (notification.payload as Record<string, unknown> | null) ?? {};
    switch (notification.eventType) {
      case 'probe.question': {
        const q = (payload['question'] as string | undefined) ?? '';
        const ctx = (payload['context'] as string | undefined) ?? '';
        return ctx
          ? `Кора уточняет:\n\n${q}\n\n${ctx}`.slice(0, 4000)
          : `Кора уточняет:\n\n${q}`.slice(0, 4000);
      }
      case 'specialist.probe': {
        const msg = (payload['message'] as string | undefined) ?? '';
        const reason = (payload['reason'] as string | undefined) ?? '';
        return `Кора подсказывает (${reason})\n\n${msg}`.slice(0, 4000);
      }
      case 'chat.answer': {
        const text = (payload['text'] as string | undefined) ?? '';
        const cite = (payload['citationsCount'] as number | undefined) ?? 0;
        const tail = cite > 0 ? `\n\nИсточников: ${cite}` : '';
        return `${text}${tail}`.slice(0, 4000);
      }
      case 'curation.pending': {
        const summary = (payload['summary'] as string | undefined) ?? '';
        return `Кора: нужна модерация\n\n${summary}`.slice(0, 4000);
      }
      case 'system.message': {
        const title = (payload['title'] as string | undefined) ?? '';
        const body = (payload['body'] as string | undefined) ?? '';
        return `${title}\n\n${body}`.slice(0, 4000);
      }
      default:
        return `Уведомление: ${notification.eventType}`;
    }
  }

  private renderInlineKeyboard(
    notification: Notification,
  ): MaxInlineKeyboardAttachment[] | undefined {
    const payload = notification.payload as Record<string, unknown> | null;
    if (!payload) return undefined;
    const options = payload['options'];
    if (!Array.isArray(options) || options.length === 0) return undefined;
    const buttons = options.slice(0, 8).map((opt, idx) => [
      {
        type: 'callback' as const,
        text: String(opt).slice(0, 200),
        payload: `${MaxBotChannelAdapter.PROBE_CALLBACK_PREFIX}:${notification.id}:${idx}`,
      },
    ]);
    return [
      {
        type: 'inline_keyboard',
        payload: { buttons },
      },
    ];
  }

  // ─────────────────────────────── config ──────────────────────────

  private readChannelConfig(channel: Channel): MaxBotChannelConfig {
    const raw = channel.config as Record<string, unknown> | null;
    if (!raw) {
      throw new Error(
        `MaxBotChannelAdapter.readChannelConfig: пустой config (channelId=${channel.id})`,
      );
    }
    const tokenEnc = String(raw['accessToken'] ?? '');
    const secretEnc = String(raw['webhookSecret'] ?? '');
    const name = raw['botName'] ? String(raw['botName']) : undefined;
    return {
      accessToken: tokenEnc ? this.decryptIfNeeded(tokenEnc) : '',
      webhookSecret: secretEnc ? this.decryptIfNeeded(secretEnc) : '',
      botName: name,
    };
  }

  readWebhookSecret(channel: Channel): string {
    return this.readChannelConfig(channel).webhookSecret;
  }

  private decryptIfNeeded(value: string): string {
    if (this.crypto.isEncrypted(value)) {
      return this.crypto.decrypt(value);
    }
    return value;
  }

  private async replyToUserBestEffort(args: {
    config: MaxBotChannelConfig;
    chatId: number | string;
    text: string;
  }): Promise<void> {
    if (!args.config.accessToken) return;
    try {
      await this.api.sendMessage({
        accessToken: args.config.accessToken,
        chatId: args.chatId,
        text: args.text,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'max replyToUserBestEffort: sendMessage failed',
      );
    }
  }
}
