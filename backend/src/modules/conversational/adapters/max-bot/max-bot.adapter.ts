import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
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
import { VoxService } from '../../../ai/services/vox.service';
import { QueryClassifierService } from '../../../dialog-layer/services/query-classifier.service';
import { DocumentsService } from '../../../documents/documents.service';
import { S3Service } from '../../../recordings/s3.service';
import { ChannelRegistry } from '../../channel-registry';
import { ConversationalLinkCodeService } from '../../link-code.service';
import { channelClarifyKey } from '../../types/channel-clarify-key';
import type { ConversationalJson, IChannel, InboundMessage } from '../../types/channel.types';

import { MaxApiClient, MaxApiError } from './max-api-client';
import type {
  MaxBotChannelConfig,
  MaxIncomingAttachment,
  MaxMessage,
  MaxUpdate,
} from './max.types';

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
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(QueryClassifierService)
    private readonly classifier: QueryClassifierService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

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

  async ingest(_rawMessage: ConversationalJson): Promise<InboundMessage> {
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

  async parseResponse(_args: {
    rawMessage: ConversationalJson;
    openProbes: Notification[];
  }): Promise<null> {
    return null;
  }

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

    const voiceAtt = attachments.find((a) => isVoiceAttachment(a));
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
    }

    if (!text) {
      this.logger.debug('max inbound: пустой text без поддерживаемых attachments — игнор');
      return null;
    }

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

    const binding = await this.requireVerifiedBinding({
      externalUserId,
      channelId: channel.id,
      chatId,
      config,
    });
    if (!binding) return null;

    this.metrics.incBotInbound({ channel: 'max_bot', kind: 'text' });

    if (await this.isClarifyPending(binding.id)) {
      return {
        type: 'assistant_turn',
        userId: binding.userId,
        tenantId,
        text,
        metadata: { source: 'max_bot', chatId, clarifyResume: true },
        originChannelBindingId: binding.id,
      };
    }

    const openProbe = await this.findOpenProbe({
      tenantId,
      userId: binding.userId,
    });
    if (openProbe && openProbe.question) {
      const probeIntent = await this.classifyIntent({
        text,
        tenantId,
        userId: binding.userId,
        openProbeQuestion: openProbe.question,
      });
      if (probeIntent === 'probe_reply') {
        return {
          type: 'response',
          userId: binding.userId,
          tenantId,
          notificationId: openProbe.id,
          payload: { text, kind: 'implicit_response' },
          originChannelBindingId: binding.id,
        };
      }
    }

    if (this.isAssistantRoutingEnabled()) {
      return {
        type: 'assistant_turn',
        userId: binding.userId,
        tenantId,
        text,
        metadata: { source: 'max_bot', chatId },
        originChannelBindingId: binding.id,
      };
    }

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
        text: 'Добро пожаловать. Чтобы привязать аккаунт, получите код в личном кабинете (раздел «Каналы») и отправьте его сюда сообщением.',
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
      text: 'Готово! Аккаунт привязан. Теперь сюда будут приходить вопросы и уведомления Коры. Просто напишите текст, голос или пришлите документ.',
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
        text: 'Не удалось распознать голос. Попробуйте отправить текст или повторите голосовое.',
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

    if (await this.isClarifyPending(args.binding.id)) {
      return {
        type: 'assistant_turn',
        userId: args.binding.userId,
        tenantId: args.tenantId,
        text: transcript,
        metadata: {
          source: 'max_bot',
          kind: 'voice',
          chatId: args.chatId,
          clarifyResume: true,
          ...(audioS3Key ? { audioS3Key } : {}),
        },
        originChannelBindingId: args.binding.id,
      };
    }

    if (this.isAssistantRoutingEnabled()) {
      return {
        type: 'assistant_turn',
        userId: args.binding.userId,
        tenantId: args.tenantId,
        text: transcript,
        metadata: {
          source: 'max_bot',
          kind: 'voice',
          chatId: args.chatId,
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
        source: 'max_bot',
        kind: 'voice',
        chatId: args.chatId,
        ...(audioS3Key ? { audioS3Key } : {}),
      },
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
        text: 'Файл слишком большой (>20 МБ). Загрузите его через веб-кабинет.',
      });
      return;
    }
    const url = args.attachment.payload?.url;
    if (!url) {
      this.logger.warn({ attachment: args.attachment }, 'max document: нет payload.url — игнор');
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
        text: 'Не удалось привязать файл к профилю сотрудника. Обратитесь к админу.',
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
          originalName: args.attachment.payload?.file_name ?? 'max-document',
          mimeType: args.attachment.payload?.mime_type ?? 'application/octet-stream',
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
        text: 'Документ принят. Я разберу его и подключу к знаниям компании.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ tenantId: args.tenantId, err: message }, 'max document: upload failed');
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
        'max voice: S3 сохранение оригинала не удалось — продолжаю без аудио',
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
    return count <= MaxBotChannelAdapter.VOICE_PER_HOUR_PER_USER;
  }

  private async isClarifyPending(bindingId: string): Promise<boolean> {
    try {
      const raw = await this.redis.client.get(channelClarifyKey(bindingId));
      return raw != null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'max inbound: Redis get clarify-ключа упал — обрабатываем как обычный ход',
      );
      return false;
    }
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
        text: 'Аккаунт не привязан. Получите код в личном кабинете (раздел «Каналы») и отправьте его сюда сообщением.',
      });
      return null;
    }
    return binding;
  }

  /**
   * ТЗ 2026-06-17 probe-phase2 Ф1 — последний неотвеченный probe-вопрос
   * пользователя (для распознавания свободного ответа; в MAX reply нет вовсе).
   * Возвращает id уведомления и текст вопроса из payload (`question` для
   * probe.question; для probe.digest — '').
   */
  private async findOpenProbe(args: {
    tenantId: string;
    userId: string;
  }): Promise<{ id: string; question: string } | null> {
    const openProbe = await this.prisma.notification.findFirst({
      where: {
        tenantId: args.tenantId,
        recipientUserId: args.userId,
        eventType: { in: ['probe.question', 'probe.digest'] },
        responseStatus: 'pending',
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

  /**
   * ТЗ 2026-06-17 probe-phase2 Ф1 — минимальная уверенность классификатора,
   * с которой свободный текст засчитывается ответом на probe. AdminSetting
   * `probe.replyClassifyMinConfidence` (дефолт 0.6); читается через
   * TypedConfigService.getDynamic (как прочие probe.*-крутилки).
   */
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

  private async classifyIntent(args: {
    text: string;
    tenantId: string;
    userId: string;
    /**
     * ТЗ 2026-06-17 probe-phase2 Ф1 — текст последнего неотвеченного probe.
     * Если задан — классификатор может вернуть `probe_reply` (ответ на вопрос
     * Коры свободным текстом; в MAX reply нет вовсе — это единственный путь).
     */
    openProbeQuestion?: string;
  }): Promise<'chat_query' | 'free_note' | 'probe_reply'> {
    if (this.cfg.bot.intentClassifierEnabled) {
      try {
        const result = await this.classifier.classify({
          tenantId: args.tenantId,
          userId: args.userId,
          question: args.text,
          conversationId: null,
          openProbeQuestion: args.openProbeQuestion,
        });

        // ТЗ 2026-06-17 probe-phase2 Ф1 — ответ на probe свободным текстом.
        // Гейт по `probe.replyClassifyMinConfidence`; notificationId найденного
        // probe подставляет вызывающий код (handleMessage).
        if (result.intent === 'probe_reply') {
          const conf = result.confidence ?? 0;
          const minConf = await this.getProbeReplyMinConfidence();
          if (conf >= minConf) {
            this.metrics.incBotIntentClassified({
              channel: 'max_bot',
              intent: 'free_note',
              source: result.source === 'heuristic' ? 'heuristic' : 'llm',
            });
            return 'probe_reply';
          }
          // Ниже порога — не засчитываем, продолжаем обычным маппингом.
        }
        const intent: 'chat_query' | 'free_note' =
          result.intent === 'factual' ||
          result.intent === 'exploratory' ||
          result.intent === 'analytical' ||
          result.intent === 'clone_roleplay'
            ? 'chat_query'
            : 'free_note';
        const source: 'llm' | 'heuristic' = result.source === 'heuristic' ? 'heuristic' : 'llm';
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

  private renderText(notification: Notification): string {
    const payload = (notification.payload as Record<string, unknown> | null) ?? {};
    switch (notification.eventType) {
      case 'probe.question': {
        const q = (payload['question'] as string | undefined) ?? '';
        const ctx = (payload['context'] as string | undefined) ?? '';
        const head = 'Кора уточняет:';
        const tail = ctx ? `\n\n${ctx}` : '';
        return `${head}\n\n${q}${tail}\n\nОтветьте текстом этим же сообщением.`.slice(0, 4000);
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
        const title = (payload['meetingTitle'] as string | undefined) ?? '';
        const host = (payload['hostName'] as string | undefined) ?? '';
        const joinUrl = (payload['joinUrl'] as string | undefined) ?? '';
        const who = host ? `${host} приглашает вас на встречу:` : 'Вас приглашают на встречу:';
        const body = title ? `\n«${title}»` : '';
        const link = joinUrl ? `\n\nПрисоединиться:\n${joinUrl}` : '';
        return `Приглашение на встречу\n\n${who}${body}${link}`.slice(0, 4000);
      }
      case 'probe.digest': {
        const summary = (payload['summary'] as string | undefined) ?? '';
        return `Кора собрала вопросы:\n\n${summary}\n\nОтветьте на любой из них текстом этим же сообщением.`.slice(
          0,
          4000,
        );
      }
      case 'probe.answer_acknowledged': {
        const text =
          (payload['text'] as string | undefined) ??
          (payload['summary'] as string | undefined) ??
          'Спасибо! Ваш ответ записан.';
        return `${text}`.slice(0, 4000);
      }
      case 'checkin.prompt': {
        const q = (payload['question'] as string | undefined) ?? '';
        if (q.trim()) {
          return `${q}\n\nОтветьте текстом или голосом — Кора запишет.`.slice(0, 4000);
        }
        break;
      }
      case 'note.ack': {
        const text = (payload['text'] as string | undefined) ?? '';
        return (text.trim() ? text : 'Записал в память Коры 🧠').slice(0, 4000);
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
        const head = `⏰ Напоминание: ${eventTitle}`;
        const whenLine = when ? `\nНачало: в ${when} (UTC)` : '';
        const locLine = location ? `\nМесто: ${location}` : '';
        return `${head}${whenLine}${locLine}`.slice(0, 4000);
      }
      case 'issue.mention': {
        const ref =
          (payload['issueIdentifier'] as string | undefined) ??
          (payload['issueTitle'] as string | undefined) ??
          '';
        const snippet = (payload['snippet'] as string | undefined) ?? '';
        const head = ref ? `Вас упомянули в задаче ${ref}` : 'Вас упомянули в задаче';
        const tail = snippet ? `\n\n${snippet}` : '';
        return `${head}${tail}`.slice(0, 4000);
      }
      case 'issue.assigned': {
        const ref = (payload['issueIdentifier'] as string | undefined) ?? '';
        const title = (payload['issueTitle'] as string | undefined) ?? '';
        const by = (payload['byName'] as string | undefined) ?? '';
        const due = (payload['dueDate'] as string | undefined) ?? '';
        const url = (payload['actionUrl'] as string | undefined) ?? '';
        const head = ref ? `Вам поставили задачу ${ref}` : 'Вам поставили задачу';
        const t = title ? `\n\n«${title}»` : '';
        const who = by ? `\nПоставил(а): ${by}` : '';
        const when = due ? `\nСрок: ${formatRuDate(due)}` : '';
        const link = url ? `\n\nОткрыть:\n${url}` : '';
        return `${head}${t}${who}${when}${link}`.slice(0, 4000);
      }
      case 'task.closed_for_review': {
        const text = (payload['text'] as string | undefined) ?? '';
        const objectTitle = (payload['objectTitle'] as string | undefined) ?? '';
        const head = 'Задача закрыта — проверьте';
        const body = text.trim()
          ? `\n\n${text}`
          : objectTitle.trim()
            ? `\n\n«${objectTitle}»`
            : '';
        return `${head}${body}`.slice(0, 4000);
      }
      case 'support.ticket_created': {
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        return `Обращение №${num} создано: ${subject}`.slice(0, 4000);
      }
      case 'support.ticket_reply': {
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        const snippet = (payload['snippet'] as string | undefined) ?? '';
        const head = `Ответ по обращению №${num}: ${subject}`;
        const tail = snippet ? `\n\n${snippet}` : '';
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
        const head = `Идея сменила статус: ${statement}`;
        const transition = oldStatus || newStatus ? `\n${oldStatus} → ${newStatus}` : '';
        const why = reason ? `\nПричина: ${reason}` : '';
        return `${head}${transition}${why}`.slice(0, 4000);
      }
      case 'actions.reminder': {
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
    const genericTitle = (payload['title'] as string | undefined) ?? '';
    const genericBody = (payload['body'] as string | undefined) ?? '';
    if (genericTitle.trim() && genericBody.trim()) {
      const actionUrl = (payload['actionUrl'] as string | undefined) ?? '';
      const link = actionUrl ? `\n\nОткрыть:\n${actionUrl}` : '';
      return `${genericTitle}\n\n${genericBody}${link}`.slice(0, 4000);
    }
    return `Уведомление: ${notification.eventType}`;
  }

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
