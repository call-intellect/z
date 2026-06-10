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
 * «Бот для задач» поверх TelegramBotChannelAdapter.
 *
 * ТЗ 2026-06-10 §2 (гейт намерения): раньше handler перехватывал ЛЮБОЙ
 * непустой ввод и делал из него задачу, обходя классификатор намерения
 * («план/вопрос» падали в IntakeIssue). Теперь handler выставляет три
 * точки входа, а РЕШЕНИЕ принимает адаптер по классификатору:
 *   - `tryHandleStructural` — структурные спецслучаи ДО классификации:
 *       **forward** → `parseForwardToTask` → IntakeIssue;
 *       **reply** на наше уведомление о задаче (meta.relatedIssueId) →
 *       `classifyReply` → status_command / comment / new_task.
 *   - `handleCreateTask` — создание задачи из текста, зовётся адаптером
 *       ТОЛЬКО при intent=task (для голоса — на ASR-транскрипте).
 *   - `handleShowTasks` — читалка «мои задачи» (intent=show_tasks, Р-6):
 *       список открытых задач исполнителя текстом zero-button.
 * Голос: ASR + классификацию делает адаптер (`handleVoice`); handler
 * голос больше не транскрибирует.
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
/** Сколько задач показываем в Telegram-читалке «мои задачи» (ТЗ §2 Ф5). */
const SHOW_TASKS_LIMIT = 10;

/** Лёгкая форма открытой задачи для рендера читалки «мои задачи». */
export interface MyTaskListItem {
  identifier: string;
  title: string;
  stateName: string | null;
  dueDate: Date | null;
}

/** Экранирование HTML (бот шлёт сообщения с parseMode=HTML). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortenText(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Чистый рендер списка «мои задачи» (ТЗ 2026-06-10 §2 Ф5, для unit-теста).
 * zero-button (без inline-кнопок, по фидбеку владельца). Пусто →
 * «Открытых задач нет»; total>limit → «…и ещё M в кабинете».
 */
export function renderMyTasksText(
  items: MyTaskListItem[],
  total: number,
  limit: number,
): string {
  if (total === 0) {
    return 'Открытых задач нет. 🎉';
  }
  const lines = items.map((t) => {
    const due = t.dueDate
      ? ` — до ${t.dueDate.toISOString().slice(0, 10)}`
      : '';
    return `• ${escapeHtml(shortenText(t.title, 120))}${due}`;
  });
  let out = `Ваши задачи (${total}):\n${lines.join('\n')}`;
  if (total > limit) {
    out += `\n…и ещё ${total - limit} в кабинете.`;
  }
  return out;
}

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
   * Структурные спецслучаи task-flow, проверяемые адаптером ДО классификации
   * намерения (ТЗ 2026-06-10 §2 Ф3): reply на наше уведомление о задаче +
   * forward («преврати это в задачу»). Возвращает `true` если обработано
   * (адаптер выходит); `false` — пусть адаптер классифицирует намерение.
   *
   * ВАЖНО (фикс §2): plain text / voice здесь БОЛЬШЕ не перехватываются
   * безусловно как задача. Раньше любой непустой ввод → IntakeIssue, минуя
   * классификатор намерения; теперь task создаётся ТОЛЬКО при intent=task
   * (адаптер → `handleCreateTask`), вопросы → chat_query, план/отчёт →
   * чек-ин, «какие задачи?» → `handleShowTasks`.
   *
   * Best-effort: ошибки не пробрасываем — иначе webhook вернёт 5xx и
   * Telegram засрёт retry'ями.
   */
  async tryHandleStructural(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
  }): Promise<boolean> {
    try {
      // Reply на наше уведомление о задаче — спецслучай (раньше классификации).
      if (args.msg.reply_to_message) {
        const handled = await this.handleReply(args);
        if (handled) return true;
        // Нет match'а — fall-through (адаптер попробует tryMatchReplyToProbe).
      }

      // Forward → IntakeIssue (явное «преврати это в задачу», telegram_forward).
      if (this.isForwarded(args.msg)) {
        await this.handleForward(args);
        return true;
      }

      // Plain text / voice НЕ перехватываем — их классифицирует адаптер.
      return false;
    } catch (err) {
      this.logger.error(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-bot-message-handler: tryHandleStructural fatal — best-effort skip',
      );
      return false;
    }
  }

  // ─────────────────────── 1+2. create from text/voice ────────────────────

  /**
   * ТЗ 2026-06-10 §2 Ф3 — создание задачи из текста. Зовётся адаптером, когда
   * классификатор вернул intent=task (для голоса — на ASR-транскрипте). Раньше
   * эта логика срабатывала безусловно на ЛЮБОЙ непустой ввод (баг §2 — гейт
   * намерения обходился); теперь — только по явному намерению. Best-effort:
   * ошибки не пробрасываем (webhook не должен вернуть 5xx).
   */
  async handleCreateTask(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
    text: string;
    externalId: string;
  }): Promise<void> {
    try {
      await this.handleCreateTaskFromText(args);
    } catch (err) {
      this.logger.error(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-bot-message-handler: handleCreateTask fatal — best-effort skip',
      );
      this.metrics.incTelegramTasksCreated({
        tenantTop: tenantTopOf(args.tenantId),
        status: 'failed',
      });
    }
  }

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

  // ─────────────────────── 5. show my tasks (Р-6) ────────────────────────

  /**
   * ТЗ 2026-06-10 §2 Ф5 (Р-6) — читалка «мои задачи». Зовётся адаптером при
   * intent=show_tasks. Список ОТКРЫТЫХ задач исполнителя (по `binding.userId`)
   * из трекера, рендер текстом zero-button (без inline-кнопок, фидбек
   * владельца). Если трекер не подключён (degraded) — мягкий ответ.
   * Best-effort: ошибки не пробрасываем.
   */
  async handleShowTasks(args: {
    msg: TelegramMessage;
    binding: ChannelBinding;
    tenantId: string;
    config: TelegramBotChannelConfig;
  }): Promise<void> {
    if (!this.issuesService) {
      await this.replyBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text: 'Не получается показать задачи прямо сейчас. Откройте раздел «Задачи» в кабинете.',
      });
      return;
    }
    try {
      const { items, total } = await this.issuesService.listOpenForAssignee({
        tenantId: args.tenantId,
        userId: args.binding.userId,
        limit: SHOW_TASKS_LIMIT,
      });
      await this.replyBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text: renderMyTasksText(items, total, SHOW_TASKS_LIMIT),
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-bot-message-handler: handleShowTasks упал',
      );
      await this.replyBestEffort({
        config: args.config,
        chatId: args.msg.chat.id,
        text: 'Не удалось получить список задач. Попробуйте ещё раз.',
      });
    }
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

  // ─────────────────────── helpers: telegram ─────────────────────────────

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
