import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
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
import { formatRuDate } from '../../../../common/utils/format-ru-date';
import { AccountsService } from '../../../accounts/accounts.service';
import { VoxService } from '../../../ai/services/vox.service';
import { QueryClassifierService } from '../../../dialog-layer/services/query-classifier.service';
import { DocumentsService } from '../../../documents/documents.service';
import { S3Service } from '../../../recordings/s3.service';
import { ChannelRegistry } from '../../channel-registry';
import { ConversationalLinkCodeService } from '../../link-code.service';
import { channelClarifyKey } from '../../types/channel-clarify-key';
import type { ConversationalJson, IChannel, InboundMessage } from '../../types/channel.types';

import { formatCheckinAck } from './format-checkin-ack';
import { TelegramApiClient, TelegramApiError } from './telegram-api-client';
import { TelegramBotMessageHandler } from './telegram-bot-message.handler';
import type { TelegramBotChannelConfig, TelegramMessage, TelegramUpdate } from './telegram.types';

@Injectable()
export class TelegramBotChannelAdapter implements IChannel, OnModuleInit {
  private readonly logger = new Logger(TelegramBotChannelAdapter.name);
  readonly kind: ChannelKind = 'telegram_bot';
  readonly maxDataClass: DataClass = 'internal';

  static readonly MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

  static readonly VOICE_PER_HOUR_PER_USER = 10;

  static readonly LINK_CODE_REGEX = /^[a-f0-9]{6,32}$/i;

