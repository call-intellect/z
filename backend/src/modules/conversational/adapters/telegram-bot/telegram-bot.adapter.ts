import {
  Inject,
  Injectable,
  Logger,
  Optional,
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
import { AccountsService } from '../../../accounts/accounts.service';
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

import { formatCheckinAck } from './format-checkin-ack';
import { TelegramApiClient, TelegramApiError } from './telegram-api-client';
import { TelegramBotMessageHandler } from './telegram-bot-message.handler';
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

  /**
   * β-9 / Phase 6 (2026-05-25) — единственная допустимая slash-команда
   * помимо `/start`. Поддерживает суффикс `@<bot_username>` (типично для
   * групповых чатов; на MVP бот только в личке, но сохраняем совместимость).
   */
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
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(QueryClassifierService)
    private readonly classifier: QueryClassifierService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    // Wave 3 / Tracker Phase 4 РФ (2026-05-24): task-flow handler. @Optional —
    // если TelegramBotMessageHandler не зарегистрирован в DI (например, в
    // существующих unit-тестах адаптера), fallback на старый pipeline.
    @Optional()
    @Inject(TelegramBotMessageHandler)
    private readonly taskHandler?: TelegramBotMessageHandler,
    // β-9 / Phase 6 (2026-05-25): команда `/login` в боте — выпуск magic-link
    // на 15 минут через AccountsService. @Optional, чтобы не ломать
    // существующие unit-тесты адаптера, которые конструируют его напрямую
    // без AccountsService. В DI прод-сборки сервис всегда доступен через
    // импорт AccountsModule в ConversationalModule.
    @Optional()
    @Inject(AccountsService)
    private readonly accounts?: AccountsService,
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
     
    _rawMessage: ConversationalJson,
  ): Promise<InboundMessage> {
    throw new Error(
      'TelegramBotChannelAdapter.ingest: используйте ingestUpdate(update, tenantId, channel) — IChannel.ingest не вызывается напрямую для telegram',
    );
  }

  /**
   * Главный inbound-метод для webhook controller'а. Принимает Update +
   * `channel` (после β-9 — глобальный, `tenantId IS NULL`). `tenantId`
   * сообщения — опциональный аргумент: если передан (legacy путь
   * `/webhooks/telegram-bot/:tenantId`), используем его; иначе — резолвим
   * через `ChannelBinding → Membership` от `from.id`. Если отправитель
   * незнаком (нет binding) или у него нет ни одного Membership —
   * отвечаем подсказкой и возвращаем `null`.
   *
   * Возвращает `InboundMessage` или `null` (если адаптер сам обработал
   * сообщение — привязка, voice → ASR, document → DocumentsService,
   * незнакомый отправитель и т.п.).
   */
  async ingestUpdate(args: {
    update: TelegramUpdate;
    /**
     * Опциональный tenantId. Передаётся только legacy webhook'ом
     * `/webhooks/telegram-bot/:tenantId` (deprecated в β-9). Для нового
     * глобального webhook'а — `undefined`; tenantId резолвится из
     * `ChannelBinding → Membership` отправителя.
     */
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

    // β-9: tenantId либо задан вызывающим (legacy `:tenantId` webhook),
    // либо резолвится из `ChannelBinding.userId → Membership.orgId`
    // внутри handler'ов. Здесь готовим контекстный резолвер один раз.
    const resolveTenantForBinding = async (
      binding: ChannelBinding,
    ): Promise<string | null> => {
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

    // 1. /start <token> — единственный разрешённый slash. Без аргумента —
    //    приветствие. С аргументом — попытка прожечь как link-code.
    //    Для linking-flow tenantId не нужен (`linkCode.consume` хранит
    //    userId, а Membership уже создан раньше через приглашение).
    //    Передаём «-» как placeholder, если legacy путь не задал tenantId.
    const tenantPlaceholder = args.tenantId ?? '';
    const text = (msg.text ?? '').trim();

    // 1.0. /login (β-9 Phase 6) — выпуск magic-link на 15 минут для входа
    //      в веб-кабинет. Работает только для уже привязанного пользователя
    //      (verified binding). Незалинкованным — подсказка попросить
    //      ссылку у руководителя. AccountsService — @Optional в DI,
    //      поэтому при отсутствии (старые unit-тесты) ветка деградирует
    //      молча и сообщение продолжит идти по обычному pipeline.
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
      const tenantId = await resolveTenantForBinding(binding);
      if (!tenantId) {
        await this.replyToUserBestEffort({
          config,
          chatId: msg.chat.id,
          text:
            'Вы не привязаны к компании. Попросите руководителя выслать вам ссылку-приглашение в кабинет.',
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
      // ТЗ 2026-06-10 §2 — структурные спецслучаи (forward/reply) до ASR.
      // Plain voice БОЛЬШЕ не перехватывается как задача безусловно: его
      // транскрибирует handleVoice и классифицирует (task/show_tasks/вопрос/
      // план/заметка) — гейт намерения работает и для голоса.
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
      const tenantId = await resolveTenantForBinding(binding);
      if (!tenantId) {
        await this.replyToUserBestEffort({
          config,
          chatId: msg.chat.id,
          text:
            'Вы не привязаны к компании. Попросите руководителя выслать вам ссылку-приглашение в кабинет.',
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
          tenantId: tenantPlaceholder,
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
    const tenantId = await resolveTenantForBinding(binding);
    if (!tenantId) {
      await this.replyToUserBestEffort({
        config,
        chatId: msg.chat.id,
        text:
          'Вы не привязаны к компании. Попросите руководителя выслать вам ссылку-приглашение в кабинет.',
      });
      return null;
    }

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

    // 7.5. ТЗ 2026-06-10 §2 Ф3 — структурные спецслучаи task-flow (reply на
    //      наше уведомление о задаче + forward «преврати в задачу»)
    //      обрабатываются ДО классификации намерения. Plain text БОЛЬШЕ не
    //      перехватывается безусловно как задача — её разбирает классификатор
    //      ниже (фикс обхода гейта намерения: «план/вопрос» больше не падают
    //      в IntakeIssue). task/show_tasks → отдельный маршрут после classify.
    if (this.taskHandler) {
      const handled = await this.taskHandler.tryHandleStructural({
        msg,
        binding,
        tenantId,
        config,
      });
      if (handled) return null;
    }

    // 8. Intent classification (LLM + fallback на эвристики).
    const intent = await this.classifyIntent({
      text: rawText,
      tenantId,
      userId: binding.userId,
    });

    // ТЗ 2026-06-10 §2 Ф2 — task / show_tasks обрабатывает task-handler напрямую
    // (создание задачи / читалка «мои задачи»): бот сам отвечает пользователю →
    // InboundMessage не нужен. Если handler недоступен — упадёт в free_note ниже.
    if (intent === 'task' && this.taskHandler) {
      await this.taskHandler.handleCreateTask({
        msg,
        binding,
        tenantId,
        config,
        text: rawText,
        externalId: `${msg.chat.id}:${msg.message_id}`,
      });
      return null;
    }
    if (intent === 'show_tasks' && this.taskHandler) {
      await this.taskHandler.handleShowTasks({ msg, binding, tenantId, config });
      return null;
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
    // ТЗ 2026-05-29 telegram-self-initiated-checkins — само-инициированный план/отчёт.
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

  // ─────────────────────────────── parseResponse (stub) ─────────────

  async parseResponse(
     
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

  /**
   * β-9 / Phase 6 (2026-05-25) — обработчик команды `/login`.
   *
   * Контракт:
   *   - Если binding есть и verified → выпускаем magic-link через
   *     `AccountsService.requestMagicLinkForBot`, шлём ссылку обратно
   *     в чат. Метрика `bot_login_command_total{outcome='ok'}` —
   *     инкрементится самим `AccountsService`.
   *   - Если binding отсутствует / не verified → reply «сначала
   *     привяжите бот по ссылке от руководителя» + метрика
   *     `outcome='not_linked'`.
   *   - Если AccountsService недоступен (DI deg., например в старых
   *     unit-тестах адаптера) → reply «временно недоступно» и тихо
   *     выходим. Метрика не пишется.
   */
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
        text:
          'Команда /login сейчас временно недоступна. Попробуйте позже или войдите по ссылке из письма.',
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
        text:
          'Сначала привяжите бот по ссылке от руководителя. После этого команда /login откроет вам ссылку для входа в кабинет.',
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
        text:
          `Перейдите по ссылке для входа в кабинет. Ссылка действует ${ttlMinutes} минут.\n\n${url}`,
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
        text:
          'Не удалось выпустить ссылку. Попросите руководителя перепривязать вас или обратитесь в поддержку.',
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

    // ТЗ 2026-06-10 §2 — голосовая задача / «покажи задачи» → task-handler
    // напрямую (бот сам отвечает), как и в текстовом пути.
    if (intent === 'task' && this.taskHandler) {
      await this.taskHandler.handleCreateTask({
        msg: args.msg,
        binding: args.binding,
        tenantId: args.tenantId,
        config: args.config,
        text: transcript,
        externalId: `${args.msg.chat.id}:${args.msg.message_id}`,
      });
      return null;
    }
    if (intent === 'show_tasks' && this.taskHandler) {
      await this.taskHandler.handleShowTasks({
        msg: args.msg,
        binding: args.binding,
        tenantId: args.tenantId,
        config: args.config,
      });
      return null;
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
    // ТЗ 2026-05-29 telegram-self-initiated-checkins — голос «план/отчёт»
    // после ASR попадает в тот же classifier и маппится в daily_checkin_self.
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
   * β-9: дополнительно инкрементим `telegram_bot_unknown_sender_total{reason='no_binding'}`,
   * чтобы видеть массовые попытки войти в бот без приглашения (типичный
   * сигнал, что нужно перевыпустить ссылку или пользователь незнаком).
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
      this.metrics.incTelegramBotUnknownSender({ reason: 'no_binding' });
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
   * на эвристику.
   *
   * ТЗ 2026-05-29 telegram-self-initiated-checkins (Phase 2):
   * - возвращаемый тип расширен на `daily_plan_morning | daily_report_evening`;
   * - `skipHeuristicFirstPass: true` — для bot-flow каждый текст идёт в LLM
   *   с расширенным 7-категорийным промптом;
   * - confidence-gate ≥0.7 для plan/report — иначе fall through в `free_note`
   *   (LLM не уверен → лучше уйдёт в общий поток памяти, чем создать ложный
   *   чек-ин в дашборде руководителя);
   * - дополнительная метрика `z_bot_checkin_intent_classifier_total{kind, source}`
   *   когда LLM/fallback вернул plan/report.
   *
   * Маппинг старой метрики `bot_intent_classified_total{intent}` сохраняется
   * бинарным (chat_query | free_note) — plan/report маппятся в `free_note`,
   * чтобы не ломать существующий тип метрики. Детальный учёт plan/report —
   * через новую метрику `z_bot_checkin_intent_classifier_total`.
   */
  private async classifyIntent(args: {
    text: string;
    tenantId: string;
    userId: string;
  }): Promise<
    | 'chat_query'
    | 'free_note'
    | 'daily_plan_morning'
    | 'daily_report_evening'
    | 'task'
    | 'show_tasks'
  > {
    if (this.cfg.bot.intentClassifierEnabled) {
      try {
        const result = await this.classifier.classify({
          tenantId: args.tenantId,
          userId: args.userId,
          question: args.text,
          conversationId: null,
          skipHeuristicFirstPass: true,
        });

        // ТЗ 2026-05-29: confidence-gate для plan/report.
        // Если LLM вернул plan/report с уверенностью <0.7 — fall through
        // в `note` (= free_note). Лучше потерять план в общем потоке памяти,
        // чем создать ложный чек-ин в дашборде руководителя.
        const conf = result.confidence ?? 0;
        const isPlan = result.intent === 'daily_plan_morning';
        const isReport = result.intent === 'daily_report_evening';

        if ((isPlan || isReport) && conf >= 0.7) {
          // Новая метрика — distinct учёт plan/report с разбивкой по source.
          const checkinSource:
            | 'llm'
            | 'fallback_heuristic'
            | 'fallback_factual_at_llm_fail' =
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
          // Для совместимости со старой метрикой bot_intent_classified_total
          // (тип intent: 'chat_query' | 'free_note') маппим plan/report в
          // 'free_note' — детальная разбивка делается в новой метрике выше.
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

        // ТЗ 2026-06-10 §2 — task: поставить задачу в трекер. Gate >=0.7;
        // task с conf<0.7 проваливается ниже в `free_note` (note) — корректно
        // (лучше заметка в потоке, чем ложная задача).
        if (result.intent === 'task' && conf >= 0.7) {
          this.metrics.incBotIntentClassified({
            channel: 'telegram_bot',
            intent: 'task',
            source: intentSource,
          });
          return 'task';
        }
        // show_tasks: показать мои задачи. Gate >=0.7 → show_tasks; иначе →
        // chat_query (трактуем как вопрос — отвечаем из памяти, не молчим и
        // не плодим задачу).
        if (result.intent === 'show_tasks') {
          const routed: 'show_tasks' | 'chat_query' =
            conf >= 0.7 ? 'show_tasks' : 'chat_query';
          this.metrics.incBotIntentClassified({
            channel: 'telegram_bot',
            intent: routed,
            source: intentSource,
          });
          return routed;
        }

        // chat-категории → chat_query. Всё остальное (включая `note`,
        // plan/report и task с conf<0.7) → free_note.
        const isChat =
          result.intent === 'factual' ||
          result.intent === 'exploratory' ||
          result.intent === 'analytical' ||
          result.intent === 'clone_roleplay';
        const intent: 'chat_query' | 'free_note' = isChat
          ? 'chat_query'
          : 'free_note';
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
      case 'checkin.ack': {
        // ТЗ 2026-05-29 telegram-self-initiated-checkins §Backend.12 — 4 шаблона.
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
        // ТЗ 2026-06-04 (meeting-identity) Фаза 3.3 — приглашение на встречу.
        const title = (payload['meetingTitle'] as string | undefined) ?? '';
        const host = (payload['hostName'] as string | undefined) ?? '';
        const joinUrl = (payload['joinUrl'] as string | undefined) ?? '';
        const head = '<b>Приглашение на встречу</b>';
        const who = host ? `${escapeHtml(host)} приглашает вас на встречу:` : 'Вас приглашают на встречу:';
        const body = title ? `\n«${escapeHtml(title)}»` : '';
        const link = joinUrl
          ? `\n\nПрисоединиться:\n${escapeHtml(joinUrl)}`
          : '';
        return `${head}\n\n${who}${body}${link}`.slice(0, 4000);
      }
      case 'probe.digest': {
        // Probe Фаза 3 — батч-дайджест: человеческий текст уже собран в summary.
        const summary = (payload['summary'] as string | undefined) ?? '';
        const head = '<b>Кора собрала вопросы</b>';
        return `${head}\n\n${escapeHtml(summary)}\n\nОтветьте на любой из них текстом этим же сообщением.`.slice(
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
        return escapeHtml(text).slice(0, 4000);
      }
      case 'checkin.prompt': {
        // Ф2 (assistant-channels 2026-06-11) — утренний/вечерний чек-ин:
        // готовый текст вопроса уже лежит в payload.question.
        const q = (payload['question'] as string | undefined) ?? '';
        if (q.trim()) {
          return `${escapeHtml(q)}\n\nОтветьте текстом или голосом — Кора запишет.`.slice(
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
        return (
          text.trim() ? escapeHtml(text) : 'Записал в память Коры 🧠'
        ).slice(0, 4000);
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
        const head = `⏰ Напоминание: ${escapeHtml(eventTitle)}`;
        const whenLine = when ? `\nНачало: в ${when} (UTC)` : '';
        const locLine = location ? `\nМесто: ${escapeHtml(location)}` : '';
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
          ? `<b>Вас упомянули в задаче ${escapeHtml(ref)}</b>`
          : '<b>Вас упомянули в задаче</b>';
        const tail = snippet ? `\n\n${escapeHtml(snippet)}` : '';
        return `${head}${tail}`.slice(0, 4000);
      }
      case 'support.ticket_created': {
        // Ф2 — подтверждение создания обращения в поддержку.
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        return `<b>Обращение №${escapeHtml(num)} создано:</b> ${escapeHtml(subject)}`.slice(
          0,
          4000,
        );
      }
      case 'support.ticket_reply': {
        // Ф2 — ответ поддержки по обращению.
        const num = String(payload['ticketNumber'] ?? '');
        const subject = (payload['subject'] as string | undefined) ?? '';
        const snippet = (payload['snippet'] as string | undefined) ?? '';
        const head = `<b>Ответ по обращению №${escapeHtml(num)}:</b> ${escapeHtml(subject)}`;
        const tail = snippet ? `\n\n${escapeHtml(snippet)}` : '';
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
        const head = `<b>Идея сменила статус:</b> ${escapeHtml(statement)}`;
        const transition =
          oldStatus || newStatus
            ? `\n${escapeHtml(oldStatus)} → ${escapeHtml(newStatus)}`
            : '';
        const why = reason ? `\nПричина: ${escapeHtml(reason)}` : '';
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
        const head = `<b>Ждут вашего решения: ${total}</b>${urgent > 0 ? ` (срочных: ${urgent})` : ''}`;
        const list =
          rawLines.length > 0
            ? `\n\n${rawLines.map((l) => escapeHtml(l)).join('\n')}`
            : '';
        const link = actionUrl ? `\n\nОткрыть:\n${escapeHtml(actionUrl)}` : '';
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
      const link = actionUrl ? `\n\nОткрыть:\n${escapeHtml(actionUrl)}` : '';
      return `<b>${escapeHtml(genericTitle)}</b>\n\n${escapeHtml(genericBody)}${link}`.slice(
        0,
        4000,
      );
    }
    // Неизвестный тип без title/body — прежний generic-fallback.
    return `Уведомление: ${escapeHtml(notification.eventType)}`;
  }

   
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
