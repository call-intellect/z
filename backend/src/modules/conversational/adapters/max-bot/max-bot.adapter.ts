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

import { MaxApiClient, MaxApiError } from './max-api-client';
import type {
  MaxBotChannelConfig,
  MaxIncomingAttachment,
  MaxMessage,
  MaxUpdate,
} from './max.types';

/**
 * MAX Bot ChannelAdapter (SBA β-1, zero-button rip-out 2026-05-23).
 *
 * **Zero-button:** удалены inline-кнопки (`attachments[type='inline_keyboard']`),
 * `message_callback` updates, slash-commands. Единственная hard-coded команда
 * `/start <token>` обрабатывается в адаптере как deep-link.
 *
 * Параллельная реализация `TelegramBotChannelAdapter` для MAX. MAX Bot API
 * (dev.max.ru/docs-api, context7 verified 2026-05-22):
 *   - sendMessage:    `POST /messages` (без attachments в β-1 rip-out).
 *   - subscribe webhook: `POST /subscriptions { url }`.
 *   - update types:   `message_created` (новое сообщение боту);
 *                     `message_callback` — больше не подписываемся.
 *
 * Voice/document inbound — приходит через `body.attachments[]`. Формат
 * атрибутов attachment'а в MAX более лаконичен, чем в Telegram —
 * defensive-парсинг по нескольким возможным полям (`type='voice'|'audio'|
 * 'document'|'file'`, `payload.file_id`, `payload.url`, `payload.duration`).
 *
 * `maxDataClass='internal'` — MAX внешний канал.
 */
