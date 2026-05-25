import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type ChatV2Conversation,
  type ChatV2ConversationStatus,
  type ChatV2Message,
  type ChatV2MessageRole,
  type ChatV2Mode,
  type ChatV2Scope,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import {
  CHAT_V2_CONVERSATION_TITLE_SYSTEM_PROMPT,
  CHAT_V2_CONVERSATION_TITLE_USER_PROMPT,
} from '../prompts/chat-v2-conversation-title.prompt';

/**
 * SBA α-5 — ChatV2ConversationsService.
 *
 * Хранит conversation history для модуля chat-v2. CRUD по диалогам и
 * сообщениям, генерация title через LLM (taskType `chat-v2-conversation-title`),
 * pin / archive.
 *
 * Ownership-проверка идёт по `userId` — каждый диалог принадлежит автору.
 * Tenant-проверка — по `tenantId` (Org). Контроллер обязан передавать оба
 * (из CookieAuthGuard + TenantGuard).
 *
 * NB: для админ-доступа «увидеть все диалоги Org» используется отдельный
 * метод (TODO в β+; на α-5 не реализован).
 */

export interface CreateConversationInput {
  tenantId: string;
  userId: string;
  scope: ChatV2Scope;
  scopeRefId?: string | null;
  channelKindOrigin?: string | null;
}

export interface AppendMessageInput {
  conversationId: string;
  role: ChatV2MessageRole;
  mode?: ChatV2Mode | null;
  text: string;
  /**
   * Для nullable Json-полей Prisma требует `Prisma.NullableJsonNullValueInput`
   * (это `Prisma.JsonNull` или `Prisma.DbNull`) ИЛИ `InputJsonValue`. Чтобы
   * сервис мог принимать оба варианта, объединяем типы.
   */
  citations?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  retrievalMeta?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  llmMeta?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
}

export interface ListConversationsInput {
  tenantId: string;
  userId: string;
  status?: ChatV2ConversationStatus;
  scope?: ChatV2Scope;
  page?: number;
  limit?: number;
}

export interface ListConversationsResult {
  items: ChatV2Conversation[];
  total: number;
}

