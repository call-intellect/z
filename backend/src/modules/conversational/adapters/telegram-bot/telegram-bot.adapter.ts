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

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import { VoxService } from '../../../ai/services/vox.service';
import { QueryClassifierService } from '../../../dialog-layer/services/query-classifier.service';
import { DocumentsService } from '../../../documents/documents.service';
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
  TelegramMessage,
  TelegramUpdate,
} from './telegram.types';

/**
 * Telegram Bot ChannelAdapter (SBA β-1, zero-button rip-out 2026-05-23).
 *
 * **Zero-button:** бот не показывает inline-кнопок, не принимает callback_query,
 * не обрабатывает slash-команды (кроме `/start <token>` для deep-link
 * привязки). Telegram menu-хамбургер очищается через `setMyCommands([])` в
 * `onModuleInit`.
 *
 * Outbound:
 *   - расшифровывает per-tenant `botToken` из `Channel.config`;
 *   - формирует HTML-сообщение (без `reply_markup`);
 *   - вызывает `sendMessage` через `TelegramApiClient`;
 *   - возвращает `<chatId>:<messageId>` как `externalMessageId` для
 *     trace'а и для последующего матчинга reply'ев.
 *
 * Inbound:
 *   - принимает `TelegramUpdate` из webhook controller'а;
 *   - распознаёт `/start <token>` и голый код привязки (regex
 *     `/^[a-f0-9]{6,32}$/i` — покрывает текущий формат
 *     `randomBytes(6).toString('hex')` = 12 hex и потенциальный 6-digit);
 *   - извлекает `from.id` → ищет `ChannelBinding` (verified);
 *   - voice → `getFile` → ASR (Vox) → intent classify → `free_note`|`chat_query`;
 *   - document → `getFile` → DocumentsService.upload (document.adapter pipeline);
 *   - reply на наше outbound-сообщение → попытка `tryMatchReplyToProbe`;
 *   - свободный текст → intent classify → `free_note`|`chat_query`.
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

  /** Лимит размера документа inbound — 20 MB (Telegram Bot API hard limit). */
  static readonly MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

  /** Anti-spam: сколько voice / час / user пропускаем без 429. */
  static readonly VOICE_PER_HOUR_PER_USER = 10;

  /** Regex linking-кода: гибкий, поддерживает 6-digit и 12-hex форматы. */
  static readonly LINK_CODE_REGEX = /^[a-f0-9]{6,32}$/i;

  constructor(
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TelegramApiClient) private readonly api: TelegramApiClient,
    @Inject(ConversationalLinkCodeService)
    private readonly linkCode: ConversationalLinkCodeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(VoxService) private readonly vox: VoxService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(QueryClassifierService)
    private readonly classifier: QueryClassifierService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    // setMyCommands([]) для всех активных Telegram-каналов: чтобы Telegram
    // очистил menu хамбургер после удаления slash-команд. Best-effort —
    // не падаем, если какой-то токен невалиден (логируем).
    await this.clearMyCommandsForAllChannels().catch((err) => {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram setMyCommands([]) bulk clear failed',
      );
    });
  }

  private async clearMyCommandsForAllChannels(): Promise<void> {
    const channels = await this.prisma.channel.findMany({
      where: { kind: 'telegram_bot', status: 'active' },
    });
    for (const channel of channels) {
      try {
        const config = this.readChannelConfig(channel);
        if (!config.botToken) continue;
        await this.api.setMyCommands({ token: config.botToken, commands: [] });
        this.logger.log(
          `telegram setMyCommands([]) ok channelId=${channel.id} tenantId=${channel.tenantId}`,
        );
      } catch (err) {
        this.logger.warn(
          {
            channelId: channel.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'telegram setMyCommands([]) failed для канала',
        );
      }
    }
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
    const replyToMessageId = this.maybeReplyToMessageId(args.delivery);

    try {
      const { messageId, chatId: rcvChatId } = await this.api.sendMessage({
        token: config.botToken,
        chatId,
        text,
        parseMode: 'HTML',
        replyToMessageId,
      });
      return { externalMessageId: `${rcvChatId}:${messageId}` };
    } catch (err) {
      if (err instanceof TelegramApiError && !err.transient) {
        // Final fail — выбрасываем как Error, чтобы worker сразу пометил
        // delivery=failed без retry (TelegramApiError содержит описание).
        throw new Error(`telegram_final:${err.code}:${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  // ─────────────────────────────── ingest ──────────────────────────

  /**
   * `IChannel.ingest` для совместимости. Telegram-адаптеру нужен `tenantId`
   * + `channel` (per-tenant config), которых нет в этой сигнатуре —
   * поэтому webhook controller вызывает напрямую `ingestUpdate(...)`.
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
   * (если адаптер сам обработал сообщение — например, привязка, voice
   * пошёл в ASR-pipeline или document отправлен в DocumentsService).
   */
  async ingestUpdate(args: {
    update: TelegramUpdate;
    tenantId: string;
    channel: Channel;
  }): Promise<InboundMessage | null> {
    const { update, tenantId, channel } = args;
    const config = this.readChannelConfig(channel);

    const msg = update.message ?? update.edited_message;
    if (!msg) {
      this.metrics.incTelegramBotWebhookReceived({ type: 'unknown' });
      this.logger.debug({ updateId: update.update_id }, 'telegram inbound: пустой update');
      return null;
    }

    this.metrics.incTelegramBotWebhookReceived({
      type: update.edited_message ? 'edited_message' : 'message',
    });

    const tgUserId = msg.from?.id;
    if (!tgUserId) {
      this.logger.debug(
        { chatId: msg.chat.id },
        'telegram inbound: нет from.id (channel post?) — игнор',
      );
      return null;
    }

    // 1. /start <token> — единственный разрешённый slash. Без аргумента —
    //    приветствие. С аргументом — попытка прожечь как link-code.
    const text = (msg.text ?? '').trim();
    const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
    if (startMatch) {
      this.metrics.incBotInbound({
        channel: 'telegram_bot',
        kind: 'start_command',
      });
      const code = startMatch[1]?.trim();
      await this.handleStart({
        code,
        tgUserId: String(tgUserId),
        chatId: msg.chat.id,
        tenantId,
        channel,
        config,
      });
      return null;
    }

    // 2. Voice → ASR pipeline (до проверки binding'а — мы и так дальше
    //    проверим, но voice без binding'а смысла не имеет; ниже binding
    //    обязателен).
    const voice = msg.voice ?? msg.audio;
    if (voice) {
      this.metrics.incBotInbound({ channel: 'telegram_bot', kind: 'voice' });
      const binding = await this.requireVerifiedBinding({
        tgUserId: String(tgUserId),
        channelId: channel.id,
        chatId: msg.chat.id,
        config,
      });
      if (!binding) return null;
      if (!this.cfg.bot.voiceEnabled) {
        await this.replyToUserBestEffort({
          config,
          chatId: msg.chat.id,
          text: 'Голосовые сообщения сейчас недоступны. Напишите текстом.',
        });
        return null;
      }
      return this.handleVoice({
        voice,
        binding,
        msg,
        tenantId,
        channel,
        config,
      });
    }

    // 3. Document → DocumentsService.upload pipeline.
    if (msg.document) {
      this.metrics.incBotInbound({ channel: 'telegram_bot', kind: 'document' });
      const binding = await this.requireVerifiedBinding({
        tgUserId: String(tgUserId),
        channelId: channel.id,
        chatId: msg.chat.id,
        config,
      });
      if (!binding) return null;
      if (!this.cfg.bot.documentEnabled) {
        await this.replyToUserBestEffort({
          config,
          chatId: msg.chat.id,
          text: 'Загрузка файлов сейчас выключена.',
        });
        return null;
      }
      await this.handleDocument({
        document: msg.document,
        binding,
        chatId: msg.chat.id,
        tenantId,
        channel,
        config,
      });
      // Если есть caption — продолжаем как текст (см. далее).
      if (!msg.caption || !msg.caption.trim()) return null;
    }

    // 4. Photo — не поддерживаем zero-button (только текст / voice / document).
    if (msg.photo && !msg.caption) {
      this.metrics.incBotInbound({ channel: 'telegram_bot', kind: 'other' });
      await this.replyToUserBestEffort({
        config,
        chatId: msg.chat.id,
        text:
          'Изображения пока не поддерживаются. Отправьте текст, голос или документ (PDF/DOCX/MD/TXT).',
      });
      return null;
    }

    const rawText = (msg.text ?? msg.caption ?? '').trim();
    if (!rawText) {
      this.logger.debug(
        { chatId: msg.chat.id },
        'telegram inbound: пустое сообщение без text/caption — игнор',
      );
      return null;
    }

    // 5. Голый 6-знач/hex код — link-code flow (если binding'а ещё нет).
    if (TelegramBotChannelAdapter.LINK_CODE_REGEX.test(rawText)) {
      const existing = await this.prisma.channelBinding.findFirst({
        where: { channelId: channel.id, externalId: String(tgUserId) },
      });
      if (!existing || !existing.verifiedAt) {
        this.metrics.incBotInbound({
          channel: 'telegram_bot',
          kind: 'link_code',
        });
        await this.handleLinkCode({
          code: rawText,
          tgUserId: String(tgUserId),
          chatId: msg.chat.id,
          tenantId,
          channel,
          config,
        });
        return null;
      }
      // Иначе fall through — может быть случайное совпадение «12-hex», но
      // юзер уже залинкован; обрабатываем как обычный free_note/chat_query.
    }

    // 6. Резолв binding'а (для текстовых сообщений после линка).
    const binding = await this.requireVerifiedBinding({
      tgUserId: String(tgUserId),
      channelId: channel.id,
      chatId: msg.chat.id,
      config,
    });
    if (!binding) return null;

    this.metrics.incBotInbound({ channel: 'telegram_bot', kind: 'text' });

    // 7. reply_to_message — попытка матчинга с открытым probe.
    if (msg.reply_to_message) {
      const probeMatch = await this.tryMatchReplyToProbe({
        reply: msg.reply_to_message,
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
      // fall through
    }

    // 8. Intent classification (LLM + fallback на эвристики).
    const intent = await this.classifyIntent({
      text: rawText,
      tenantId,
      userId: binding.userId,
    });

    if (intent === 'chat_query') {
      return {
        type: 'chat_query',
        userId: binding.userId,
        tenantId,
        question: rawText,
        originChannelBindingId: binding.id,
      };
    }
    return {
      type: 'free_note',
      userId: binding.userId,
      tenantId,
      text: rawText,
      metadata: { source: 'telegram_bot', chatId: msg.chat.id },
      originChannelBindingId: binding.id,
    };
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

  // ─────────────────────────────── handlers ─────────────────────────

  /**
   * `/start` без аргумента — приветствие. `/start <token>` — пытается
   * прожечь как link-code (deep-link флоу: ссылка `https://t.me/<bot>?start=<token>`).
   */
  private async handleStart(args: {
    code: string | undefined;
    tgUserId: string;
    chatId: number;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    if (!args.code) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Добро пожаловать. Чтобы привязать аккаунт, получите код в личном кабинете (раздел «Каналы») и отправьте его сюда сообщением.',
      });
      return;
    }
    await this.handleLinkCode({
      code: args.code,
      tgUserId: args.tgUserId,
      chatId: args.chatId,
      tenantId: args.tenantId,
      channel: args.channel,
      config: args.config,
    });
  }

  private async handleLinkCode(args: {
    code: string;
    tgUserId: string;
    chatId: number;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    const userId = await this.linkCode.consume({
      kind: 'telegram_bot',
      code: args.code,
    });
    if (!userId) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Код невалиден или истёк. Получите новый в личном кабинете.',
      });
      return;
    }
    await this.prisma.channelBinding.upsert({
      where: {
        channelId_externalId: {
          channelId: args.channel.id,
          externalId: args.tgUserId,
        },
      },
      update: { userId, verifiedAt: new Date() },
      create: {
        userId,
        channelId: args.channel.id,
        externalId: args.tgUserId,
        verifiedAt: new Date(),
      },
    });
    this.logger.log(
      `telegram link: tenantId=${args.tenantId} userId=${userId} tgUserId=${args.tgUserId}`,
    );
    await this.replyToUserBestEffort({
      config: args.config,
      chatId: args.chatId,
      text:
        'Готово! Аккаунт привязан. Теперь сюда будут приходить вопросы и уведомления Коры. Просто напишите текст, голос или пришлите документ.',
    });
  }

  /**
   * Voice → getFile → downloadFile → Vox ASR → intent classify →
   * InboundMessage. Если ASR падает / превышен rate-limit / голос
   * слишком длинный — best-effort reply и `null`.
   */
  private async handleVoice(args: {
    voice: NonNullable<TelegramMessage['voice']>;
    binding: ChannelBinding;
    msg: TelegramMessage;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<InboundMessage | null> {
    // Anti-spam: max VOICE_PER_HOUR_PER_USER через Redis SETNX-bucket.
    const allowed = await this.checkVoiceRateLimit({
      userId: args.binding.userId,
    });
    if (!allowed) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text:
          'Слишком много голосовых сообщений за час. Попробуйте чуть позже.',
      });
      return null;
    }

    let buffer: Buffer;
    try {
      const file = await this.api.getFile({
        token: args.config.botToken,
        fileId: args.voice.file_id,
      });
      if (!file.file_path) {
        throw new Error('getFile вернул пустой file_path');
      }
      buffer = await this.api.downloadFile({
        token: args.config.botToken,
        filePath: file.file_path,
      });
    } catch (err) {
      this.logger.warn(
        {
          fileId: args.voice.file_id,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram voice: download failed',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text: 'Не удалось получить голосовое сообщение. Попробуйте ещё раз.',
      });
      return null;
    }

    // ASR через Vox.
    const startedAt = Date.now();
    let transcript: string;
    try {
      const submitted = await this.vox.submit(buffer);
      const result = await this.vox.poll(submitted.taskId);
      transcript = result.transcriptText.trim();
    } catch (err) {
      this.metrics.observeBotVoiceAsrDuration({
        channel: 'telegram_bot',
        seconds: (Date.now() - startedAt) / 1000,
      });
      this.logger.warn(
        {
          fileId: args.voice.file_id,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram voice: ASR failed',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text:
          'Не удалось распознать голос. Попробуйте отправить текст или повторите голосовое.',
      });
      return null;
    }

    this.metrics.observeBotVoiceAsrDuration({
      channel: 'telegram_bot',
      seconds: (Date.now() - startedAt) / 1000,
    });

    if (!transcript) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text: 'Голос распознан как пустой. Попробуйте ещё раз — чуть громче.',
      });
      return null;
    }

    const intent = await this.classifyIntent({
      text: transcript,
      tenantId: args.tenantId,
      userId: args.binding.userId,
    });

    if (intent === 'chat_query') {
      return {
        type: 'chat_query',
        userId: args.binding.userId,
        tenantId: args.tenantId,
        question: transcript,
        originChannelBindingId: args.binding.id,
      };
    }
    return {
      type: 'free_note',
      userId: args.binding.userId,
      tenantId: args.tenantId,
      text: transcript,
      metadata: {
        source: 'telegram_bot',
        kind: 'voice',
        chatId: args.msg.chat.id,
      },
      originChannelBindingId: args.binding.id,
    };
  }

  /**
   * Document → getFile → downloadFile → DocumentsService.upload
   * (внутри ставит job в document.adapter pipeline). Если файл больше
   * 20 MB — reply «слишком большой файл».
   */
  private async handleDocument(args: {
    document: NonNullable<TelegramMessage['document']>;
    binding: ChannelBinding;
    chatId: number;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    const sizeBytes = args.document.file_size ?? 0;
    if (
      sizeBytes > 0 &&
      sizeBytes > TelegramBotChannelAdapter.MAX_DOCUMENT_BYTES
    ) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Файл слишком большой (>20 МБ). Загрузите его через веб-кабинет.',
      });
      return;
    }

    // Резолвим Person для tenant'а+user'а — DocumentsService.upload требует
    // uploaderPersonId.
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.binding.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!person) {
      this.logger.warn(
        { userId: args.binding.userId, tenantId: args.tenantId },
        'telegram document: у user нет привязанного Person — отказ',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Не удалось привязать файл к профилю сотрудника. Обратитесь к админу.',
      });
      return;
    }

    let buffer: Buffer;
    try {
      const file = await this.api.getFile({
        token: args.config.botToken,
        fileId: args.document.file_id,
      });
      if (!file.file_path) throw new Error('getFile вернул пустой file_path');
      buffer = await this.api.downloadFile({
        token: args.config.botToken,
        filePath: file.file_path,
      });
    } catch (err) {
      this.logger.warn(
        {
          fileId: args.document.file_id,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram document: download failed',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Не удалось получить документ. Попробуйте ещё раз.',
      });
      return;
    }

    try {
      const result = await this.documents.upload({
        tenantId: args.tenantId,
        uploaderPersonId: person.id,
        file: {
          buffer,
          originalName: args.document.file_name ?? 'telegram-document',
          mimeType: args.document.mime_type ?? 'application/octet-stream',
          size: buffer.byteLength,
        },
      });
      this.logger.log(
        {
          documentId: result.id,
          tenantId: args.tenantId,
          userId: args.binding.userId,
        },
        'telegram document: upload ok',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Документ принят. Я разберу его и подключу к знаниям компании.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { tenantId: args.tenantId, err: message },
        'telegram document: upload failed',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: `Не удалось принять документ: ${humanizeError(message)}`,
      });
    }
  }

  // ─────────────────────────────── helpers ──────────────────────────

  /**
   * Anti-spam: max VOICE_PER_HOUR_PER_USER через Redis-bucket. Окно — час
   * с round-down (`Math.floor(epochMs / 3_600_000)`).
   */
  private async checkVoiceRateLimit(args: {
    userId: string;
  }): Promise<boolean> {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key = `bot:voice:rl:${args.userId}:${hour}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      // первый — выставим TTL 2 часа (с запасом, на случай гранулярного окна).
      await this.redis.client.expire(key, 7200);
    }
    return count <= TelegramBotChannelAdapter.VOICE_PER_HOUR_PER_USER;
  }

  /**
   * Резолв verified binding'а. Если нет — best-effort reply и null.
   */
  private async requireVerifiedBinding(args: {
    tgUserId: string;
    channelId: string;
    chatId: number;
    config: TelegramBotChannelConfig;
  }): Promise<ChannelBinding | null> {
    const binding = await this.prisma.channelBinding.findFirst({
      where: { channelId: args.channelId, externalId: args.tgUserId },
    });
    if (!binding || !binding.verifiedAt) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Аккаунт не привязан. Получите код в личном кабинете (раздел «Каналы») и отправьте его сюда сообщением.',
      });
      return null;
    }
    return binding;
  }

  /**
   * Intent classify через QueryClassifierService (если включён) с fallback
   * на эвристику. Эвристика: вопросительный знак или start-with «как/что/
   * почему/кто/где/когда/сколько» → chat_query; иначе free_note.
   */
  private async classifyIntent(args: {
    text: string;
    tenantId: string;
    userId: string;
  }): Promise<'chat_query' | 'free_note'> {
    if (this.cfg.bot.intentClassifierEnabled) {
      try {
        const result = await this.classifier.classify({
          tenantId: args.tenantId,
          userId: args.userId,
          question: args.text,
          conversationId: null,
        });
        // Маппим DialogIntent на наш бинарный inbound-intent.
        // factual / exploratory / analytical / clone_roleplay → chat_query.
        // QueryClassifierService возвращает 'fallback' только при LLM-fail,
        // когда intent=factual — это нормально.
        const intent: 'chat_query' | 'free_note' =
          result.intent === 'factual' ||
          result.intent === 'exploratory' ||
          result.intent === 'analytical' ||
          result.intent === 'clone_roleplay'
            ? 'chat_query'
            : 'free_note';
        // Дополнительная sanity-проверка: если LLM сказал chat_query на
        // явно нечитаемое утверждение без знака вопроса и не похожее на
        // вопрос — оставим chat_query (LLM лучше эвристики).
        const source: 'llm' | 'heuristic' =
          result.source === 'heuristic' ? 'heuristic' : 'llm';
        this.metrics.incBotIntentClassified({
          channel: 'telegram_bot',
          intent,
          source,
        });
        return intent;
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'telegram classify: LLM упал — fallback на эвристики',
        );
        // ниже — heuristic fallback
      }
    }
    const intent = heuristicTextIntent(args.text);
    this.metrics.incBotIntentClassified({
      channel: 'telegram_bot',
      intent,
      source: 'heuristic',
    });
    return intent;
  }

  /**
   * Попытка сопоставить reply с открытым probe-ом.
   */
  private async tryMatchReplyToProbe(args: {
    reply: TelegramMessage;
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
        // β-1 zero-button: даём подсказку «ответьте текстом» — кнопок нет.
        return `${head}\n\n${body}${tail}\n\nОтветьте текстом этим же сообщением.`.slice(
          0,
          4000,
        );
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private maybeReplyToMessageId(_delivery: NotificationDelivery): number | undefined {
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

/**
 * Эвристика intent: вопросительный знак или start-with «как/что/почему/
 * кто/где/когда/сколько/зачем» → chat_query; иначе free_note.
 *
 * Эвристика грубая, но безопасная: на сомнениях скатывается в free_note
 * (всегда сохраняется как заметка). chat_query инициирует LLM-ответ —
 * стоит дороже, выдаём только при явных признаках вопроса.
 */
function heuristicTextIntent(text: string): 'chat_query' | 'free_note' {
  if (text.includes('?')) return 'chat_query';
  const lower = text.trim().toLowerCase();
  const questionStarts = [
    'как ',
    'что ',
    'почему',
    'зачем',
    'кто ',
    'где ',
    'когда',
    'сколько',
    'какой',
    'какая',
    'какое',
    'какие',
  ];
  for (const q of questionStarts) {
    if (lower.startsWith(q)) return 'chat_query';
  }
  return 'free_note';
}

/** Превращает технический message DocumentsService в user-friendly. */
function humanizeError(message: string): string {
  if (message.includes('document_too_large')) {
    return 'файл слишком большой';
  }
  if (message.includes('document_empty')) {
    return 'файл пустой';
  }
  return 'попробуйте ещё раз';
}