@Injectable()
export class MaxBotChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(MaxBotChannelAdapter.name);
  readonly kind: ChannelKind = 'max_bot';
  readonly maxDataClass: DataClass = 'internal';

  static readonly MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
  static readonly VOICE_PER_HOUR_PER_USER = 10;
  static readonly LINK_CODE_REGEX = /^[a-f0-9]{6,32}$/i;

  constructor(
    @Inject(ChannelRegistry) private readonly registry: ChannelRegistry,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(MaxApiClient) private readonly api: MaxApiClient,
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

  onModuleInit(): void {
    this.registry.register(this);
    // MAX не имеет аналога setMyCommands — menu кнопок у бота нет
    // по умолчанию. Здесь ничего «очищать» не нужно.
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

    try {
      const result = await this.api.sendMessage({
        accessToken: config.accessToken,
        chatId: userIdOrChat,
        text,
      });
      const mid = result.message?.mid ?? null;
      return { externalMessageId: mid };
    } catch (err) {
      if (err instanceof MaxApiError && !err.transient) {
        throw new Error(`max_final:${err.code}:${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  // ─────────────────────────────── ingest ──────────────────────────

  async ingest(
     
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

    if (!update.message) {
      this.metrics.incMaxBotWebhookReceived({ type: updateType || 'unknown' });
      this.logger.debug({ updateType }, 'max inbound: пустой message — игнор');
      return null;
    }

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

  // ─────────────────────────────── parseResponse (stub) ─────────────

  async parseResponse(
     
    _args: {
      rawMessage: ConversationalJson;
      openProbes: Notification[];
    },
  ): Promise<null> {
    return null;
  }

  // ─────────────────────────────── handlers ────────────────────────

  private async handleMessage(args: {
    message: MaxMessage;
    tenantId: string;
    channel: Channel;
    config: MaxBotChannelConfig;
  }): Promise<InboundMessage | null> {
    const { message, tenantId, channel, config } = args;

    const senderId = message.sender?.user_id;
    const chatId = message.recipient?.chat_id ?? senderId;
    if (!senderId || chatId === undefined) {
      this.logger.debug('max inbound: нет sender.user_id или recipient — игнор');
      return null;
    }

    const externalUserId = String(senderId);
    const text = (message.body?.text ?? '').trim();
    const attachments = message.body?.attachments ?? [];

    // 1. /start <token> — deep-link флоу.
    const startMatch = text.match(/^\/start(?:\s+(\S+))?$/i);
    if (startMatch) {
      this.metrics.incBotInbound({ channel: 'max_bot', kind: 'start_command' });
      const code = startMatch[1]?.trim();
      await this.handleStart({
        code,
        externalUserId,
        chatId,
        tenantId,
        channel,
        config,
      });
      return null;
    }

    // 2. Voice attachment.
    const voiceAtt = attachments.find((a) =>
      isVoiceAttachment(a),
    );
    if (voiceAtt) {
      this.metrics.incBotInbound({ channel: 'max_bot', kind: 'voice' });
      const binding = await this.requireVerifiedBinding({
        externalUserId,
        channelId: channel.id,
        chatId,
        config,
      });
      if (!binding) return null;
      if (!this.cfg.bot.voiceEnabled) {
        await this.replyToUserBestEffort({
          config,
          chatId,
          text: 'Голосовые сообщения сейчас недоступны. Напишите текстом.',
        });
        return null;
      }
      return this.handleVoice({
        attachment: voiceAtt,
        binding,
        chatId,
        tenantId,
        channel,
        config,
      });
    }

    // 3. Document attachment.
    const docAtt = attachments.find((a) => isDocumentAttachment(a));
    if (docAtt) {
      this.metrics.incBotInbound({ channel: 'max_bot', kind: 'document' });
      const binding = await this.requireVerifiedBinding({
        externalUserId,
        channelId: channel.id,
        chatId,
        config,
      });
      if (!binding) return null;
      if (!this.cfg.bot.documentEnabled) {
        await this.replyToUserBestEffort({
          config,
          chatId,
          text: 'Загрузка файлов сейчас выключена.',
        });
        return null;
      }
      await this.handleDocument({
        attachment: docAtt,
        binding,
        chatId,
        tenantId,
        channel,
        config,
      });
      if (!text) return null;
      // если был и текст-caption — обработаем дальше
    }

    if (!text) {
      this.logger.debug('max inbound: пустой text без поддерживаемых attachments — игнор');
      return null;
    }

    // 4. Голый код привязки (если ещё не привязан).
    if (MaxBotChannelAdapter.LINK_CODE_REGEX.test(text)) {
      const existing = await this.prisma.channelBinding.findFirst({
        where: { channelId: channel.id, externalId: externalUserId },
      });
      if (!existing || !existing.verifiedAt) {
        this.metrics.incBotInbound({ channel: 'max_bot', kind: 'link_code' });
        await this.handleLinkCode({
          code: text,
          externalUserId,
          chatId,
          tenantId,
          channel,
          config,
        });
        return null;
      }
    }

    // 5. Резолв binding'а.
    const binding = await this.requireVerifiedBinding({
      externalUserId,
      channelId: channel.id,
      chatId,
      config,
    });
    if (!binding) return null;

    this.metrics.incBotInbound({ channel: 'max_bot', kind: 'text' });

    // 6. Intent classification.
    const intent = await this.classifyIntent({
      text,
      tenantId,
      userId: binding.userId,
    });

    if (intent === 'chat_query') {
      return {
        type: 'chat_query',
        userId: binding.userId,
        tenantId,
        question: text,
        originChannelBindingId: binding.id,
      };
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

  private async handleStart(args: {
    code: string | undefined;
    externalUserId: string;
    chatId: number | string;
    tenantId: string;
    channel: Channel;
    config: MaxBotChannelConfig;
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
      externalUserId: args.externalUserId,
      chatId: args.chatId,
      tenantId: args.tenantId,
      channel: args.channel,
      config: args.config,
    });
  }

  private async handleLinkCode(args: {
    code: string;
    externalUserId: string;
    chatId: number | string;
    tenantId: string;
    channel: Channel;
    config: MaxBotChannelConfig;
  }): Promise<void> {
    const userId = await this.linkCode.consume({
      kind: 'max_bot',
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
          externalId: args.externalUserId,
        },
      },
      update: { userId, verifiedAt: new Date() },
      create: {
        userId,
        channelId: args.channel.id,
        externalId: args.externalUserId,
        verifiedAt: new Date(),
      },
    });
    this.logger.log(
      `max link: tenantId=${args.tenantId} userId=${userId} maxUserId=${args.externalUserId}`,
    );
    await this.replyToUserBestEffort({
      config: args.config,
      chatId: args.chatId,
      text:
        'Готово! Аккаунт привязан. Теперь сюда будут приходить вопросы и уведомления Коры. Просто напишите текст, голос или пришлите документ.',
    });
  }

  private async handleVoice(args: {
    attachment: MaxIncomingAttachment;
    binding: ChannelBinding;
    chatId: number | string;
    tenantId: string;
    channel: Channel;
    config: MaxBotChannelConfig;
  }): Promise<InboundMessage | null> {
    const allowed = await this.checkVoiceRateLimit({
      userId: args.binding.userId,
    });
    if (!allowed) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Слишком много голосовых сообщений за час. Попробуйте чуть позже.',
      });
      return null;
    }

    const url = args.attachment.payload?.url;
    if (!url) {
      this.logger.warn(
        { attachment: args.attachment },
        'max voice: нет payload.url — игнор (требуется явный URL, file_id не поддержан)',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Не удалось получить голосовое сообщение. Попробуйте ещё раз.',
      });
      return null;
    }

    let buffer: Buffer;
    try {
      buffer = await this.api.downloadAttachment({
        accessToken: args.config.accessToken,
        url,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'max voice: download failed',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Не удалось получить голосовое сообщение. Попробуйте ещё раз.',
      });
      return null;
    }

    const startedAt = Date.now();
    let transcript: string;
    try {
      const submitted = await this.vox.submit(buffer);
      const result = await this.vox.poll(submitted.taskId);
      transcript = result.transcriptText.trim();
    } catch (err) {
      this.metrics.observeBotVoiceAsrDuration({
        channel: 'max_bot',
        seconds: (Date.now() - startedAt) / 1000,
      });
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'max voice: ASR failed',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Не удалось распознать голос. Попробуйте отправить текст или повторите голосовое.',
      });
      return null;
    }
    this.metrics.observeBotVoiceAsrDuration({
      channel: 'max_bot',
      seconds: (Date.now() - startedAt) / 1000,
    });
    if (!transcript) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
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
      metadata: { source: 'max_bot', kind: 'voice', chatId: args.chatId },
      originChannelBindingId: args.binding.id,
    };
  }

  private async handleDocument(args: {
    attachment: MaxIncomingAttachment;
    binding: ChannelBinding;
    chatId: number | string;
    tenantId: string;
    channel: Channel;
    config: MaxBotChannelConfig;
  }): Promise<void> {
    const sizeBytes = args.attachment.payload?.file_size ?? 0;
    if (sizeBytes > 0 && sizeBytes > MaxBotChannelAdapter.MAX_DOCUMENT_BYTES) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Файл слишком большой (>20 МБ). Загрузите его через веб-кабинет.',
      });
      return;
    }
    const url = args.attachment.payload?.url;
    if (!url) {
      this.logger.warn(
        { attachment: args.attachment },
        'max document: нет payload.url — игнор',
      );
      return;
    }

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
        'max document: нет Person — отказ',
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
      buffer = await this.api.downloadAttachment({
        accessToken: args.config.accessToken,
        url,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'max document: download failed',
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
          originalName:
            args.attachment.payload?.file_name ?? 'max-document',
          mimeType:
            args.attachment.payload?.mime_type ?? 'application/octet-stream',
          size: buffer.byteLength,
        },
      });
      this.logger.log(
        {
          documentId: result.id,
          tenantId: args.tenantId,
          userId: args.binding.userId,
        },
        'max document: upload ok',
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
        'max document: upload failed',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: `Не удалось принять документ: ${humanizeError(message)}`,
      });
    }
  }

  // ─────────────────────────────── helpers ──────────────────────────

  private async checkVoiceRateLimit(args: {
    userId: string;
  }): Promise<boolean> {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key = `bot:voice:rl:${args.userId}:${hour}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, 7200);
    }
    return count <= MaxBotChannelAdapter.VOICE_PER_HOUR_PER_USER;
  }

  private async requireVerifiedBinding(args: {
    externalUserId: string;
    channelId: string;
    chatId: number | string;
    config: MaxBotChannelConfig;
  }): Promise<ChannelBinding | null> {
    const binding = await this.prisma.channelBinding.findFirst({
      where: { channelId: args.channelId, externalId: args.externalUserId },
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
        const intent: 'chat_query' | 'free_note' =
          result.intent === 'factual' ||
          result.intent === 'exploratory' ||
          result.intent === 'analytical' ||
          result.intent === 'clone_roleplay'
            ? 'chat_query'
            : 'free_note';
        const source: 'llm' | 'heuristic' =
          result.source === 'heuristic' ? 'heuristic' : 'llm';
        this.metrics.incBotIntentClassified({
          channel: 'max_bot',
          intent,
          source,
        });
        return intent;
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'max classify: LLM упал — fallback на эвристики',
        );
      }
    }
    const intent = heuristicTextIntent(args.text);
    this.metrics.incBotIntentClassified({
      channel: 'max_bot',
      intent,
      source: 'heuristic',
    });
    return intent;
  }

  // ─────────────────────────────── render helpers ───────────────────

  private renderText(notification: Notification): string {
    const payload =
      (notification.payload as Record<string, unknown> | null) ?? {};
    switch (notification.eventType) {
      case 'probe.question': {
        const q = (payload['question'] as string | undefined) ?? '';
        const ctx = (payload['context'] as string | undefined) ?? '';
        const head = 'Кора уточняет:';
        const tail = ctx ? `\n\n${ctx}` : '';
        return `${head}\n\n${q}${tail}\n\nОтветьте текстом этим же сообщением.`.slice(
          0,
          4000,
        );
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
      case 'meeting.invite': {
        // ТЗ 2026-06-04 (meeting-identity) Фаза 3.3 — приглашение на встречу.
        const title = (payload['meetingTitle'] as string | undefined) ?? '';
        const host = (payload['hostName'] as string | undefined) ?? '';
        const joinUrl = (payload['joinUrl'] as string | undefined) ?? '';
        const who = host
          ? `${host} приглашает вас на встречу:`
          : 'Вас приглашают на встречу:';
        const body = title ? `\n«${title}»` : '';
        const link = joinUrl ? `\n\nПрисоединиться:\n${joinUrl}` : '';
        return `Приглашение на встречу\n\n${who}${body}${link}`.slice(0, 4000);
      }
      case 'probe.digest': {
        // Probe Фаза 3 — батч-дайджест: человеческий текст уже собран в summary.
        const summary = (payload['summary'] as string | undefined) ?? '';
        return `Кора собрала вопросы:\n\n${summary}\n\nОтветьте на любой из них текстом этим же сообщением.`.slice(
          0,
          4000,
        );
      }
      case 'probe.answer_acknowledged': {
        // Probe Фаза 6 — видимое следствие: текст подтверждения уже человеческий.
        const text =
          (payload['text'] as string | undefined) ??
          (payload['summary'] as string | undefined) ??
          'Спасибо! Ваш ответ записан.';
        return `${text}`.slice(0, 4000);
      }
      case 'checkin.prompt': {
        // Ф2 (assistant-channels 2026-06-11) — утренний/вечерний чек-ин:
        // готовый текст вопроса уже лежит в payload.question.
        const q = (payload['question'] as string | undefined) ?? '';
        if (q.trim()) {
          return `${q}\n\nОтветьте текстом или голосом — Кора запишет.`.slice(
            0,
            4000,
          );
        }
        // Пустой вопрос — деградация в универсальную ветку / default ниже.
        break;
      }
      case 'note.ack': {
        // Ф2 — подтверждение записи свободной заметки (тип в registry добавляет Ф1).
        const text = (payload['text'] as string | undefined) ?? '';
        return (text.trim() ? text : 'Записал в память Коры 🧠').slice(0, 4000);
      }
      case 'event.reminder': {
        // Ф2 — напоминание о событии календаря: в payload НЕТ title/body.
        const eventTitle = (payload['eventTitle'] as string | undefined) ?? '';
        const startAtIso = (payload['startAtIso'] as string | undefined) ?? '';
        const location = (payload['location'] as string | undefined) ?? '';
        const d = new Date(startAtIso);
        const pad = (n: number): string => String(n).padStart(2, '0');
        // Сервер в UTC, локаль пользователя не угадываем — выводим явно (UTC).
        const when =
          startAtIso && !Number.isNaN(d.getTime())
            ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`
            : '';
        const head = `⏰ Напоминание: ${eventTitle}`;
        const whenLine = when ? `\nНачало: в ${when} (UTC)` : '';
        const locLine = location ? `\nМесто: ${location}` : '';
        return `${head}${whenLine}${locLine}`.slice(0, 4000);
      }
      case 'issue.mention': {
        // Ф2 — @-упоминание в комментарии задачи: в payload НЕТ title/body.
        const ref =
          (payload['issueIdentifier'] as string | undefined) ??
          (payload['issueTitle'] as string | undefined) ??
          '';
        const snippet = (payload['snippet'] as string | undefined) ?? '';
        const head = ref
          ? `Вас упомянули в задаче ${ref}`
          : 'Вас упомянули в задаче';
        const tail = snippet ? `\n\n${snippet}` : '';
        return `${head}${tail}`.slice(0, 4000);
      }
      case 'support.ticket_created': {
        // Ф2 — подтверждение создания обращения в поддержку.
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        return `Обращение №${num} создано: ${subject}`.slice(0, 4000);
      }
      case 'support.ticket_reply': {
        // Ф2 — ответ поддержки по обращению.
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        const snippet = (payload['snippet'] as string | undefined) ?? '';
        const head = `Ответ по обращению №${num}: ${subject}`;
        const tail = snippet ? `\n\n${snippet}` : '';
        return `${head}${tail}`.slice(0, 4000);
      }
      case 'idea.status_changed': {
        // Ф2 — смена статуса идеи. Если LLM уже собрал title+body —
        // рендерим их универсальной веткой ниже (break).
        const title = (payload['title'] as string | undefined) ?? '';
        const body = (payload['body'] as string | undefined) ?? '';
        if (title.trim() && body.trim()) break;
        const statement = (payload['statement'] as string | undefined) ?? '';
        const oldStatus = (payload['oldStatus'] as string | undefined) ?? '';
        const newStatus = (payload['newStatus'] as string | undefined) ?? '';
        const reason = (payload['reason'] as string | undefined) ?? '';
        const head = `Идея сменила статус: ${statement}`;
        const transition =
          oldStatus || newStatus ? `\n${oldStatus} → ${newStatus}` : '';
        const why = reason ? `\nПричина: ${reason}` : '';
        return `${head}${transition}${why}`.slice(0, 4000);
      }
      case 'actions.reminder': {
        // Ф2 — сводка pending-подтверждений. Фактическая доставка идёт как
        // system.message (PendingActionsReminderCron), но policy допускает
        // прямой вызов с этим eventType — рендерим, а не падаем в default.
        const total = Number(payload['total'] ?? 0);
        const urgent = Number(payload['urgentCount'] ?? 0);
        const rawLines = Array.isArray(payload['lines'])
          ? (payload['lines'] as unknown[]).map((l) => String(l))
          : [];
        const actionUrl = (payload['actionUrl'] as string | undefined) ?? '';
        const head = `Ждут вашего решения: ${total}${urgent > 0 ? ` (срочных: ${urgent})` : ''}`;
        const list = rawLines.length > 0 ? `\n\n${rawLines.join('\n')}` : '';
        const link = actionUrl ? `\n\nОткрыть:\n${actionUrl}` : '';
        return `${head}${list}${link}`.slice(0, 4000);
      }
      default:
        break;
    }
    // Ф2 — универсальная ветка ПЕРЕД default: любой payload с готовыми
    // непустыми title+body (operations.weekly_digest, goals.pulse,
    // operations.monthly_recap, proactive.notification и будущие типы).
    // Ссылка оформлена как у meeting.invite — метка, затем URL строкой ниже.
    const genericTitle = (payload['title'] as string | undefined) ?? '';
    const genericBody = (payload['body'] as string | undefined) ?? '';
    if (genericTitle.trim() && genericBody.trim()) {
      const actionUrl = (payload['actionUrl'] as string | undefined) ?? '';
      const link = actionUrl ? `\n\nОткрыть:\n${actionUrl}` : '';
      return `${genericTitle}\n\n${genericBody}${link}`.slice(0, 4000);
    }
    // Неизвестный тип без title/body — прежний generic-fallback.
    return `Уведомление: ${notification.eventType}`;
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

function isVoiceAttachment(a: MaxIncomingAttachment): boolean {
  const t = (a.type ?? '').toLowerCase();
  return t === 'voice' || t === 'audio';
}

function isDocumentAttachment(a: MaxIncomingAttachment): boolean {
  const t = (a.type ?? '').toLowerCase();
  return t === 'document' || t === 'file';
}

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

function humanizeError(message: string): string {
  if (message.includes('document_too_large')) return 'файл слишком большой';
  if (message.includes('document_empty')) return 'файл пустой';
  return 'попробуйте ещё раз';
}
