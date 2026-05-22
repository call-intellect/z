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

import { TelegramApiClient, TelegramApiError } from './telegram-api-client';
import type {
  TelegramBotChannelConfig,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramUpdate,
} from './telegram.types';

/**
 * Telegram Bot ChannelAdapter (SBA β-1).
 *
 * Outbound:
 *   - расшифровывает per-tenant `botToken` из `Channel.config`;
 *   - формирует HTML-сообщение + inline-кнопки (если `payload.options`);
 *   - вызывает `sendMessage` через `TelegramApiClient`;
 *   - возвращает `<chatId>:<messageId>` как `externalMessageId` для
 *     trace'а и для последующего матчинга reply'ев.
 *
 * Inbound:
 *   - принимает `TelegramUpdate` из webhook controller'а;
 *   - извлекает `from.id` → ищет `ChannelBinding` (verified);
 *   - если нет binding'а — обрабатывает `/link <code>` (через
 *     `ConversationalLinkCodeService`) или мягко просит привязаться;
 *   - если есть binding — маршрутизирует:
 *       `/ask <q>`     → `InboundMessage{type:'chat_query'}`,
 *       `/note <t>`    → `{type:'free_note'}`,
 *       `/idea <t>`    → `{type:'free_note', metadata:{tag:'idea'}}`,
 *       `/status`      → `{type:'command', commandName:'status'}`,
 *       `/myideas`     → `{type:'command', commandName:'myideas'}`,
 *       `/help`        → `{type:'command', commandName:'help'}`,
 *       callback_query → `{type:'response', notificationId, payload}`,
 *       reply на наше outbound-сообщение → попытка `parseResponse`,
 *       свободный текст → `{type:'free_note'}` (по умолчанию).
 *
 * `maxDataClass='internal'` — Telegram внешний канал, sensitive/private
 * payload'ы туда не уходят (правило фильтрации в routing'е).
 *
 * Контракт `IChannel.send/ingest/parseResponse` совместим с тем,
 * что уже умеет α-1 (см. `ConversationalSendWorker`).
 */
