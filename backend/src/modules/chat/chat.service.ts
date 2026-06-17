import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { MeetingChatMessage } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { CardsService } from '../cards/cards.service';
import { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';
import { buildVectorLiteral } from '../embeddings/services/vector-literal.util';
import { EntitlementService } from '../entitlements/entitlement.service';
import {
  ChatV2Service,
  type ChatV2Citation,
  type ChatV2Scope,
} from '../knowledge-core/services/chat-v2.service';
import { MeetingActionItemsService } from '../meetings/meeting-action-items.service';
import { QuotaService } from '../quotas/quota.service';
import { RbacService } from '../rbac/rbac.service';

import { ChatRepository } from './chat.repository';
import {
  buildCrossMeetingContext,
  type CrossMeetingChunk,
} from './context-builder/cross-meeting-context';
import { buildSingleMeetingContext } from './context-builder/single-meeting-context';

interface AnswerCitation {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
}

export interface ChatAnswer {
  message: string;
  citations: AnswerCitation[];
  modelUsed: string;
}

const TIMESTAMP_REGEX = /\[(\d{1,2}):(\d{2})\]/gu;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(EmbeddingFallbackService) private readonly embeddings: EmbeddingFallbackService,
    @Inject(QuotaService) private readonly quota: QuotaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CardsService) private readonly cards: CardsService,
    @Inject(ChatV2Service) private readonly chatV2: ChatV2Service,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(MeetingActionItemsService)
    private readonly actionItems: MeetingActionItemsService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async askSingleMeeting(input: {
    meetingId: string;
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: {
        id: true,
        title: true,
        type: true,
        ownerId: true,
        tenantId: true,
        startedAt: true,
        deletedAt: true,
      },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== input.userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }

    await this.checkChatQuota(input.userId, meeting.tenantId);

    const [aiResult, chapters, tasks, chunks, history, fullMeeting] = await Promise.all([
      this.prisma.aiResult.findUnique({ where: { meetingId: meeting.id } }),
      this.prisma.meetingChapter.findMany({
        where: { meetingId: meeting.id },
        orderBy: { startMs: 'asc' },
      }),
      // ТЗ Ф5.2 — задачи встречи через единый helper. По дефолту (флаг OFF)
      // читает Task по meetingId (форма для контекста чата — только title).
      this.actionItems.listForMeeting({
        meetingId: meeting.id,
        tenantId: meeting.tenantId ?? '',
      }),
      this.prisma.meetingTranscriptChunk.findMany({
        where: { meetingId: meeting.id },
        orderBy: { startMs: 'asc' },
      }),
      this.repo.listMeetingHistory({
        userId: input.userId,
        meetingId: meeting.id,
        limit: 20,
      }),
      this.prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } }),
    ]);

    // Сохраняем user message ДО llm-вызова — на случай падения видим что юзер спросил.
    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: meeting.id,
      role: 'user',
      content: input.message,
    });

    const ctx = buildSingleMeetingContext({
      meeting: fullMeeting,
      aiResult,
      chapters,
      tasks,
      chunks,
      history,
      question: input.message,
    });

    // Анти-инъекция: userMessage = транскрипт встречи (ASR-фрагменты) + история
    // диалога + вопрос пользователя — всё сырой пользовательский вход. Оборачиваем
    // в маркеры данных + ASR-нота (поверх распознанной речи). Kill-switch —
    // глобальный aiFeatures.promptInjectionGuardEnabled (дефолт ON).
    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(ctx.systemPrompt, ctx.userMessage, {
      enabled: guardOn,
      injection: true,
      asr: true,
    });

    const result = await this.llm.call({
      taskType: 'chat',
      systemPrompt: guarded.system,
      userMessage: guarded.user,
      tenantId: meeting.tenantId,
      meetingId: meeting.id,
      userId: input.userId,
      sourceRef: { type: 'meeting', id: meeting.id },
    });

    const citations = parseCitations(result.text, ctx.contextChunks);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: meeting.id,
      role: 'assistant',
      content: result.text,
      citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'single' });

    return { message: result.text, citations, modelUsed: result.modelUsed };
  }

  async askCrossMeeting(input: {
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);
    const tenantIdForQuota = await this.llm.resolveTenantByUser(input.userId);
    await this.checkChatQuota(input.userId, tenantIdForQuota);

    // Embedding запроса.
    const [embedding] = await this.embeddings.embed([input.message]);
    if (!embedding) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'embedding_failed', message: 'Не удалось построить embedding запроса' },
      });
    }

    const chunks = await this.searchSimilarChunks(input.userId, embedding, 10);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      role: 'user',
      content: input.message,
    });

    const ctx = buildCrossMeetingContext({ chunks, question: input.message });
    const tenantId = await this.llm.resolveTenantByUser(input.userId);

    // Анти-инъекция: userMessage = найденные фрагменты транскриптов встреч
    // (ASR) + вопрос пользователя — сырой пользовательский вход. Маркеры
    // данных + ASR-нота. Kill-switch — глобальный aiFeatures.promptInjectionGuardEnabled.
    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(ctx.systemPrompt, ctx.userMessage, {
      enabled: guardOn,
      injection: true,
      asr: true,
    });

    const result = await this.llm.call({
      taskType: 'chat',
      systemPrompt: guarded.system,
      userMessage: guarded.user,
      tenantId,
      userId: input.userId,
    });

    const citations = parseCitations(result.text, ctx.contextChunks);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      role: 'assistant',
      content: result.text,
      citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'cross' });

    return { message: result.text, citations, modelUsed: result.modelUsed };
  }

  async getMeetingHistory(
    userId: string,
    meetingId: string,
  ): Promise<MeetingChatMessage[]> {
    return this.repo.listMeetingHistory({ userId, meetingId });
  }

  async getCrossHistory(userId: string): Promise<MeetingChatMessage[]> {
    return this.repo.listCrossHistory({ userId });
  }

  async getCardHistory(
    userId: string,
    cardId: string,
  ): Promise<MeetingChatMessage[]> {
    // Owner-проверка карточки.
    await this.cards.getById(cardId, userId);
    return this.repo.listCardHistory({ userId, cardId });
  }

  /**
   * AI-чат по карточке: RAG поверх transcript-chunks встреч карточки.
   * Логика идентична `askCrossMeeting`, но с фильтром по `Meeting.cardId`.
   */
  async askCard(input: {
    cardId: string;
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);
    // Owner-проверка карточки + 404 если её нет.
    const card = await this.cards.getById(input.cardId, input.userId);

    await this.checkChatQuota(input.userId, card.tenantId ?? null);

    const [embedding] = await this.embeddings.embed([input.message]);
    if (!embedding) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'embedding_failed', message: 'Не удалось построить embedding запроса' },
      });
    }

    const chunks = await this.searchSimilarChunksByCard(
      input.userId,
      input.cardId,
      embedding,
      16,
    );

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      cardId: input.cardId,
      role: 'user',
      content: input.message,
    });

    const ctx = buildCrossMeetingContext({ chunks, question: input.message });
    const tenantId = await this.llm.resolveTenantByUser(input.userId);

    // Анти-инъекция: userMessage = фрагменты транскриптов встреч карточки (ASR)
    // + вопрос пользователя — сырой пользовательский вход. Маркеры данных +
    // ASR-нота. Kill-switch — глобальный aiFeatures.promptInjectionGuardEnabled.
    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(ctx.systemPrompt, ctx.userMessage, {
      enabled: guardOn,
      injection: true,
      asr: true,
    });

    const result = await this.llm.call({
      taskType: 'card-chat',
      systemPrompt: guarded.system,
      userMessage: guarded.user,
      tenantId,
      userId: input.userId,
      sourceRef: { type: 'card', id: input.cardId },
    });

    const citations = parseCitations(result.text, ctx.contextChunks);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      cardId: input.cardId,
      role: 'assistant',
      content: result.text,
      citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'card' });

    return { message: result.text, citations, modelUsed: result.modelUsed };
  }

  // ─────────────────────────── ChatV2 (Фаза 6 knowledge-core) ───────────

  /**
   * Single-meeting через ChatV2Service. Owner-проверка + quota + persist
   * остаётся в chat.service (контракт API не меняется); сама retrieval-логика
   * и LLM-вызов делегируются в knowledge-core.
   */
  async askSingleMeetingV2(input: {
    meetingId: string;
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: {
        id: true,
        ownerId: true,
        tenantId: true,
        deletedAt: true,
      },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== input.userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }
    if (!meeting.tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'У встречи нет привязки к Org — chat v2 недоступен',
        },
      });
    }

    await this.checkChatQuota(input.userId, meeting.tenantId);

    const history = await this.repo.listMeetingHistory({
      userId: input.userId,
      meetingId: meeting.id,
      limit: 12,
    });

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: meeting.id,
      role: 'user',
      content: input.message,
    });

    const result = await this.chatV2.ask({
      tenantId: meeting.tenantId,
      userId: input.userId,
      scope: 'meeting',
      scopeId: meeting.id,
      query: input.message,
      history: this.toV2History(history),
    });

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: meeting.id,
      role: 'assistant',
      content: result.message,
      citations: result.citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'single' });

    return {
      message: result.message,
      citations: result.citations,
      modelUsed: result.modelUsed,
    };
  }

  /**
   * Cross-meeting (org-scope) через ChatV2Service.
   */
  async askCrossMeetingV2(input: {
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);

    const tenantId = await this.llm.resolveTenantByUser(input.userId);
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Org не определена для пользователя',
        },
      });
    }

    await this.checkChatQuota(input.userId, tenantId);

    const history = await this.repo.listCrossHistory({
      userId: input.userId,
      limit: 12,
    });

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      role: 'user',
      content: input.message,
    });

    const result = await this.chatV2.ask({
      tenantId,
      userId: input.userId,
      scope: 'org',
      scopeId: null,
      query: input.message,
      history: this.toV2History(history),
    });

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      role: 'assistant',
      content: result.message,
      citations: result.citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'cross' });

    return {
      message: result.message,
      citations: result.citations,
      modelUsed: result.modelUsed,
    };
  }

  /**
   * Card-scope через ChatV2Service.
   */
  async askCardV2(input: {
    cardId: string;
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);
    const card = await this.cards.getById(input.cardId, input.userId);
    if (!card.tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'У карточки нет привязки к Org — chat v2 недоступен',
        },
      });
    }

    await this.checkChatQuota(input.userId, card.tenantId);

    const history = await this.repo.listCardHistory({
      userId: input.userId,
      cardId: card.id,
      limit: 12,
    });

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      cardId: card.id,
      role: 'user',
      content: input.message,
    });

    const result = await this.chatV2.ask({
      tenantId: card.tenantId,
      userId: input.userId,
      scope: 'card',
      scopeId: card.id,
      query: input.message,
      history: this.toV2History(history),
    });

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      cardId: card.id,
      role: 'assistant',
      content: result.message,
      citations: result.citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'card' });

    return {
      message: result.message,
      citations: result.citations,
      modelUsed: result.modelUsed,
    };
  }

  /**
   * Unified chat для нового эндпоинта `POST /api/v1/chat/v2`.
   * Делает auth/RBAC под scope, quota, ChatV2Service.ask, persist в общий
   * `MeetingChatMessage`. Возвращает полный ChatV2-результат (с usedBlockIds).
   */
  async askUnifiedV2(input: {
    userId: string;
    scope: ChatV2Scope;
    scopeId: string | null;
    message: string;
  }): Promise<{
    message: string;
    citations: ChatV2Citation[];
    modelUsed: string;
    usedBlockIds: string[];
  }> {
    this.assertMessageLength(input.message);

    // 1) RBAC + достаём tenantId под scope.
    const { tenantId, persistMeetingId, persistCardId } =
      await this.resolveScopeAuth({
        userId: input.userId,
        scope: input.scope,
        scopeId: input.scopeId,
      });

    // 1.5) Phase 12: gating org-scope чата по `feature.chat_org`.
    // На basic-Org разрешён только meeting/card/theme/entity scope; org — Pro+.
    if (input.scope === 'org') {
      const allowed = await this.entitlements.hasFeature(
        tenantId,
        'feature.chat_org',
      );
      if (!allowed) {
        const ent = await this.entitlements.getEntitlement(tenantId);
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'entitlement_required',
            message: `Чат по всей Org доступен на Pro+. Текущий тариф: ${ent.tier}.`,
            feature: 'feature.chat_org',
            currentTier: ent.tier,
            upgradeUrl: '/settings/billing',
          },
        });
      }
    }

    // 2) Quota.
    await this.checkChatQuota(input.userId, tenantId);

    // 3) История диалога — берём по самому узкому контексту:
    //    meeting → meeting history; card → card history; иначе cross-history.
    let history: MeetingChatMessage[];
    if (persistMeetingId) {
      history = await this.repo.listMeetingHistory({
        userId: input.userId,
        meetingId: persistMeetingId,
        limit: 12,
      });
    } else if (persistCardId) {
      history = await this.repo.listCardHistory({
        userId: input.userId,
        cardId: persistCardId,
        limit: 12,
      });
    } else {
      history = await this.repo.listCrossHistory({
        userId: input.userId,
        limit: 12,
      });
    }

    // 4) Persist user-сообщения ДО llm-вызова.
    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: persistMeetingId,
      cardId: persistCardId,
      role: 'user',
      content: input.message,
    });

    // 5) ChatV2 ask.
    const result = await this.chatV2.ask({
      tenantId,
      userId: input.userId,
      scope: input.scope,
      scopeId: input.scopeId,
      query: input.message,
      history: this.toV2History(history),
    });

    // 6) Persist assistant-ответа.
    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: persistMeetingId,
      cardId: persistCardId,
      role: 'assistant',
      content: result.message,
      citations: result.citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    // Метрика — маппим v2-scope в существующий enum (single/cross/card).
    const metricScope: 'single' | 'cross' | 'card' =
      input.scope === 'meeting'
        ? 'single'
        : input.scope === 'card'
        ? 'card'
        : 'cross';
    this.metrics?.incChatRequest({ scope: metricScope });

    return {
      message: result.message,
      citations: result.citations,
      modelUsed: result.modelUsed,
      usedBlockIds: result.usedBlockIds,
    };
  }

  /**
   * RBAC-проверка scope + резолв tenantId. Также возвращает, в какие поля
   * `MeetingChatMessage` писать — для meeting/card в attached поля,
   * для остальных — в cross-history (meetingId=null, cardId=null).
   */
  private async resolveScopeAuth(args: {
    userId: string;
    scope: ChatV2Scope;
    scopeId: string | null;
  }): Promise<{
    tenantId: string;
    persistMeetingId: string | null;
    persistCardId: string | null;
  }> {
    const { userId, scope, scopeId } = args;

    if (scope === 'meeting') {
      if (!scopeId) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'scope_id_required', message: 'scopeId обязателен для scope=meeting' },
        });
      }
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: scopeId },
        select: { id: true, ownerId: true, tenantId: true, deletedAt: true },
      });
      if (
        !meeting ||
        meeting.deletedAt !== null ||
        meeting.ownerId !== userId ||
        !meeting.tenantId
      ) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
        });
      }
      return {
        tenantId: meeting.tenantId,
        persistMeetingId: meeting.id,
        persistCardId: null,
      };
    }

    if (scope === 'card') {
      if (!scopeId) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'scope_id_required', message: 'scopeId обязателен для scope=card' },
        });
      }
      const card = await this.cards.getById(scopeId, userId);
      if (!card.tenantId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'tenant_required',
            message: 'У карточки нет привязки к Org — chat v2 недоступен',
          },
        });
      }
      return {
        tenantId: card.tenantId,
        persistMeetingId: null,
        persistCardId: card.id,
      };
    }

    // org / theme / entity → tenant определяем из user membership +
    // RBAC проверка resource (block/theme/entity).
    const tenantId = await this.llm.resolveTenantByUser(userId);
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'tenant_required',
          message: 'Org не определена для пользователя',
        },
      });
    }

    if (scope === 'theme') {
      if (!scopeId) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'scope_id_required', message: 'scopeId обязателен для scope=theme' },
        });
      }
      const theme = await this.prisma.theme.findUnique({
        where: { id: scopeId },
        select: { id: true, tenantId: true },
      });
      if (!theme || theme.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'theme_not_found', message: 'Тема не найдена' },
        });
      }
      const allowed = await this.rbac.canRead(userId, tenantId, 'theme');
      if (!allowed) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'forbidden', message: 'Недостаточно прав' },
        });
      }
    } else if (scope === 'entity') {
      if (!scopeId) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'scope_id_required', message: 'scopeId обязателен для scope=entity' },
        });
      }
      const entity = await this.prisma.entity.findUnique({
        where: { id: scopeId },
        select: { id: true, tenantId: true },
      });
      if (!entity || entity.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'entity_not_found', message: 'Сущность не найдена' },
        });
      }
      const allowed = await this.rbac.canRead(userId, tenantId, 'entity');
      if (!allowed) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'forbidden', message: 'Недостаточно прав' },
        });
      }
    } else {
      // scope === 'org'
      const allowed = await this.rbac.canRead(userId, tenantId, 'block');
      if (!allowed) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'forbidden', message: 'Недостаточно прав' },
        });
      }
    }

    return { tenantId, persistMeetingId: null, persistCardId: null };
  }

  /**
   * Преобразует историю из `MeetingChatMessage` в формат, который ждёт
   * ChatV2Service (только role=user|assistant, content). Передаём только
   * последние 6 — больше не помещается в prompt.
   */
  private toV2History(
    rows: ReadonlyArray<MeetingChatMessage>,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return rows
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .slice(-6)
      .map((r) => ({
        role: r.role as 'user' | 'assistant',
        content: r.content,
      }));
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  /**
   * Phase 12: per-user chat-квота. `max` берётся через `EntitlementService`
   * (поле `chat_requests_per_day_per_user` в TierConfig). Если tenantId
   * отсутствует — fallback на ENV `cfg.workspace.maxChatRequestsPerDay`.
   *
   * `quotaName` намеренно изменён на `chat_requests_per_day_per_user` —
   * новое имя ключа Redis, чтобы счётчики не схлопнулись с legacy.
   */
  private async checkChatQuota(
    userId: string,
    tenantId: string | null | undefined,
  ): Promise<void> {
    let max = this.cfg.workspace.maxChatRequestsPerDay;
    if (tenantId) {
      try {
        max = await this.entitlements.getQuota(
          tenantId,
          'chat_requests_per_day_per_user',
        );
      } catch (err) {
        this.logger.warn(
          `checkChatQuota: getQuota fail для ${tenantId}: ${
            err instanceof Error ? err.message : String(err)
          }, fallback на ENV`,
        );
      }
    }
    await this.quota.checkAndIncrement({
      userId,
      quotaName: 'chat_requests_per_day_per_user',
      max,
      windowMs: 24 * 3600 * 1000,
    });
  }

  private assertMessageLength(message: string): void {
    const max = this.cfg.workspace.maxChatMessageChars;
    if (message.length > max) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'message_too_long',
          message: `Длина сообщения превышает ${max} символов`,
        },
      });
    }
  }

  /**
   * pgvector cosine similarity search. `embedding <=> $vec::vector` — это
   * cosine distance (0 = идентично).
   *
   * Используем Prisma raw query, так как `Unsupported("vector(1536)")` не имеет
   * native API.
   */
  private async searchSimilarChunks(
    userId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<CrossMeetingChunk[]> {
    // Класс G2 — guard pgvector-литерала query-вектора. При reject (смена модели
    // → другая размерность; битый вектор → NaN/Infinity) деградируем на []
    // (LLM ответит без cross-meeting контекста), не валя оператор `<=>` 500-кой.
    const expectedDim = this.cfg.ai?.embeddings?.dimensions ?? 1536;
    const guard = buildVectorLiteral(queryEmbedding, expectedDim);
    if (guard.literal === null) {
      this.logger.warn(
        { userId, reason: guard.rejectReason, actualDim: queryEmbedding.length, expectedDim },
        'chat.searchSimilarChunks: query-вектор отвергнут guard-ом — без cross-meeting recall',
      );
      return [];
    }
    const vec = guard.literal;
    // ВАЖНО: не интерполировать `vec` напрямую (chunks)/limit (chunks/userId должны быть параметрами).
    // Используем $queryRaw с тегированной template literal. PostgreSQL не позволяет
    // bind для cast `::vector`, поэтому вектор через `$2::vector`.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        meeting_id: string;
        start_ms: number;
        end_ms: number;
        text: string;
        similarity: number;
        title: string;
        type: string;
        started_at: Date | null;
      }>
    >(
      `SELECT
         tc."meetingId" as meeting_id,
         tc."startMs" as start_ms,
         tc."endMs" as end_ms,
         tc.text,
         1 - (tc.embedding <=> $2::vector) as similarity,
         m.title,
         m.type::text,
         m."startedAt" as started_at
       FROM "MeetingTranscriptChunk" tc
       JOIN "Meeting" m ON m.id = tc."meetingId"
       WHERE tc."userId" = $1
         AND m."deletedAt" IS NULL
         AND tc.embedding IS NOT NULL
       ORDER BY tc.embedding <=> $2::vector
       LIMIT $3`,
      userId,
      vec,
      limit,
    );
    return rows.map((r) => ({
      meetingId: r.meeting_id,
      meetingTitle: r.title,
      meetingType: r.type,
      meetingDate: r.started_at,
      startMs: r.start_ms,
      endMs: r.end_ms,
      text: r.text,
      similarity: Number(r.similarity ?? 0),
    }));
  }

  /**
   * Аналогично `searchSimilarChunks`, но дополнительно фильтрует встречи
   * по `Meeting.cardId = $cardId`. Используется для AI-чата по карточке.
   */
  private async searchSimilarChunksByCard(
    userId: string,
    cardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<CrossMeetingChunk[]> {
    // Класс G2 — guard pgvector-литерала query-вектора (см. searchSimilarChunks).
    const expectedDim = this.cfg.ai?.embeddings?.dimensions ?? 1536;
    const guard = buildVectorLiteral(queryEmbedding, expectedDim);
    if (guard.literal === null) {
      this.logger.warn(
        { userId, cardId, reason: guard.rejectReason, actualDim: queryEmbedding.length, expectedDim },
        'chat.searchSimilarChunksByCard: query-вектор отвергнут guard-ом — без recall',
      );
      return [];
    }
    const vec = guard.literal;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        meeting_id: string;
        start_ms: number;
        end_ms: number;
        text: string;
        similarity: number;
        title: string;
        type: string;
        started_at: Date | null;
      }>
    >(
      `SELECT
         tc."meetingId" as meeting_id,
         tc."startMs" as start_ms,
         tc."endMs" as end_ms,
         tc.text,
         1 - (tc.embedding <=> $2::vector) as similarity,
         m.title,
         m.type::text,
         m."startedAt" as started_at
       FROM "MeetingTranscriptChunk" tc
       JOIN "Meeting" m ON m.id = tc."meetingId"
       WHERE tc."userId" = $1
         AND m."cardId" = $3
         AND m."deletedAt" IS NULL
         AND tc.embedding IS NOT NULL
       ORDER BY tc.embedding <=> $2::vector
       LIMIT $4`,
      userId,
      vec,
      cardId,
      limit,
    );
    return rows.map((r) => ({
      meetingId: r.meeting_id,
      meetingTitle: r.title,
      meetingType: r.type,
      meetingDate: r.started_at,
      startMs: r.start_ms,
      endMs: r.end_ms,
      text: r.text,
      similarity: Number(r.similarity ?? 0),
    }));
  }
}

/**
 * Парсит [mm:ss] из ответа AI и сопоставляет с ближайшим chunk'ом.
 */
function parseCitations(
  answer: string,
  chunks: Array<{
    startMs: number;
    endMs: number;
    text: string;
    meetingId: string;
    meetingTitle: string;
  }>,
): AnswerCitation[] {
  const citations: AnswerCitation[] = [];
  const seen = new Set<string>();
  for (const match of answer.matchAll(TIMESTAMP_REGEX)) {
    const m = Number(match[1]);
    const s = Number(match[2]);
    const ms = (m * 60 + s) * 1000;
    // Ищем ближайший chunk.
    let best: (typeof chunks)[number] | null = null;
    let bestDist = Infinity;
    for (const c of chunks) {
      const d = ms < c.startMs ? c.startMs - ms : ms > c.endMs ? ms - c.endMs : 0;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) {
      const key = `${best.meetingId}:${best.startMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        meetingId: best.meetingId,
        meetingTitle: best.meetingTitle,
        startMs: best.startMs,
        endMs: best.endMs,
        snippet: best.text.slice(0, 200),
      });
    }
  }
  return citations;
}
