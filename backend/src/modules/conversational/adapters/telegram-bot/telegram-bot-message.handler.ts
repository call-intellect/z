import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import type { ChannelBinding, Issue } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { VoxService } from '../../../ai/services/vox.service';
import { tenantTopOf } from '../../../dialog-layer/utils/tenant-top';
import { CommentsService } from '../../../tracker/services/comments.service';
import { IntakeAutoTriageQueueService } from '../../../tracker/services/intake-auto-triage-queue.service';
import { IssuesService } from '../../../tracker/services/issues.service';

import { TelegramApiClient, TelegramApiError } from './telegram-api-client';
import type {
  TelegramTaskParseResult,
} from './telegram-task-parser.service';
import { TelegramTaskParserService } from './telegram-task-parser.service';
import type {
  TelegramBotChannelConfig,
  TelegramMessage,
} from './telegram.types';

/**
 * Wave 3 / Tracker Phase 4 РФ (2026-05-24) — TelegramBotMessageHandler.
 *
 * «Бот для задач» поверх существующего TelegramBotChannelAdapter. Handler
 * вызывается из адаптера ПЕРЕД стандартным `free_note|chat_query` flow:
 * если сообщение распознано как task-related (создание/forward/reply на
 * наше уведомление) — handler сам его обработает и вернёт `true`. Иначе
 * адаптер продолжит обычный pipeline (intent classify → InboundMessage).
 *
 * 4 сценария (по входящему message):
 *   1. **text**       → `parseCreateTask` → IntakeIssue (опц. auto-triage).
 *   2. **voice**      → ASR → text → parseCreateTask.
 *   3. **forward**    → `parseForwardToTask` → IntakeIssue.
 *   4. **reply** на наше уведомление с meta.relatedIssueId → `classifyReply` →
 *      status_command (transitionState) / comment (CommentsService) /
 *      new_task (parseCreateTask).
 *
 * Зависимости:
 *   - TelegramTaskParserService — обязательно.
 *   - PrismaService, TelegramApiClient, BusinessMetricsService — обязательно.
 *   - VoxService — обязательно (через @Global AiModule, как и у адаптера).
 *   - IssuesService / CommentsService / IntakeAutoTriageQueueService —
 *     **@Optional()**: если ConversationalModule не импортирует TrackerModule
 *     (или в тестах) — handler работает в degraded режиме (intake создан,
 *     transitions и comments skipped с warn-логом).
 *
 * Reply matching: handler знает, что bot-уведомление о задаче должно нести в
 * `payload.issueId` (или `payload.relatedIssueId`) id Issue. Это работает,
 * когда наши коды отправки уведомлений включают relatedIssueId в payload
 * notification'а (см. EVENT_TYPE_CHANNEL_POLICY и payload validators в
 * conversational.service). На текущем этапе не все уведомления это делают —
 * см. README sub-ТЗ §«Telegram-бот» 1.
 */
@Injectable()
export class TelegramBotMessageHandler {
  private readonly logger = new Logger(TelegramBotMessageHandler.name);