@Injectable()
export class TelegramBotChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(TelegramBotChannelAdapter.name);
  readonly kind: ChannelKind = 'telegram_bot';
  readonly maxDataClass: DataClass = 'internal';

  /** Префикс callback_data для probe-вариантов: `pq:<notifId>:<idx>`. */
  static readonly PROBE_CALLBACK_PREFIX = 'pq';

  constructor(
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TelegramApiClient) private readonly api: TelegramApiClient,
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
    if (!config.botToken) {
      throw new Error(
        `TelegramBotChannelAdapter.send: botToken пустой в channel.config (channelId=${args.channel.id})`,
      );
    }

    const chatId = args.binding.externalId;
    if (!chatId) {
      throw new Error(
        `TelegramBotChannelAdapter.send: binding.externalId пустой (bindingId=${args.binding.id})`,
      );
    }

    const text = this.renderText(args.notification);
    const replyMarkup = this.renderInlineKeyboard(args.notification);
    const replyToMessageId = this.maybeReplyToMessageId(args.delivery);

    try {
      const { messageId, chatId: rcvChatId } = await this.api.sendMessage({
        token: config.botToken,
        chatId,
        text,
        parseMode: 'HTML',
        replyMarkup,
        replyToMessageId,
      });
      return { externalMessageId: `${rcvChatId}:${messageId}` };
    } catch (err) {
      if (err instanceof TelegramApiError && !err.transient) {
        // Final fail — выбрасываем как Error, чтобы worker сразу пометил
        // delivery=failed без retry (TelegramApiError содержит описание).
        throw new Error(`telegram_final:${err.code}:${err.message}`);
      }
      throw err;
    }
  }

  // ─────────────────────────────── ingest ──────────────────────────

  /**
   * `IChannel.ingest` для совместимости. Telegram-адаптеру нужен `tenantId`
   * + `channel` (per-tenant config), которых нет в этой сигнатуре —
   * поэтому webhook controller вызывает напрямую `ingestUpdate(...)`.
   * Этот же метод оставлен «на крайний случай» и просто бросает явную
   * ошибку, чтобы случайный вызов был заметен.
   */
  async ingest(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _rawMessage: ConversationalJson,
  ): Promise<InboundMessage> {
    throw new Error(
      'TelegramBotChannelAdapter.ingest: используйте ingestUpdate(update, tenantId, channel) — IChannel.ingest не вызывается напрямую для telegram',
    );
  }

  /**
   * Главный inbound-метод для webhook controller'а. Принимает Update
   * + tenantId (резолвится из URL). Возвращает InboundMessage или null
   * (например, voice → null + сам адаптер отправит уведомление).
   */
  async ingestUpdate(args: {
    update: TelegramUpdate;
    tenantId: string;
    channel: Channel;
  }): Promise<InboundMessage | null> {
    const { update, tenantId, channel } = args;
    const config = this.readChannelConfig(channel);

    // 1. callback_query (нажатие inline-кнопки) — самый ценный inbound.
    if (update.callback_query) {
      this.metrics.incTelegramBotWebhookReceived({ type: 'callback_query' });
      return this.handleCallbackQuery({
        callbackQuery: update.callback_query,
        tenantId,
        channel,
        config,
      });
    }

    // 2. message / edited_message — текст. edited_message трактуем как
    // новое сообщение (бот не показывает «отредактированные» отдельно).
    const msg = update.message ?? update.edited_message;
    if (!msg) {
      this.metrics.incTelegramBotWebhookReceived({ type: 'unknown' });
      this.logger.debug({ updateId: update.update_id }, 'telegram inbound: пустой update');
      return null;
    }

    this.metrics.incTelegramBotWebhookReceived({
      type: update.edited_message ? 'edited_message' : 'message',
    });

    // 2a. Voice / audio / photo / document — пока не поддерживаются.
    if (msg.voice || msg.audio) {
      // Tell user we don't support voice yet. Best-effort, не падаем.
      await this.replyToUserBestEffort({
        config,
        chatId: msg.chat.id,
        text:
          'Голосовые сообщения пока не поддерживаются. Пожалуйста, отправьте текст. Доступные команды: /ask, /note, /idea, /status, /myideas, /help.',
      });
      return null;
    }
    if (msg.photo || msg.document) {
      await this.replyToUserBestEffort({
        config,
        chatId: msg.chat.id,
        text:
          'Файлы и картинки пока не поддерживаются. Используйте текст или подпись к файлу.',
      });
      // Если есть текст-подпись — продолжим как обычное сообщение.
      if (!msg.caption) return null;
    }

    const rawText = (msg.text ?? msg.caption ?? '').trim();
    if (!rawText) {
      this.logger.debug(
        { chatId: msg.chat.id },
        'telegram inbound: пустое сообщение без text/caption — игнор',
      );
      return null;
    }

    // 3. Resolve binding (telegram user_id ↔ ChannelBinding).
    const tgUserId = msg.from?.id;
    if (!tgUserId) {
      this.logger.debug(
        { chatId: msg.chat.id },
        'telegram inbound: нет from.id (channel post?) — игнор',
      );
      return null;
    }

    // 3a. /link <code> — единственная команда, доступная БЕЗ binding'а.
    const linkMatch = rawText.match(/^\/link(?:@\w+)?(?:\s+(.+))?$/i);
    if (linkMatch) {
      this.metrics.incTelegramBotWebhookReceived({ type: 'command' });
      const code = linkMatch[1]?.trim();
      await this.handleLink({
        code,
        tgUserId: String(tgUserId),
        chatId: msg.chat.id,
        tenantId,
        channel,
        config,
      });
      return null;
    }

    // 3b. Все остальные команды/тексты требуют binding'а.
    const binding = await this.prisma.channelBinding.findFirst({
      where: {
        channelId: channel.id,
        externalId: String(tgUserId),
      },
    });
    if (!binding || !binding.verifiedAt) {
      await this.replyToUserBestEffort({
        config,
        chatId: msg.chat.id,
        text:
          'Аккаунт не привязан. Зайдите в личный кабинет, получите код привязки и отправьте сюда: /link &lt;код&gt;.',
      });
      return null;
    }

    // 4. Slash-commands.
    if (rawText.startsWith('/')) {
      this.metrics.incTelegramBotWebhookReceived({ type: 'command' });
      return this.parseSlashCommand({
        rawText,
        binding,
        tenantId,
      });
    }

    // 5. reply_to_message — попытка трактовать как probe-response.
    if (msg.reply_to_message) {
      const probeMatch = await this.tryMatchReplyToProbe({
        reply: msg.reply_to_message,
        currentText: rawText,
        binding,
      });
      if (probeMatch) {
        return {
          type: 'response',
          userId: binding.userId,
          tenantId,
          notificationId: probeMatch.notificationId,
          payload: { text: rawText, kind: 'reply_text' },
          originChannelBindingId: binding.id,
        };
      }
      // не нашли probe → fall through к free_note
    }

    // 6. Default → free_note.
    return {
      type: 'free_note',
      userId: binding.userId,
      tenantId,
      text: rawText,
      metadata: { source: 'telegram_bot', chatId: msg.chat.id },
      originChannelBindingId: binding.id,
    };
  }

  // ─────────────────────────────── parseResponse ────────────────────

  /**
   * Используется выше уровнем (в нашем случае — internally) для попытки
   * матчинга reply на open probe. Сейчас матчинг делается напрямую в
   * `ingestUpdate.tryMatchReplyToProbe` (через `NotificationDelivery
   * .externalMessageId`), поэтому здесь stub: возвращаем `null`, чтобы
   * IChannel-контракт был выполнен.
   */
  async parseResponse(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _args: {
      rawMessage: ConversationalJson;
      openProbes: Notification[];
    },
  ): Promise<null> {
    return null;
  }

  // ─────────────────────────────── internal handlers ────────────────

  private async handleCallbackQuery(args: {
    callbackQuery: NonNullable<TelegramUpdate['callback_query']>;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<InboundMessage | null> {
    const { callbackQuery, tenantId, channel, config } = args;
    const data = callbackQuery.data;
    if (!data) {
      await this.api
        .answerCallbackQuery({
          token: config.botToken,
          callbackQueryId: callbackQuery.id,
        })
        .catch((err) =>
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'telegram answerCallbackQuery failed',
          ),
        );
      return null;
    }

    // Сразу отвечаем callback'у — закрываем «крутилку».
    await this.api
      .answerCallbackQuery({
        token: config.botToken,
        callbackQueryId: callbackQuery.id,
        text: 'Принято',
      })
      .catch((err) =>
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'telegram answerCallbackQuery failed',
        ),
      );

    // Формат: `pq:<notificationId>:<optionIndex>`.
    const parts = data.split(':');
    if (parts[0] !== TelegramBotChannelAdapter.PROBE_CALLBACK_PREFIX) {
      this.logger.debug({ data }, 'telegram callback: неизвестный prefix — игнор');
      return null;
    }
    const notificationId = parts[1];
    const optionIndex = Number(parts[2]);
    if (!notificationId || !Number.isFinite(optionIndex)) {
      this.logger.debug({ data }, 'telegram callback: невалидный data — игнор');
      return null;
    }

    // Резолвим binding (получатель callback'а ОДИН — это от.id).
    const tgUserId = callbackQuery.from.id;
    const binding = await this.prisma.channelBinding.findFirst({
      where: { channelId: channel.id, externalId: String(tgUserId) },
    });
    if (!binding) {
      this.logger.debug(
        { tgUserId, channelId: channel.id },
        'telegram callback: binding не найден — игнор',
      );
      return null;
    }

    // Резолвим option-text из notification.payload.options[index].
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
    tgUserId: string;
    chatId: number;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    const { code, tgUserId, chatId, tenantId, channel, config } = args;
    if (!code) {
      await this.replyToUserBestEffort({
        config,
        chatId,
        text:
          'Использование: <code>/link &lt;код&gt;</code>. Код берётся в личном кабинете — раздел «Каналы».',
      });
      return;
    }
    const userId = await this.linkCode.consume({ kind: 'telegram_bot', code });
    if (!userId) {
      this.metrics.incTelegramBotWebhookReceived({ type: 'command' });
      await this.replyToUserBestEffort({
        config,
        chatId,
        text: 'Код невалиден или истёк. Получите новый в личном кабинете.',
      });
      return;
    }

    // upsert ChannelBinding
    await this.prisma.channelBinding.upsert({
      where: {
        channelId_externalId: {
          channelId: channel.id,
          externalId: tgUserId,
        },
      },
      update: { userId, verifiedAt: new Date() },
      create: {
        userId,
        channelId: channel.id,
        externalId: tgUserId,
        verifiedAt: new Date(),
      },
    });

    this.logger.log(
      `telegram /link: tenantId=${tenantId} userId=${userId} tgUserId=${tgUserId}`,
    );

    await this.replyToUserBestEffort({
      config,
      chatId,
      text:
        'Готово! Аккаунт привязан. Теперь сюда будут приходить вопросы и уведомления Коры. ' +
        'Доступные команды: /ask, /note, /idea, /status, /myideas, /help.',
    });
  }

  private parseSlashCommand(args: {
    rawText: string;
    binding: ChannelBinding;
    tenantId: string;
  }): InboundMessage | null {
    const { rawText, binding, tenantId } = args;
    // Извлекаем `/<cmd>(@bot)? <tail>?`.
    const match = rawText.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]+))?$/);
    if (!match) return null;
    const cmd = match[1]!.toLowerCase();
    const tail = match[2]?.trim() ?? '';

    if (cmd === 'ask') {
      if (!tail) {
        // Нет вопроса — мягко подсказать.
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
        metadata: { source: 'telegram_bot', command: 'note' },
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
        metadata: { source: 'telegram_bot', command: 'idea', tag: 'idea' },
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
    // Неизвестная команда → как help.
    return {
      type: 'command',
      userId: binding.userId,
      tenantId,
      commandName: 'help',
      originChannelBindingId: binding.id,
    };
  }

  /**
   * Попытка сопоставить reply с открытым probe-ом. Сохраняем
   * `externalMessageId='<chatId>:<messageId>'` при отправке, поэтому
   * матчим reply_to_message по той же паре.
   */
  private async tryMatchReplyToProbe(args: {
    reply: TelegramMessage;
    currentText: string;
    binding: ChannelBinding;
  }): Promise<{ notificationId: string } | null> {
    const { reply, binding } = args;
    const externalId = `${reply.chat.id}:${reply.message_id}`;
    const delivery = await this.prisma.notificationDelivery.findFirst({
      where: {
        channelBindingId: binding.id,
        externalMessageId: externalId,
      },
      include: { notification: true },
    });
    if (!delivery) return null;
    if (delivery.notification.responseStatus === 'answered') return null;
    return { notificationId: delivery.notificationId };
  }

  // ─────────────────────────────── render helpers ───────────────────

  private renderText(notification: Notification): string {
    const payload =
      (notification.payload as Record<string, unknown> | null) ?? {};
    switch (notification.eventType) {
      case 'probe.question': {
        const q = (payload['question'] as string | undefined) ?? '';
        const ctx = (payload['context'] as string | undefined) ?? '';
        const head = '<b>Кора уточняет</b>';
        const body = escapeHtml(q);
        const tail = ctx ? `\n\n<i>${escapeHtml(ctx)}</i>` : '';
        return `${head}\n\n${body}${tail}`.slice(0, 4000);
      }
      case 'specialist.probe': {
        const msg = (payload['message'] as string | undefined) ?? '';
        const reason = (payload['reason'] as string | undefined) ?? '';
        return `<b>Кора подсказывает</b> (${escapeHtml(reason)})\n\n${escapeHtml(msg)}`.slice(0, 4000);
      }
      case 'chat.answer': {
        const text = (payload['text'] as string | undefined) ?? '';
        const cite = (payload['citationsCount'] as number | undefined) ?? 0;
        const tail = cite > 0 ? `\n\n<i>Источников: ${cite}</i>` : '';
        return `${escapeHtml(text)}${tail}`.slice(0, 4000);
      }
      case 'curation.pending': {
        const summary = (payload['summary'] as string | undefined) ?? '';
        return `<b>Кора: нужна модерация</b>\n\n${escapeHtml(summary)}`.slice(0, 4000);
      }
      case 'system.message': {
        const title = (payload['title'] as string | undefined) ?? '';
        const body = (payload['body'] as string | undefined) ?? '';
        return `<b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`.slice(0, 4000);
      }
      default: {
        return `Уведомление: ${escapeHtml(notification.eventType)}`;
      }
    }
  }

  private renderInlineKeyboard(
    notification: Notification,
  ): TelegramInlineKeyboardMarkup | undefined {
    const payload = notification.payload as Record<string, unknown> | null;
    if (!payload) return undefined;
    const options = payload['options'];
    if (!Array.isArray(options) || options.length === 0) return undefined;
    // Каждая опция — отдельная строка (Telegram callback_data ≤ 64 байт).
    const rows = options.slice(0, 8).map((opt, idx) => [
      {
        text: String(opt).slice(0, 64),
        callback_data: `${TelegramBotChannelAdapter.PROBE_CALLBACK_PREFIX}:${notification.id}:${idx}`,
      },
    ]);
    return { inline_keyboard: rows };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private maybeReplyToMessageId(_delivery: NotificationDelivery): number | undefined {
    // На β-1 не используем reply chains (это сделает worker позже,
    // когда будет conversation thread). Возвращаем undefined всегда —
    // зарезервировано на будущее.
    return undefined;
  }

  // ─────────────────────────────── config decrypt ───────────────────

  private readChannelConfig(channel: Channel): TelegramBotChannelConfig {
    const raw = channel.config as Record<string, unknown> | null;
    if (!raw) {
      throw new Error(
        `TelegramBotChannelAdapter.readChannelConfig: пустой config (channelId=${channel.id})`,
      );
    }
    const tokenEnc = String(raw['botToken'] ?? '');
    const secretEnc = String(raw['webhookSecret'] ?? '');
    const username = raw['botUsername']
      ? String(raw['botUsername'])
      : undefined;
    return {
      botToken: tokenEnc ? this.decryptIfNeeded(tokenEnc) : '',
      webhookSecret: secretEnc ? this.decryptIfNeeded(secretEnc) : '',
      botUsername: username,
    };
  }

  /** Public — нужен webhook controller'у для verify secret. */
  readWebhookSecret(channel: Channel): string {
    return this.readChannelConfig(channel).webhookSecret;
  }

  private decryptIfNeeded(value: string): string {
    if (this.crypto.isEncrypted(value)) {
      return this.crypto.decrypt(value);
    }
    return value;
  }

  /**
   * Отправка короткого ответа пользователю в обход NotificationDelivery —
   * для linking-flow и подсказок. Best-effort: ошибки логируем, не бросаем
   * (иначе webhook вернёт 5xx и Telegram засрёт retry'ями).
   */
  private async replyToUserBestEffort(args: {
    config: TelegramBotChannelConfig;
    chatId: number;
    text: string;
  }): Promise<void> {
    if (!args.config.botToken) return;
    try {
      await this.api.sendMessage({
        token: args.config.botToken,
        chatId: args.chatId,
        text: args.text,
        parseMode: 'HTML',
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram replyToUserBestEffort: sendMessage failed',
      );
    }
  }
}

/** Безопасный HTML-escape для Telegram `parse_mode='HTML'`. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