@Injectable()
export class ChatV2ConversationsService {
  private readonly logger = new Logger(ChatV2ConversationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   * Defensive try/catch — в старых unit-тестах cfg может быть mock без
   * `aiFeatures`. Default — true (как в env.schema).
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async create(input: CreateConversationInput): Promise<ChatV2Conversation> {
    return this.prisma.chatV2Conversation.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        scope: input.scope,
        scopeRefId: input.scopeRefId ?? null,
        channelKindOrigin: input.channelKindOrigin ?? null,
      },
    });
  }

  /**
   * Добавить сообщение. Триггерит implicit `updatedAt` обновление
   * conversation (через @updatedAt в схеме — мы делаем `update` с пустым
   * data, чтобы updatedAt бамп произошёл атомарно с insert).
   */
  async appendMessage(input: AppendMessageInput): Promise<ChatV2Message> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.chatV2Message.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          mode: input.mode ?? null,
          text: input.text,
          citations: input.citations ?? Prisma.DbNull,
          retrievalMeta: input.retrievalMeta ?? Prisma.DbNull,
          llmMeta: input.llmMeta ?? Prisma.DbNull,
        },
      });
      // bump updatedAt
      await tx.chatV2Conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });
      return message;
    });
  }

  /**
   * Получить диалог по id вместе с сообщениями. Проверяет ownership.
   * Возвращает 404, если диалог не найден или принадлежит другому
   * пользователю / Org.
   */
  async getById(args: {
    tenantId: string;
    userId: string;
    conversationId: string;
  }): Promise<ChatV2Conversation & { messages: ChatV2Message[] }> {
    const conv = await this.prisma.chatV2Conversation.findUnique({
      where: { id: args.conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conv || conv.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'conversation_not_found',
          message: 'Диалог не найден',
        },
      });
    }
    if (conv.userId !== args.userId) {
      // Не отдаём 404 / 403 раздельно, чтобы не разглашать существование
      // чужого диалога. 404 — корректно по UX.
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'conversation_not_found',
          message: 'Диалог не найден',
        },
      });
    }
    return conv;
  }

  async list(input: ListConversationsInput): Promise<ListConversationsResult> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const page = Math.max(input.page ?? 1, 1);
    const where: Prisma.ChatV2ConversationWhereInput = {
      tenantId: input.tenantId,
      userId: input.userId,
    };
    if (input.status) where.status = input.status;
    if (input.scope) where.scope = input.scope;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.chatV2Conversation.findMany({
        where,
        orderBy: [{ pinnedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chatV2Conversation.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Закрепить / открепить диалог. `pinnedAt=Date` — закрепляет (исключает
   * из auto-archive); `pinnedAt=null` — открепляет.
   */
  async setPinned(args: {
    tenantId: string;
    userId: string;
    conversationId: string;
    pinned: boolean;
  }): Promise<ChatV2Conversation> {
    await this.requireOwnership(args);
    return this.prisma.chatV2Conversation.update({
      where: { id: args.conversationId },
      data: { pinnedAt: args.pinned ? new Date() : null },
    });
  }

  /** Архивирует диалог (status='archived'). Не удаляет физически. */
  async archive(args: {
    tenantId: string;
    userId: string;
    conversationId: string;
  }): Promise<ChatV2Conversation> {
    await this.requireOwnership(args);
    return this.prisma.chatV2Conversation.update({
      where: { id: args.conversationId },
      data: { status: 'archived' },
    });
  }

  /**
   * Сгенерировать title диалога через LLM (короткий, 3-7 слов) и сохранить
   * в conversation. Используется после первого user-сообщения.
   *
   * Не блокирует основной поток: если LLM упал — title остаётся NULL и
   * фронт показывает «Новый диалог». Ошибка логируется warn'ом.
   */
  async generateTitle(args: {
    tenantId: string;
    conversationId: string;
    firstUserMessage: string;
  }): Promise<string | null> {
    try {
      // ТЗ 2026-05-24 §4 (F1.2) — обернуть пользовательский firstUserMessage
      // в маркеры данных + INJECTION_GUARD_NOTE в system. Источник = 'chat'.
      const guardOn = this.isPromptInjectionGuardEnabled();
      const trimmedFirstMessage = args.firstUserMessage.slice(0, 1000);
      if (guardOn) {
        // Observability: лёгкая regex-проверка (sanitize) с инкрементом метрики
        // на каждый сработавший pattern. Не отклоняем — структурный слой
        // (маркеры) даёт защиту даже при false-negative regex'а.
        const sanitized = sanitizeCustomPrompt(trimmedFirstMessage);
        for (const pattern of sanitized.reasons) {
          this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
        }
      }
      const systemText = guardOn
        ? withInjectionGuard(CHAT_V2_CONVERSATION_TITLE_SYSTEM_PROMPT)
        : CHAT_V2_CONVERSATION_TITLE_SYSTEM_PROMPT;
      const userText = guardOn
        ? CHAT_V2_CONVERSATION_TITLE_USER_PROMPT(
            wrapUserData(trimmedFirstMessage),
          )
        : CHAT_V2_CONVERSATION_TITLE_USER_PROMPT(trimmedFirstMessage);
      const result = await this.llm.call({
        taskType: 'chat-v2-conversation-title',
        tenantId: args.tenantId,
        systemPrompt: systemText,
        userMessage: userText,
        maxTokens: 40,
        sourceRef: { type: 'chat_v2_conversation', id: args.conversationId },
      });
      const cleaned = (result.text ?? '')
        .trim()
        .replace(/^["'«»]+/, '')
        .replace(/["'«»]+$/, '')
        .replace(/[.!?]+$/, '')
        .slice(0, 120);
      const title = cleaned.length > 0 ? cleaned : null;
      if (title) {
        await this.prisma.chatV2Conversation.update({
          where: { id: args.conversationId },
          data: { title },
        });
      }
      return title;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: args.conversationId, err: message },
        'generateTitle: LLM упал — оставляем title=NULL',
      );
      return null;
    }
  }

  // ─────────────────────────── private ───────────────────────────

  private async requireOwnership(args: {
    tenantId: string;
    userId: string;
    conversationId: string;
  }): Promise<void> {
    const conv = await this.prisma.chatV2Conversation.findUnique({
      where: { id: args.conversationId },
      select: { tenantId: true, userId: true },
    });
    if (!conv || conv.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'conversation_not_found',
          message: 'Диалог не найден',
        },
      });
    }
    if (conv.userId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_owner',
          message: 'Этот диалог принадлежит другому пользователю',
        },
      });
    }
  }
}