  static readonly LOGIN_COMMAND_REGEX = /^\/login(?:@\w+)?$/i;

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
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(QueryClassifierService)
    private readonly classifier: QueryClassifierService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(TelegramBotMessageHandler)
    private readonly taskHandler?: TelegramBotMessageHandler,
    @Optional()
    @Inject(AccountsService)
    private readonly accounts?: AccountsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
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
          `telegram setMyCommands([]) ok channelId=${channel.id} tenantId=${channel.tenantId ?? 'GLOBAL'}`,
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
        throw new Error(`telegram_final:${err.code}:${err.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  async ingest(_rawMessage: ConversationalJson): Promise<InboundMessage> {
    throw new Error(
      'TelegramBotChannelAdapter.ingest: используйте ingestUpdate(update, tenantId, channel) — IChannel.ingest не вызывается напрямую для telegram',
    );
  }

  async ingestUpdate(args: {
    update: TelegramUpdate;
    tenantId?: string;
    channel: Channel;
  }): Promise<InboundMessage | null> {
    const { update, channel } = args;
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

    const resolveTenantForBinding = async (binding: ChannelBinding): Promise<string | null> => {
      if (args.tenantId) return args.tenantId;
      const membership = await this.prisma.membership.findFirst({
        where: { userId: binding.userId },
        orderBy: { joinedAt: 'asc' },
        select: { orgId: true },
      });
      if (!membership) {
        this.metrics.incTelegramBotUnknownSender({ reason: 'no_membership' });
        this.logger.warn(
          { userId: binding.userId, tgUserId: String(tgUserId) },
          'telegram inbound: binding есть, но у user нет ни одного Membership',
        );
        return null;
      }
      return membership.orgId;
    };

    const tenantPlaceholder = args.tenantId ?? '';
    const text = (msg.text ?? '').trim();

    if (TelegramBotChannelAdapter.LOGIN_COMMAND_REGEX.test(text)) {
      this.metrics.incBotInbound({
        channel: 'telegram_bot',
        kind: 'other',
      });
      await this.handleLogin({
        tgUserId: String(tgUserId),
        chatId: msg.chat.id,
        channel,
        config,
      });
      return null;
    }

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
        tenantId: tenantPlaceholder,
        channel,
        config,
      });
      return null;
    }

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
      const tenantId = await resolveTenantForBinding(binding);
      if (!tenantId) {
        await this.replyToUserBestEffort({
          config,
          chatId: msg.chat.id,
          text: 'Вы не привязаны к компании. Попросите руководителя выслать вам ссылку-приглашение в кабинет.',
        });
        return null;
      }
      if (!this.cfg.bot.voiceEnabled) {
        await this.replyToUserBestEffort({
          config,
          chatId: msg.chat.id,
          text: 'Голосовые сообщения сейчас недоступны. Напишите текстом.',
        });
        return null;
      }
      if (this.taskHandler) {
        const handled = await this.taskHandler.tryHandleStructural({
          msg,
          binding,
          tenantId,
          config,
        });
        if (handled) return null;
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

    if (msg.document) {
      this.metrics.incBotInbound({ channel: 'telegram_bot', kind: 'document' });
      const binding = await this.requireVerifiedBinding({
        tgUserId: String(tgUserId),
        channelId: channel.id,
        chatId: msg.chat.id,
        config,
      });
      if (!binding) return null;
      const tenantId = await resolveTenantForBinding(binding);
      if (!tenantId) {
        await this.replyToUserBestEffort({
          config,
          chatId: msg.chat.id,
          text: 'Вы не привязаны к компании. Попросите руководителя выслать вам ссылку-приглашение в кабинет.',
        });
        return null;
      }
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
      if (!msg.caption || !msg.caption.trim()) return null;
    }

    if (msg.photo && !msg.caption) {
      this.metrics.incBotInbound({ channel: 'telegram_bot', kind: 'other' });
      await this.replyToUserBestEffort({
        config,
        chatId: msg.chat.id,
        text: 'Изображения пока не поддерживаются. Отправьте текст, голос или документ (PDF/DOCX/MD/TXT).',
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
          tenantId: tenantPlaceholder,
          channel,
          config,
        });
        return null;
      }
    }

    const binding = await this.requireVerifiedBinding({
      tgUserId: String(tgUserId),
      channelId: channel.id,
      chatId: msg.chat.id,
      config,
    });
    if (!binding) return null;
    const tenantId = await resolveTenantForBinding(binding);
    if (!tenantId) {
      await this.replyToUserBestEffort({
        config,
        chatId: msg.chat.id,
        text: 'Вы не привязаны к компании. Попросите руководителя выслать вам ссылку-приглашение в кабинет.',
      });
      return null;
    }

    this.metrics.incBotInbound({ channel: 'telegram_bot', kind: 'text' });

    if (await this.isClarifyPending(binding.id)) {
      return {
        type: 'assistant_turn',
        userId: binding.userId,
        tenantId,
        text: rawText,
        metadata: { source: 'telegram_bot', chatId: msg.chat.id, clarifyResume: true },
        originChannelBindingId: binding.id,
      };
    }

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
    }

    if (this.taskHandler) {
      const handled = await this.taskHandler.tryHandleStructural({
        msg,
        binding,
        tenantId,
        config,
      });
      if (handled) return null;
    }

    const openProbe = await this.findOpenProbe({
      tenantId,
      userId: binding.userId,
    });

    const intent = await this.classifyIntent({
      text: rawText,
      tenantId,
      userId: binding.userId,
      openProbeQuestion: openProbe?.question || undefined,
    });

    if (intent === 'probe_reply' && openProbe) {
      return {
        type: 'response',
        userId: binding.userId,
        tenantId,
        notificationId: openProbe.id,
        payload: { text: rawText, kind: 'implicit_response' },
        originChannelBindingId: binding.id,
      };
    }

    if (
      this.isAssistantRoutingEnabled() &&
      intent !== 'daily_plan_morning' &&
      intent !== 'daily_report_evening'
    ) {
      return {
        type: 'assistant_turn',
        userId: binding.userId,
        tenantId,
        text: rawText,
        metadata: { source: 'telegram_bot', chatId: msg.chat.id, intent },
        originChannelBindingId: binding.id,
      };
    }

    if (intent === 'chat_query') {
      return {
        type: 'chat_query',
        userId: binding.userId,
        tenantId,
        question: rawText,
        originChannelBindingId: binding.id,
      };
    }
    if (intent === 'daily_plan_morning' || intent === 'daily_report_evening') {
      return {
        type: 'daily_checkin_self',
        userId: binding.userId,
        tenantId,
        kind: intent === 'daily_plan_morning' ? 'morning' : 'evening',
        rawText,
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

  async parseResponse(_args: {
    rawMessage: ConversationalJson;
    openProbes: Notification[];
  }): Promise<null> {
    return null;
  }

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
        text: 'Добро пожаловать. Чтобы привязать аккаунт, получите код в личном кабинете (раздел «Каналы») и отправьте его сюда сообщением.',
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

  private async handleLogin(args: {
    tgUserId: string;
    chatId: number;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    if (!this.accounts) {
      this.logger.warn(
        { tgUserId: args.tgUserId },
        'telegram /login: AccountsService недоступен в DI — деградация',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Команда /login сейчас временно недоступна. Попробуйте позже или войдите по ссылке из письма.',
      });
      return;
    }

    const binding = await this.prisma.channelBinding.findFirst({
      where: { channelId: args.channel.id, externalId: args.tgUserId },
    });
    if (!binding || !binding.verifiedAt) {
      this.metrics.incBotLoginCommand({ outcome: 'not_linked' });
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Сначала привяжите бот по ссылке от руководителя. После этого команда /login откроет вам ссылку для входа в кабинет.',
      });
      return;
    }

    try {
      const { url, ttlMinutes } = await this.accounts.requestMagicLinkForBot({
        userId: binding.userId,
      });
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: `Перейдите по ссылке для входа в кабинет. Ссылка действует ${ttlMinutes} минут.\n\n${url}`,
      });
    } catch (err) {
      this.logger.warn(
        {
          userId: binding.userId,
          tgUserId: args.tgUserId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram /login: requestMagicLinkForBot упал',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Не удалось выпустить ссылку. Попросите руководителя перепривязать вас или обратитесь в поддержку.',
      });
    }
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
      text: 'Готово! Аккаунт привязан. Теперь сюда будут приходить вопросы и уведомления Коры. Просто напишите текст, голос или пришлите документ.',
    });
  }

  private async handleVoice(args: {
    voice: NonNullable<TelegramMessage['voice']>;
    binding: ChannelBinding;
    msg: TelegramMessage;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<InboundMessage | null> {
    const allowed = await this.checkVoiceRateLimit({
      userId: args.binding.userId,
    });
    if (!allowed) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text: 'Слишком много голосовых сообщений за час. Попробуйте чуть позже.',
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

    const audioS3Key = await this.saveVoiceNoteAudio({
      tenantId: args.tenantId,
      buffer,
    });

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
        text: 'Не удалось распознать голос. Попробуйте отправить текст или повторите голосовое.',
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

    if (await this.isClarifyPending(args.binding.id)) {
      return {
        type: 'assistant_turn',
        userId: args.binding.userId,
        tenantId: args.tenantId,
        text: transcript,
        metadata: {
          source: 'telegram_bot',
          kind: 'voice',
          chatId: args.msg.chat.id,
          clarifyResume: true,
          ...(audioS3Key ? { audioS3Key } : {}),
        },
        originChannelBindingId: args.binding.id,
      };
    }

    const intent = await this.classifyIntent({
      text: transcript,
      tenantId: args.tenantId,
      userId: args.binding.userId,
    });

    if (
      this.isAssistantRoutingEnabled() &&
      intent !== 'daily_plan_morning' &&
      intent !== 'daily_report_evening'
    ) {
      return {
        type: 'assistant_turn',
        userId: args.binding.userId,
        tenantId: args.tenantId,
        text: transcript,
        metadata: {
          source: 'telegram_bot',
          kind: 'voice',
          chatId: args.msg.chat.id,
          intent,
          ...(audioS3Key ? { audioS3Key } : {}),
        },
        originChannelBindingId: args.binding.id,
      };
    }

    if (intent === 'chat_query') {
      return {
        type: 'chat_query',
        userId: args.binding.userId,
        tenantId: args.tenantId,
        question: transcript,
        originChannelBindingId: args.binding.id,
      };
    }
    if (intent === 'daily_plan_morning' || intent === 'daily_report_evening') {
      return {
        type: 'daily_checkin_self',
        userId: args.binding.userId,
        tenantId: args.tenantId,
        kind: intent === 'daily_plan_morning' ? 'morning' : 'evening',
        rawText: transcript,
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
        ...(audioS3Key ? { audioS3Key } : {}),
      },
      originChannelBindingId: args.binding.id,
    };
  }

  private async handleDocument(args: {
    document: NonNullable<TelegramMessage['document']>;
    binding: ChannelBinding;
    chatId: number;
    tenantId: string;
    channel: Channel;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    const sizeBytes = args.document.file_size ?? 0;
    if (sizeBytes > 0 && sizeBytes > TelegramBotChannelAdapter.MAX_DOCUMENT_BYTES) {
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Файл слишком большой (>20 МБ). Загрузите его через веб-кабинет.',
      });
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
        'telegram document: у user нет привязанного Person — отказ',
      );
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Не удалось привязать файл к профилю сотрудника. Обратитесь к админу.',
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
        text: 'Документ принят. Я разберу его и подключу к знаниям компании.',
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

  private isAssistantRoutingEnabled(): boolean {
    return this.cfg.bot.assistantChannelRoutingEnabled === true;
  }

  private async saveVoiceNoteAudio(args: {
    tenantId: string;
    buffer: Buffer;
  }): Promise<string | null> {
    const key = `voice-notes/${args.tenantId}/${randomUUID()}.ogg`;
    try {
      await this.s3.putObject({
        key,
        body: args.buffer,
        contentType: 'audio/ogg',
      });
      return key;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram voice: S3 сохранение оригинала не удалось — продолжаю без аудио',
      );
      return null;
    }
  }

  private async checkVoiceRateLimit(args: { userId: string }): Promise<boolean> {
    const hour = Math.floor(Date.now() / 3_600_000);
    const key = `bot:voice:rl:${args.userId}:${hour}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, 7200);
    }
    return count <= TelegramBotChannelAdapter.VOICE_PER_HOUR_PER_USER;
  }

  private async isClarifyPending(bindingId: string): Promise<boolean> {
    try {
      const raw = await this.redis.client.get(channelClarifyKey(bindingId));
      return raw != null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram inbound: Redis get clarify-ключа упал — обрабатываем как обычный ход',
      );
      return false;
    }
  }

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
      this.metrics.incTelegramBotUnknownSender({ reason: 'no_binding' });
      await this.replyToUserBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Аккаунт не привязан. Получите код в личном кабинете (раздел «Каналы») и отправьте его сюда сообщением.',
      });
      return null;
    }
    return binding;
  }

  private async classifyIntent(args: {
    text: string;
    tenantId: string;
    userId: string;
    openProbeQuestion?: string;
  }): Promise<
    | 'chat_query'
    | 'free_note'
    | 'daily_plan_morning'
    | 'daily_report_evening'
    | 'probe_reply'
  > {
    if (this.cfg.bot.intentClassifierEnabled) {
      try {
        const result = await this.classifier.classify({
          tenantId: args.tenantId,
          userId: args.userId,
          question: args.text,
          conversationId: null,
          skipHeuristicFirstPass: true,
          openProbeQuestion: args.openProbeQuestion,
        });

        if (result.intent === 'probe_reply') {
          const conf = result.confidence ?? 0;
          const minConf = await this.getProbeReplyMinConfidence();
          if (conf >= minConf) {
            this.metrics.incBotIntentClassified({
              channel: 'telegram_bot',
              intent: 'free_note',
              source: result.source === 'heuristic' ? 'heuristic' : 'llm',
            });
            return 'probe_reply';
          }
        }

        const conf = result.confidence ?? 0;
        const isPlan = result.intent === 'daily_plan_morning';
        const isReport = result.intent === 'daily_report_evening';

        if ((isPlan || isReport) && conf >= 0.7) {
          const checkinSource: 'llm' | 'fallback_heuristic' | 'fallback_factual_at_llm_fail' =
            result.source === 'llm'
              ? 'llm'
              : result.source === 'fallback_heuristic'
                ? 'fallback_heuristic'
                : 'fallback_factual_at_llm_fail';
          const kind: 'morning' | 'evening' = isPlan ? 'morning' : 'evening';
          this.metrics.incBotCheckinIntentClassifier({
            channel: 'telegram_bot',
            kind,
            source: checkinSource,
          });
          const intentSource: 'llm' | 'heuristic' =
            result.source === 'heuristic' ? 'heuristic' : 'llm';
          this.metrics.incBotIntentClassified({
            channel: 'telegram_bot',
            intent: 'free_note',
            source: intentSource,
          });
          return isPlan ? 'daily_plan_morning' : 'daily_report_evening';
        }

        const intentSource: 'llm' | 'heuristic' =
          result.source === 'heuristic' ? 'heuristic' : 'llm';

        const isChat =
          result.intent === 'factual' ||
          result.intent === 'exploratory' ||
          result.intent === 'analytical' ||
          result.intent === 'clone_roleplay';
        const intent: 'chat_query' | 'free_note' = isChat ? 'chat_query' : 'free_note';
        this.metrics.incBotIntentClassified({
          channel: 'telegram_bot',
          intent,
          source: intentSource,
        });
        return intent;
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'telegram classify: LLM упал — fallback на эвристики',
        );
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

  private async findOpenProbe(args: {
    tenantId: string;
    userId: string;
  }): Promise<{ id: string; question: string } | null> {
    const maxAgeDays = await this.getProbeImplicitMatchMaxAgeDays();
    const minCreatedAt = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const openProbe = await this.prisma.notification.findFirst({
      where: {
        tenantId: args.tenantId,
        recipientUserId: args.userId,
        eventType: { in: ['probe.question', 'probe.digest', 'probe.clarify', 'probe.confirm'] },
        responseStatus: 'pending',
        createdAt: { gte: minCreatedAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true },
    });
    if (!openProbe) return null;
    const payload =
      (openProbe.payload as Record<string, unknown> | null) ?? {};
    const question =
      typeof payload['question'] === 'string'
        ? (payload['question'] as string)
        : typeof payload['formulatedQuestion'] === 'string'
          ? (payload['formulatedQuestion'] as string)
          : '';
    return { id: openProbe.id, question };
  }

  private async getProbeReplyMinConfidence(): Promise<number> {
    try {
      return await this.cfg.getDynamic<number>(
        'probe.replyClassifyMinConfidence',
        undefined,
        0.6,
      );
    } catch {
      return 0.6;
    }
  }

  private async getProbeImplicitMatchMaxAgeDays(): Promise<number> {
    try {
      return await this.cfg.getDynamic<number>(
        'probe.implicit_match_max_age_days',
        undefined,
        3,
      );
    } catch {
      return 3;
    }
  }

  private renderText(notification: Notification): string {
    const payload = (notification.payload as Record<string, unknown> | null) ?? {};
    switch (notification.eventType) {
      case 'probe.question': {
        const q = (payload['question'] as string | undefined) ?? '';
        const ctx = (payload['context'] as string | undefined) ?? '';
        const head = '<b>Кора уточняет</b>';
        const body = escapeHtml(q);
        const tail = ctx ? `\n\n<i>${escapeHtml(ctx)}</i>` : '';
        return `${head}\n\n${body}${tail}\n\nОтветьте текстом этим же сообщением.`.slice(0, 4000);
      }
      case 'probe.clarify': {
        const q = (payload['question'] as string | undefined) ?? '';
        return `<b>Кора уточняет</b>\n\n${escapeHtml(q)}\n\nОтветьте текстом этим же сообщением.`.slice(
          0,
          4000,
        );
      }
      case 'probe.confirm': {
        const q = (payload['question'] as string | undefined) ?? '';
        return `<b>Кора уточняет, всё ли верно</b>\n\n${escapeHtml(q)}\n\nОтветьте «да» или поправьте.`.slice(
          0,
          4000,
        );
      }
      case 'specialist.probe': {
        const msg = (payload['message'] as string | undefined) ?? '';
        const reason = (payload['reason'] as string | undefined) ?? '';
        return `<b>Кора подсказывает</b> (${escapeHtml(reason)})\n\n${escapeHtml(msg)}`.slice(
          0,
          4000,
        );
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
      case 'checkin.ack': {
        const kind = payload['kind'] === 'evening' ? 'evening' : 'morning';
        const wasReplace = payload['wasReplace'] === true;
        const plansCount = Number(payload['plansCount'] ?? 0);
        const donesCount = Number(payload['donesCount'] ?? 0);
        const blockersCount = Number(payload['blockersCount'] ?? 0);
        const lowParserConfidence = payload['lowParserConfidence'] === true;
        return escapeHtml(
          formatCheckinAck({
            kind,
            wasReplace,
            plansCount,
            donesCount,
            blockersCount,
            lowParserConfidence,
          }),
        ).slice(0, 4000);
      }
      case 'meeting.invite': {
        const title = (payload['meetingTitle'] as string | undefined) ?? '';
        const host = (payload['hostName'] as string | undefined) ?? '';
        const joinUrl = (payload['joinUrl'] as string | undefined) ?? '';
        const head = '<b>Приглашение на встречу</b>';
        const who = host
          ? `${escapeHtml(host)} приглашает вас на встречу:`
          : 'Вас приглашают на встречу:';
        const body = title ? `\n«${escapeHtml(title)}»` : '';
        const link = joinUrl ? `\n\nПрисоединиться:\n${escapeHtml(joinUrl)}` : '';
        return `${head}\n\n${who}${body}${link}`.slice(0, 4000);
      }
      case 'probe.digest': {
        const summary = (payload['summary'] as string | undefined) ?? '';
        const head = '<b>Кора собрала вопросы</b>';
        return `${head}\n\n${escapeHtml(summary)}\n\nОтветьте на любой из них текстом этим же сообщением.`.slice(
          0,
          4000,
        );
      }
      case 'probe.answer_acknowledged': {
        const text =
          (payload['text'] as string | undefined) ??
          (payload['summary'] as string | undefined) ??
          'Спасибо! Ваш ответ записан.';
        return escapeHtml(text).slice(0, 4000);
      }
      case 'checkin.prompt': {
        const q = (payload['question'] as string | undefined) ?? '';
        if (q.trim()) {
          return `${escapeHtml(q)}\n\nОтветьте текстом или голосом — Кора запишет.`.slice(0, 4000);
        }
        break;
      }
      case 'note.ack': {
        const text = (payload['text'] as string | undefined) ?? '';
        return (text.trim() ? escapeHtml(text) : 'Записал в память Коры 🧠').slice(0, 4000);
      }
      case 'event.reminder': {
        const eventTitle = (payload['eventTitle'] as string | undefined) ?? '';
        const startAtIso = (payload['startAtIso'] as string | undefined) ?? '';
        const location = (payload['location'] as string | undefined) ?? '';
        const d = new Date(startAtIso);
        const pad = (n: number): string => String(n).padStart(2, '0');
        const when =
          startAtIso && !Number.isNaN(d.getTime())
            ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`
            : '';
        const head = `⏰ Напоминание: ${escapeHtml(eventTitle)}`;
        const whenLine = when ? `\nНачало: в ${when} (UTC)` : '';
        const locLine = location ? `\nМесто: ${escapeHtml(location)}` : '';
        return `${head}${whenLine}${locLine}`.slice(0, 4000);
      }
      case 'issue.mention': {
        const ref =
          (payload['issueIdentifier'] as string | undefined) ??
          (payload['issueTitle'] as string | undefined) ??
          '';
        const snippet = (payload['snippet'] as string | undefined) ?? '';
        const head = ref
          ? `<b>Вас упомянули в задаче ${escapeHtml(ref)}</b>`
          : '<b>Вас упомянули в задаче</b>';
        const tail = snippet ? `\n\n${escapeHtml(snippet)}` : '';
        return `${head}${tail}`.slice(0, 4000);
      }
      case 'issue.assigned': {
        const ref = (payload['issueIdentifier'] as string | undefined) ?? '';
        const title = (payload['issueTitle'] as string | undefined) ?? '';
        const by = (payload['byName'] as string | undefined) ?? '';
        const due = (payload['dueDate'] as string | undefined) ?? '';
        const url = (payload['actionUrl'] as string | undefined) ?? '';
        const head = ref
          ? `<b>Вам поставили задачу ${escapeHtml(ref)}</b>`
          : '<b>Вам поставили задачу</b>';
        const t = title ? `\n\n«${escapeHtml(title)}»` : '';
        const who = by ? `\nПоставил(а): ${escapeHtml(by)}` : '';
        const when = due ? `\nСрок: ${escapeHtml(formatRuDate(due))}` : '';
        const link = url ? `\n\nОткрыть:\n${escapeHtml(url)}` : '';
        return `${head}${t}${who}${when}${link}`.slice(0, 4000);
      }
      case 'task.closed_for_review': {
        const text = (payload['text'] as string | undefined) ?? '';
        const objectTitle = (payload['objectTitle'] as string | undefined) ?? '';
        const head = '<b>Задача закрыта — проверьте</b>';
        const body = text.trim()
          ? `\n\n${escapeHtml(text)}`
          : objectTitle.trim()
            ? `\n\n«${escapeHtml(objectTitle)}»`
            : '';
        return `${head}${body}`.slice(0, 4000);
      }
      case 'support.ticket_created': {
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        return `<b>Обращение №${escapeHtml(num)} создано:</b> ${escapeHtml(subject)}`.slice(
          0,
          4000,
        );
      }
      case 'support.ticket_reply': {
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        const snippet = (payload['snippet'] as string | undefined) ?? '';
        const head = `<b>Ответ по обращению №${escapeHtml(num)}:</b> ${escapeHtml(subject)}`;
        const tail = snippet ? `\n\n${escapeHtml(snippet)}` : '';
        return `${head}${tail}`.slice(0, 4000);
      }
      case 'idea.status_changed': {
        const title = (payload['title'] as string | undefined) ?? '';
        const body = (payload['body'] as string | undefined) ?? '';
        if (title.trim() && body.trim()) break;
        const statement = (payload['statement'] as string | undefined) ?? '';
        const oldStatus = (payload['oldStatus'] as string | undefined) ?? '';
        const newStatus = (payload['newStatus'] as string | undefined) ?? '';
        const reason = (payload['reason'] as string | undefined) ?? '';
        const head = `<b>Идея сменила статус:</b> ${escapeHtml(statement)}`;
        const transition =
          oldStatus || newStatus ? `\n${escapeHtml(oldStatus)} → ${escapeHtml(newStatus)}` : '';
        const why = reason ? `\nПричина: ${escapeHtml(reason)}` : '';
        return `${head}${transition}${why}`.slice(0, 4000);
      }
      case 'actions.reminder': {
        const total = Number(payload['total'] ?? 0);
        const urgent = Number(payload['urgentCount'] ?? 0);
        const rawLines = Array.isArray(payload['lines'])
          ? (payload['lines'] as unknown[]).map((l) => String(l))
          : [];
        const actionUrl = (payload['actionUrl'] as string | undefined) ?? '';
        const head = `<b>Ждут вашего решения: ${total}</b>${urgent > 0 ? ` (срочных: ${urgent})` : ''}`;
        const list =
          rawLines.length > 0 ? `\n\n${rawLines.map((l) => escapeHtml(l)).join('\n')}` : '';
        const link = actionUrl ? `\n\nОткрыть:\n${escapeHtml(actionUrl)}` : '';
        return `${head}${list}${link}`.slice(0, 4000);
      }
      case 'tasks.daily_open': {
        const title = (payload['title'] as string | undefined) ?? 'Ваши задачи на сегодня';
        const isEmpty = payload['isEmpty'] === true;
        const groups = Array.isArray(payload['groups'])
          ? (payload['groups'] as Array<Record<string, unknown>>)
          : [];
        const overflowCount = Number(payload['overflowCount'] ?? 0);
        if (isEmpty || groups.length === 0) {
          return `<b>${escapeHtml(title)}</b>\n\nНа сегодня открытых задач нет — хорошего дня.`.slice(
            0,
            4000,
          );
        }
        const fmtDay = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' });
        const blocks = groups
          .map((group) => {
            const label = (group['label'] as string | undefined) ?? '';
            const items = Array.isArray(group['items'])
              ? (group['items'] as Array<Record<string, unknown>>)
              : [];
            const itemLines = items
              .map((item) => {
                const identifier = (item['identifier'] as string | undefined) ?? '';
                const itemTitle = (item['title'] as string | undefined) ?? '';
                const dueDate = item['dueDate'] as string | null | undefined;
                const due =
                  dueDate && !Number.isNaN(new Date(dueDate).getTime())
                    ? ` · до ${escapeHtml(fmtDay.format(new Date(dueDate)))}`
                    : '';
                return `${escapeHtml(identifier)} — ${escapeHtml(itemTitle)}${due}`;
              })
              .join('\n');
            return `<b>${escapeHtml(label)}</b>\n${itemLines}`;
          })
          .join('\n\n');
        const tail = overflowCount > 0 ? `\n\n…и ещё ${overflowCount}` : '';
        return `<b>${escapeHtml(title)}</b>\n\n${blocks}${tail}`.slice(0, 4000);
      }
      default:
        break;
    }
    const genericTitle = (payload['title'] as string | undefined) ?? '';
    const genericBody = (payload['body'] as string | undefined) ?? '';
    if (genericTitle.trim() && genericBody.trim()) {
      const actionUrl = (payload['actionUrl'] as string | undefined) ?? '';
      const link = actionUrl ? `\n\nОткрыть:\n${escapeHtml(actionUrl)}` : '';
      return `<b>${escapeHtml(genericTitle)}</b>\n\n${escapeHtml(genericBody)}${link}`.slice(
        0,
        4000,
      );
    }
    return `Уведомление: ${escapeHtml(notification.eventType)}`;
  }

  private maybeReplyToMessageId(_delivery: NotificationDelivery): number | undefined {
    return undefined;
  }

  private readChannelConfig(channel: Channel): TelegramBotChannelConfig {
    const raw = channel.config as Record<string, unknown> | null;
    if (!raw) {
      throw new Error(
        `TelegramBotChannelAdapter.readChannelConfig: пустой config (channelId=${channel.id})`,
      );
    }
    const tokenEnc = String(raw['botToken'] ?? '');
    const secretEnc = String(raw['webhookSecret'] ?? '');
    const username = raw['botUsername'] ? String(raw['botUsername']) : undefined;
    return {
      botToken: tokenEnc ? this.decryptIfNeeded(tokenEnc) : '',
      webhookSecret: secretEnc ? this.decryptIfNeeded(secretEnc) : '',
      botUsername: username,
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  if (message.includes('document_too_large')) {
    return 'файл слишком большой';
  }
  if (message.includes('document_empty')) {
    return 'файл пустой';
  }
  return 'попробуйте ещё раз';
}