  /** Дефолт TZ для cron времени (если у пользователя не задан). */
  static readonly REPLY_RELATED_ISSUE_KEYS = [
    'relatedIssueId',
    'issueId',
  ] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TelegramApiClient) private readonly api: TelegramApiClient,
    @Inject(VoxService) private readonly vox: VoxService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TelegramTaskParserService)
    private readonly parser: TelegramTaskParserService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    // Tracker-зависимости — @Optional. Если ConversationalModule не импортирует
    // TrackerModule — fallback на «только intake создан, transition/comment
    // пропущены». Полная интеграция требует расширения tracker.module.ts
    // (exports IntakeService/CommentsService) + добавления TrackerModule в
    // imports ConversationalModule. См. отчёт sub-ТЗ.
    @Optional()
    @Inject(IssuesService)
    private readonly issuesService?: IssuesService,
    @Optional()
    @Inject(CommentsService)
    private readonly commentsService?: CommentsService,
    @Optional()
    @Inject(IntakeAutoTriageQueueService)
    private readonly autoTriageQueue?: IntakeAutoTriageQueueService,
  ) {}

  /**
   * Главная точка входа. Возвращает `true` если сообщение было обработано
   * task-flow'ом и адаптер должен выйти; `false` — пусть адаптер
   * продолжает обычный pipeline (intent classify → free_note|chat_query).
   *
   * Best-effort: ошибки внутри handler'а не пробрасываем — иначе webhook
   * вернёт 5xx и Telegram засрёт retry'ями.
   */
  async tryHandle(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
  }): Promise<boolean> {
    try {
      // 4. Reply на наше уведомление — приоритет, если match есть.
      if (args.msg.reply_to_message) {
        const handled = await this.handleReply(args);
        if (handled) return true;
        // Если не нашли related issue в нашем notification — fall-through
        // на старый pipeline (адаптер сам попробует tryMatchReplyToProbe).
      }

      // 3. Forward → IntakeIssue (telegram_forward).
      if (this.isForwarded(args.msg)) {
        await this.handleForward(args);
        return true;
      }

      // 2. Voice → ASR → text → как create_task.
      const voice = args.msg.voice ?? args.msg.audio;
      if (voice && this.cfg.bot.voiceEnabled) {
        const transcript = await this.transcribeVoice({
          fileId: voice.file_id,
          token: args.config.botToken,
        });
        if (!transcript) {
          await this.replyBestEffort({
            config: args.config,
            chatId: args.msg.chat.id,
            text: 'Не удалось распознать голос. Попробуйте текстом.',
          });
          return true;
        }
        this.metrics.incTelegramVoiceTranscribed({
          tenantTop: tenantTopOf(args.tenantId),
          kind: 'create_task',
        });
        await this.handleCreateTaskFromText({
          ...args,
          text: transcript,
          externalId: `${args.msg.chat.id}:${args.msg.message_id}`,
        });
        return true;
      }

      // 1. Plain text → create_task.
      const text = (args.msg.text ?? args.msg.caption ?? '').trim();
      if (text.length > 0) {
        await this.handleCreateTaskFromText({
          ...args,
          text,
          externalId: `${args.msg.chat.id}:${args.msg.message_id}`,
        });
        return true;
      }

      return false;
    } catch (err) {
      this.logger.error(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-bot-message-handler: fatal — best-effort skip',
      );
      this.metrics.incTelegramTasksCreated({
        tenantTop: tenantTopOf(args.tenantId),
        status: 'failed',
      });
      return false;
    }
  }

  // ─────────────────────── 1+2. create from text/voice ────────────────────

  private async handleCreateTaskFromText(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
    text: string;
    externalId: string;
  }): Promise<void> {
    const parsed = await this.parser.parseCreateTask({
      tenantId: args.tenantId,
      userId: args.binding.userId,
      rawText: args.text,
      externalId: args.externalId,
    });
    await this.postProcessParsed({
      ...args,
      parsed,
      origin: 'create',
    });
  }

  // ─────────────────────── 3. forward → IntakeIssue ───────────────────────

  private async handleForward(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    // Telegram форвард-payload: либо текст, либо caption + другой контент.
    const rawText = (args.msg.text ?? args.msg.caption ?? '').trim();
    if (!rawText) {
      await this.replyBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text: 'Форвард пустой — нечего превратить в задачу. Перешлите сообщение с текстом.',
      });
      return;
    }
    const externalId = `${args.msg.chat.id}:${args.msg.message_id}`;
    const parsed = await this.parser.parseForwardToTask({
      tenantId: args.tenantId,
      userId: args.binding.userId,
      forwardedText: rawText,
      externalId,
    });
    await this.postProcessParsed({
      msg: args.msg,
      binding: args.binding,
      tenantId: args.tenantId,
      config: args.config,
      parsed,
      origin: 'forward',
    });
  }

  // ─────────────────────── 4. reply on bot notification ──────────────────

  /**
   * Reply на наше уведомление о задаче. Match'им по
   * `NotificationDelivery.externalMessageId = chatId:message_id` reply'я.
   * Достаём `relatedIssueId` из payload notification'а.
   *
   * @returns true — обработано (status/comment/new_task); false — match не
   *          нашёлся (адаптер пусть пробует probe-match или free_note).
   */
  private async handleReply(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
  }): Promise<boolean> {
    const reply = args.msg.reply_to_message;
    if (!reply) return false;
    const externalId = `${reply.chat.id}:${reply.message_id}`;
    const text = (args.msg.text ?? args.msg.caption ?? '').trim();
    if (!text) return false;

    // 1. Достаём delivery → notification → payload.relatedIssueId.
    const delivery = await this.prisma.notificationDelivery.findFirst({
      where: {
        channelBindingId: args.binding.id,
        externalMessageId: externalId,
      },
      include: { notification: true },
    });
    if (!delivery) return false;
    const payload =
      (delivery.notification.payload as Record<string, unknown> | null) ??
      null;
    const relatedIssueId = this.extractRelatedIssueId(payload);
    if (!relatedIssueId) return false;

    // 2. Подгружаем Issue, чтобы убедиться в tenant scope + достать stateId.
    const issue = await this.prisma.issue.findFirst({
      where: {
        id: relatedIssueId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
    });
    if (!issue) return false;

    // 3. LLM-классификация.
    const classified = await this.parser.classifyReply({
      tenantId: args.tenantId,
      userId: args.binding.userId,
      replyText: text,
      relatedIssueId: issue.id,
    });
    this.metrics.incTelegramReplyClassified({
      tenantTop: tenantTopOf(args.tenantId),
      kind: classified.kind,
    });

    switch (classified.kind) {
      case 'status_command':
        await this.applyStatusCommand({
          tenantId: args.tenantId,
          userId: args.binding.userId,
          issue,
          action: classified.action,
          config: args.config,
          chatId: args.msg.chat.id,
        });
        return true;

      case 'comment':
        await this.createCommentBestEffort({
          tenantId: args.tenantId,
          userId: args.binding.userId,
          issueId: issue.id,
          text: classified.text,
          config: args.config,
          chatId: args.msg.chat.id,
        });
        return true;

      case 'new_task': {
        const externalIdNew = `${args.msg.chat.id}:${args.msg.message_id}`;
        const parsed = await this.parser.parseCreateTask({
          tenantId: args.tenantId,
          userId: args.binding.userId,
          rawText: classified.text,
          externalId: externalIdNew,
        });
        await this.postProcessParsed({
          msg: args.msg,
          binding: args.binding,
          tenantId: args.tenantId,
          config: args.config,
          parsed,
          origin: 'create',
        });
        return true;
      }

      case 'unknown':
      default:
        return false;
    }
  }

  // ─────────────────────── helpers: status/comment ───────────────────────

  private async applyStatusCommand(args: {
    tenantId: string;
    userId: string;
    issue: Issue;
    action: 'accept' | 'postpone_one_day' | 'cancel';
    config: TelegramBotChannelConfig;
    chatId: number;
  }): Promise<void> {
    if (!this.issuesService) {
      this.logger.warn(
        { issueId: args.issue.id, action: args.action },
        'telegram-bot-message-handler: IssuesService не подключён (TrackerModule не импортирован) — status не применён',
      );
      await this.replyBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Понял команду, но не могу применить статус (внутренняя ошибка). Откройте задачу в интерфейсе.',
      });
      return;
    }

    try {
      if (args.action === 'accept' || args.action === 'cancel') {
        const targetCategory =
          args.action === 'accept' ? 'started' : 'cancelled';
        const targetState = await this.prisma.issueState.findFirst({
          where: {
            projectId: args.issue.projectId,
            category: targetCategory,
          },
          orderBy: { sequence: 'asc' },
        });
        if (!targetState) {
          await this.replyBestEffort({
            config: args.config,
            chatId: args.chatId,
            text:
              args.action === 'accept'
                ? 'Не нашёл статус «В работе» в проекте. Откройте задачу вручную.'
                : 'Не нашёл статус «Отменено» в проекте.',
          });
          return;
        }
        await this.issuesService.transitionState(
          args.issue.id,
          { stateId: targetState.id, reason: 'telegram_reply' },
          args.tenantId,
          args.userId,
        );
        await this.replyBestEffort({
          config: args.config,
          chatId: args.chatId,
          text:
            args.action === 'accept'
              ? '✅ Принял! Статус: В работе.'
              : '🛑 Ок, перевёл в «Отменено».',
        });
        return;
      }
      // postpone_one_day: dueDate + 24h. Если dueDate null — ставим завтра.
      const base = args.issue.dueDate
        ? new Date(args.issue.dueDate.getTime())
        : new Date();
      base.setUTCDate(base.getUTCDate() + 1);
      await this.prisma.issue.update({
        where: { id: args.issue.id },
        data: { dueDate: base },
      });
      const dateLabel = base.toISOString().slice(0, 10);
      await this.replyBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: `🕒 Сдвинул дедлайн на ${dateLabel}.`,
      });
    } catch (err) {
      this.logger.warn(
        {
          issueId: args.issue.id,
          action: args.action,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-bot-message-handler: applyStatusCommand упал',
      );
      await this.replyBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Не удалось применить команду. Попробуйте ещё раз или откройте задачу.',
      });
    }
  }

  private async createCommentBestEffort(args: {
    tenantId: string;
    userId: string;
    issueId: string;
    text: string;
    config: TelegramBotChannelConfig;
    chatId: number;
  }): Promise<void> {
    if (!this.commentsService) {
      this.logger.warn(
        { issueId: args.issueId },
        'telegram-bot-message-handler: CommentsService не подключён — комментарий не сохранён',
      );
      await this.replyBestEffort({
        config: args.config,
        chatId: args.chatId,
        text:
          'Понял, но не могу прямо сейчас сохранить комментарий. Откройте задачу в интерфейсе.',
      });
      return;
    }
    try {
      const trimmed = args.text.slice(0, 50_000);
      await this.commentsService.create(
        args.issueId,
        {
          content: trimmed,
          contentHtml: null,
          contentStripped: trimmed,
          parentCommentId: null,
          access: 'internal',
          voiceUrl: null,
          voiceDuration: null,
          voiceTranscript: null,
        },
        args.tenantId,
        args.userId,
      );
      await this.replyBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: '💬 Записал комментарий.',
      });
    } catch (err) {
      this.logger.warn(
        {
          issueId: args.issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-bot-message-handler: createComment упал',
      );
      await this.replyBestEffort({
        config: args.config,
        chatId: args.chatId,
        text: 'Не удалось сохранить комментарий. Попробуйте ещё раз.',
      });
    }
  }

  // ─────────────────────── helpers: post-process parsed ───────────────────

  /**
   * Общая пост-обработка для create/forward: метрики + enqueue auto-triage
   * + bot-reply пользователю.
   */
  private async postProcessParsed(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
    parsed: TelegramTaskParseResult;
    origin: 'create' | 'forward';
  }): Promise<void> {
    const tenantTop = tenantTopOf(args.tenantId);

    if (!args.parsed.intakeIssueId) {
      // LLM/empty/db-error.
      const text =
        args.parsed.reason === 'empty_text'
          ? 'Пустое сообщение. Пришлите текст с задачей.'
          : args.parsed.reason === 'llm_failed'
            ? 'Не удалось разобрать задачу. Сформулируйте короче или попробуйте ещё раз.'
            : 'Не удалось создать задачу. Попробуйте ещё раз.';
      if (args.origin === 'forward') {
        this.metrics.incTelegramForwards({ tenantTop, status: 'failed' });
      } else {
        this.metrics.incTelegramTasksCreated({ tenantTop, status: 'failed' });
      }
      await this.replyBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text,
      });
      return;
    }

    // Enqueue auto-triage (best-effort).
    let autoTriaged = false;
    if (args.parsed.autoTriageEnqueued && this.autoTriageQueue) {
      try {
        await this.autoTriageQueue.enqueue({
          tenantId: args.tenantId,
          intakeIssueId: args.parsed.intakeIssueId,
        });
        autoTriaged = true;
      } catch (err) {
        this.logger.warn(
          {
            intakeIssueId: args.parsed.intakeIssueId,
            err: err instanceof Error ? err.message : String(err),
          },
          'telegram-bot-message-handler: enqueue auto-triage упал',
        );
      }
    }

    // Метрика.
    if (args.origin === 'forward') {
      this.metrics.incTelegramForwards({
        tenantTop,
        status: autoTriaged ? 'auto_created' : 'created',
      });
    } else {
      this.metrics.incTelegramTasksCreated({
        tenantTop,
        status: autoTriaged ? 'auto_created' : 'created',
      });
    }

    // Bot reply пользователю.
    const title = args.parsed.suggested?.title ?? '(без названия)';
    const trail = autoTriaged
      ? ' Сейчас обработаю и создам задачу.'
      : ' Положил в инбокс — посмотрю и оформлю.';
    await this.replyBestEffort({
      config: args.config,
      chatId: args.msg.chat.id,
      text: `✅ Принял: «${this.shorten(title, 200)}».${trail}`,
    });
  }

  // ─────────────────────── helpers: voice + telegram ─────────────────────

  /**
   * Скачивает voice file через TelegramApi и пропускает через VoxService.
   * Возвращает transcript или null на любую ошибку.
   */
  private async transcribeVoice(args: {
    fileId: string;
    token: string;
  }): Promise<string | null> {
    try {
      const file = await this.api.getFile({
        token: args.token,
        fileId: args.fileId,
      });
      if (!file.file_path) return null;
      const buffer = await this.api.downloadFile({
        token: args.token,
        filePath: file.file_path,
      });
      const submitted = await this.vox.submit(buffer);
      const result = await this.vox.poll(submitted.taskId);
      return (result.transcriptText ?? '').trim() || null;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-bot-message-handler: transcribeVoice упал',
      );
      return null;
    }
  }

  private isForwarded(msg: TelegramMessage): boolean {
    // Telegram Bot API: новые версии используют `forward_origin`, старые —
    // `forward_from`/`forward_from_chat`. types.ts текущий — узкий, мы
    // мерим через record-access.
    const anyMsg = msg as unknown as Record<string, unknown>;
    return Boolean(
      anyMsg['forward_origin'] ||
        anyMsg['forward_from'] ||
        anyMsg['forward_from_chat'] ||
        anyMsg['forward_sender_name'],
    );
  }

  private extractRelatedIssueId(
    payload: Record<string, unknown> | null,
  ): string | null {
    if (!payload) return null;
    for (const key of TelegramBotMessageHandler.REPLY_RELATED_ISSUE_KEYS) {
      const v = payload[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return null;
  }

  private shorten(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }

  /**
   * Best-effort reply (без NotificationDelivery): ошибки логируем, не
   * пробрасываем (иначе webhook вернёт 5xx и Telegram засрёт retry'ями).
   */
  private async replyBestEffort(args: {
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
      if (err instanceof TelegramApiError) {
        this.logger.warn(
          { code: err.code, message: err.message },
          'telegram-bot-message-handler: replyBestEffort API error',
        );
        return;
      }
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-bot-message-handler: replyBestEffort failed',
      );
    }
  }
}
