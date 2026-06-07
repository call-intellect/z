import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DataClass } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from '../../rbac/knowledge-access-resolver.service';

import {
  ChatV2RetrievalService,
  type ChatV2Scope,
  type RankedBlockId,
} from './chat-v2-retrieval.service';
import { DataClassPolicyService } from './dataclass-policy.service';
import { ReasoningChainService } from './reasoning-chain.service';

/**
 * ChatV2Service — единый AI-чат поверх IdeaBlock'ов (Фаза 6 knowledge-core).
 *
 * 5 scope: org / meeting / card / theme / entity. Retrieval делегируется
 * `ChatV2RetrievalService`, эта сервис только собирает контекст, вызывает LLM,
 * парсит цитаты и возвращает результат.
 *
 * Контракт citations совместим с legacy chat (поля meetingId / meetingTitle /
 * startMs / endMs / snippet). Дополнительное поле `usedBlockIds` — для
 * отладки и будущего UI (показать какие блоки взял).
 *
 * Не делает stream/SSE — это vNext (см. decisions-log Фаза 6).
 */
export type { ChatV2Scope } from './chat-v2-retrieval.service';

export interface ChatV2Input {
  tenantId: string;
  userId: string;
  scope: ChatV2Scope;
  scopeId: string | null;
  query: string;
  /**
   * История диалога (последние 6 сообщений рекомендуется): user / assistant
   * пары. Подмешивается в systemPrompt как Q/A блок.
   */
  history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * SBA α-5 dialog-layer — Conversation.summary (сжатая старая часть).
   * Если задано — подмешивается в systemPrompt ДО списка последних сообщений.
   */
  conversationSummary?: string | null;
  /**
   * SBA α-5 dialog-layer — массив запросов для retrieval (multi-query
   * expansion). Если задан и .length > 1 — fetchCandidates вызывается для
   * каждого, blockIds объединяются (dedup + max-score).
   * Если не задан — используется query как единственный запрос.
   */
  queries?: ReadonlyArray<string>;
  /**
   * SBA α-5 dialog-layer — temporal queries. Если задан — фильтр
   * `IdeaBlock.createdAt <= validAt` (см. ChatV2RetrievalService).
   */
  validAt?: Date | null;
  /**
   * SBA α-5 dialog-layer — заранее посчитанные blockIds (RetrievalCache hit).
   * Если задан — retrieval НЕ запускается, сразу loadContextBlocks.
   */
  precomputedBlockIds?: ReadonlyArray<string>;
  /**
   * SBA α-5 dialog-layer — intent для metrics и (опц.) для будущего
   * tuning'а retrieval-параметров (например, topK по intent).
   */
  intent?: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay';
  /**
   * SBA α-5 dialog-layer — override BASE_SYSTEM_PROMPT для mode-specific
   * ответа. Mode-prompts заданы в `chat-v2/prompts/{factual|synthetic|clone-style}.prompt.ts`.
   * Если не задан — используется BASE_SYSTEM_PROMPT (default).
   */
  systemPromptOverride?: string | null;
}

export interface ChatV2Citation {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
}

export interface ChatV2Output {
  message: string;
  citations: ChatV2Citation[];
  modelUsed: string;
  usedBlockIds: string[];
  inputTokens: number;
  outputTokens: number;
}

/**
 * Внутренняя структура: одна полная запись блока с evidence (для prompt-сборки
 * и парсинга citations).
 */
interface ContextBlock {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  dataClass: DataClass;
  /**
   * Первая evidence блока, привязанная к встрече (если есть). Ровно она и
   * становится citation в ответе AI.
   */
  primaryMeetingEvidence: {
    meetingId: string;
    meetingTitle: string;
    startMs: number;
    endMs: number;
    snippet: string;
  } | null;
}

const BLOCK_REF_REGEX = /\[BLOCK:([a-z0-9]+)\]/gi;

/**
 * KC-Temporal W3.2 (2026-05-25) — бюджет символов на ВСЕ reasoning chain'ы
 * вместе (3 чейна по 3 узла depth=2). При превышении — fallback на depth=1.
 * 4000 символов ≈ 1000 токенов — допустимо при общем prompt-бюджете 8-16K.
 */
const CHAIN_CHARS_BUDGET = 4000;

/**
 * KC-Temporal W3.2 — отрендеренный reasoning chain (готов к подмешиванию в
 * user message).
 */
interface RenderedReasoningChain {
  seedBlockId: string;
  depth: 1 | 2;
  nodes: ReadonlyArray<{
    id: string;
    name: string;
    signalType: string;
    criticalQuestion: string;
    trustedAnswer: string;
    depth: number;
  }>;
}

/**
 * KC-Temporal W3.3 — отрендеренный counter-evidence блок.
 */
interface RenderedContradictingBlock {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  /** id того seed-блока, которому этот блок противоречит. */
  contradictsBlockId: string;
}

const BASE_SYSTEM_PROMPT = `Ты — AI-аналитик компании, работаешь на знании из её встреч и переписок.

Правила:
- Отвечай на русском, кратко и по делу (2-6 предложений; для сложных вопросов — до 12).
- Опирайся ТОЛЬКО на блоки из раздела «Контекст» ниже. Если данных нет — честно скажи "Недостаточно данных" и НЕ выдумывай.
- Когда ссылаешься на конкретный блок — обязательно ставь маркер вида [BLOCK:<id>] прямо в тексте, рядом с фактом. Можно несколько маркеров на одно утверждение.
- Если блоки противоречат друг другу — упомяни это и сошлись на оба ([BLOCK:<id1>] vs [BLOCK:<id2>]).
- Не выдумывай blockId, которых нет в контексте.
- KC-Temporal W3.2 — если в контексте есть блок с тегом [REASONING CHAIN FOR BLOCK <id>] — это цепочка обоснований (decision ← rationale ← факты) вокруг исходного блока. Используй её, чтобы дать развёрнутый ответ «почему», но цитируй маркером [BLOCK:<id>] только сам исходный блок, не каждый узел цепочки.
- KC-Temporal W3.3 — если в контексте есть блоки с тегом [CONTRADICTING BLOCK] — это блоки, противоречащие основным. Обязательно скажи про конфликт мнений или фактов, не игнорируй; предложи пользователю уточнить, какое утверждение актуально. Не выбирай «правильное» сам.`;

@Injectable()
export class ChatV2Service {
  private readonly logger = new Logger(ChatV2Service.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ChatV2RetrievalService)
    private readonly retrieval: ChatV2RetrievalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    // Ф4 (knowledge-access) — резолвер групп доступа для гейта chat-v2.
    // RbacModule @Global, поэтому импорт не нужен.
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
    // W4.1 — DataClassPolicyService для shadow-compare (см. ТЗ §W4.1).
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    // KC-Temporal W3.2 (2026-05-25) — reasoning chain hook. @Optional —
    // старые тесты, которые мокают только обязательные deps, продолжают
    // работать (без service hook просто не подмешиваем chain).
    @Optional()
    @Inject(ReasoningChainService)
    private readonly reasoningChain?: ReasoningChainService,
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

  /**
   * Главный метод. Делает retrieval, готовит prompt, вызывает LLM, парсит
   * цитаты и возвращает результат. Запись в `MeetingChatMessage` происходит
   * на уровне chat.service.ts (через ChatRepository) — этот сервис чистый,
   * без побочных эффектов на историю.
   */
  async ask(input: ChatV2Input): Promise<ChatV2Output> {
    const { tenantId, scope, scopeId, query } = input;
    const topK = this.cfg.knowledgeCore.chatV2TopBlocks;
    const graphHops = this.cfg.knowledgeCore.chatV2GraphHops;

    // Ф4 knowledge-access — режим гейта. off → ctx=null (поведение неизменно).
    const kaEnforcement = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      kaEnforcement !== 'off'
        ? await this.accessResolver.resolveAccessibleGroups({ tenantId, userId: input.userId })
        : null;
    const accessWhere =
      kaEnforcement === 'enforce' && accessCtx
        ? (this.accessResolver.buildAccessWhere(accessCtx) as Record<string, unknown>)
        : undefined;

    // 1) Retrieval blockId'ов под scope.
    //
    // SBA α-5 dialog-layer:
    //  - precomputedBlockIds (RetrievalCache HIT) → пропускаем fetchCandidates.
    //  - queries[] (multi-query expansion) → fetchCandidates по каждой,
    //    blockIds объединяются с приоритетом первого запроса.
    //  - validAt → temporal-фильтр на pool + graph (см. ChatV2RetrievalService).
    let rankedBlockIds: string[];
    if (input.precomputedBlockIds && input.precomputedBlockIds.length > 0) {
      rankedBlockIds = [...input.precomputedBlockIds].slice(0, topK);
    } else {
      const queries: string[] =
        input.queries && input.queries.length > 0
          ? [...input.queries]
          : [query];
      // Per-query topK берём поменьше для multi-query expansion'а, чтобы
      // total после merge ≈ topK * 1.5 (не раздувать LLM-контекст).
      const perQueryLimit =
        queries.length > 1
          ? Math.max(4, Math.ceil(topK / queries.length) + 2)
          : topK;
      const merged = new Map<string, number>();
      for (let i = 0; i < queries.length; i++) {
        const q = queries[i] ?? '';
        if (!q || q.length === 0) continue;
        const ranked: RankedBlockId[] = await this.retrieval.fetchCandidates({
          tenantId,
          scope,
          scopeId: scopeId ?? null,
          query: q,
          limit: perQueryLimit,
          graphHops,
          validAt: input.validAt ?? null,
          accessWhere,
        });
        // Приоритет первой query (originalOrStandalone): её score
        // повышается за счёт rank-boost'а.
        const boost = i === 0 ? 0.05 : 0;
        for (const r of ranked) {
          const prev = merged.get(r.blockId) ?? -Infinity;
          const adj = r.score + boost;
          if (adj > prev) merged.set(r.blockId, adj);
        }
      }
      rankedBlockIds = [...merged.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK)
        .map(([id]) => id);
    }

    // 2) Выгружаем сами блоки + первую evidence из встреч + meeting title.
    //    Ф4 — главный выходной шлюз доступа (см. loadContextBlocks).
    const contextBlocks = await this.loadContextBlocks(
      tenantId,
      rankedBlockIds,
      accessCtx,
      kaEnforcement,
      'chat',
    );

    // 3) Если контекст пуст — отвечаем без LLM.
    if (contextBlocks.length === 0) {
      return {
        message:
          'Недостаточно данных: я не нашёл подходящих блоков знаний по этому запросу.',
        citations: [],
        modelUsed: 'none',
        usedBlockIds: [],
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    // KC-Temporal W3.2 (2026-05-25) — reasoning chain hook.
    // Для top-3 source-блоков строим BFS depth=2 по reasoning-link'ам.
    // Если общий бюджет токенов цепочки превышает порог (см. константу
    // CHAIN_CHARS_BUDGET) — пересобираем depth=1 (fallback). Метрика
    // `chat_v2_reasoning_chains_attached_total{depth}` инкрементируется
    // по факту прикрепления.
    const reasoningChains = await this.buildReasoningChains(
      contextBlocks,
      accessWhere,
    );

    // KC-Temporal W3.3 (2026-05-25) — counter-evidence.
    // Для каждого блока ищем ребра `contradicts` (active) и подгружаем
    // другой конец (max 3 на блок). Метрика
    // `chat_v2_contradicting_blocks_in_context` фиксирует общее число.
    const contradictingBlocks = await this.loadContradictingBlocks(
      tenantId,
      contextBlocks,
      accessCtx,
      kaEnforcement,
    );

    // 4) Готовим prompt.
    const scopeAddon = await this.buildScopeAddon(scope, scopeId, tenantId);
    const systemPrompt = this.buildSystemPrompt(
      scopeAddon,
      input.history,
      input.conversationSummary ?? null,
      input.systemPromptOverride ?? null,
    );
    const userMessage = this.buildUserMessage(
      query,
      contextBlocks,
      reasoningChains,
      contradictingBlocks,
    );

    this.logger.debug(
      {
        scope,
        scopeId,
        rankedCount: rankedBlockIds.length,
        contextCount: contextBlocks.length,
        graphHops,
        validAt: input.validAt ?? null,
        intent: input.intent ?? null,
        multiQueryCount: input.queries?.length ?? 0,
      },
      'chat-v2 ask: starting llm call',
    );

    // 5) LLM call.
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть пользовательский вопрос (query) +
    // блоки контекста в маркеры данных. Системный prompt получает
    // INJECTION_GUARD_NOTE. История диалога подмешана в systemPrompt
    // (buildSystemPrompt), но это «системная сборка» с фиксированной
    // структурой, поэтому защиту даёт NOTE через withInjectionGuard.
    //
    // Источник = 'chat': основной user-вход — это `query`.
    const guardOn = this.isPromptInjectionGuardEnabled();
    if (guardOn) {
      const sanitized = sanitizeCustomPrompt(query);
      for (const pattern of sanitized.reasons) {
        this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
      }
    }
    const finalSystem = guardOn ? withInjectionGuard(systemPrompt) : systemPrompt;
    const finalUser = guardOn ? wrapUserData(userMessage) : userMessage;
    // W4.1/W4.2 — derive DataClass для chat_context.
    // legacy = maxDataClass(retrieval pool). proposed — derive с
    // kind='chat_context'. На enforce — передаём derive().dataClass в
    // llm.call (правильнее с точки зрения compliance: floor + private
    // aggregation учитываются). На shadow/off — legacy.
    const legacyDataClass = maxDataClass(contextBlocks.map((b) => b.dataClass));
    const enforcementChat = this.cfg?.dataClassPolicy.enforcement ?? 'off';
    const derivedChat = this.dataClassPolicy?.derive({
      sources: contextBlocks.map((b) => ({
        dataClass: b.dataClass,
        sourceId: b.id,
        sourceKind: 'idea_block' as const,
      })),
      context: { kind: 'chat_context' },
    });
    if (this.dataClassPolicy && derivedChat) {
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: legacyDataClass,
        proposedResult: derivedChat.dataClass,
        kind: 'chat_context',
        sourceIds: contextBlocks.map((b) => b.id),
      });
    }
    const effectiveDataClass =
      enforcementChat === 'enforce' && derivedChat
        ? derivedChat.dataClass
        : legacyDataClass;
    const result = await this.llm.call({
      taskType: 'chat-v2',
      systemPrompt: finalSystem,
      userMessage: finalUser,
      tenantId,
      userId: input.userId,
      sourceRef: { type: scope, id: scopeId ?? tenantId },
      // Фаза 11/W4.2: max dataClass по retrieval pool (с учётом floor'а).
      dataClass: effectiveDataClass,
    });

    // 6) Парсим citations: [BLOCK:<id>] → primaryMeetingEvidence блока.
    const citations = this.parseCitationsFromAnswer(
      result.text,
      contextBlocks,
    );
    const usedBlockIds = this.parseUsedBlockIds(result.text, contextBlocks);

    return {
      message: result.text,
      citations,
      modelUsed: result.modelUsed,
      usedBlockIds,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }

  // ─────────────────────────── private ───────────────────────────

  /**
   * Выгружает блоки + первую evidence (привязанную к meeting RawEvent).
   * Сохраняет порядок blockIds (он отражает релевантность).
   */
  private async loadContextBlocks(
    tenantId: string,
    blockIds: string[],
    accessCtx: KnowledgeAccessContext | null,
    enforcement: 'off' | 'shadow' | 'enforce',
    surface: string,
  ): Promise<ContextBlock[]> {
    if (blockIds.length === 0) return [];

    // Ф4 knowledge-access — выходной шлюз. off (accessCtx=null) или bypass →
    // НИ одного нового запроса, effectiveIds = blockIds (байт-в-байт). При
    // shadow считаем denied (метрика), выдачу НЕ меняем. При enforce —
    // отбрасываем недоступные блоки.
    let effectiveIds = blockIds;
    if (accessCtx && !accessCtx.isBypass) {
      const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
        accessCtx,
        blockIds,
      );
      if (enforcement === 'enforce') {
        effectiveIds = accessible;
        this.metrics.incAccessDenied({ surface }, denied);
      } else {
        // shadow — выдачу НЕ меняем, только метрика расхождения.
        this.metrics.incAccessShadowDiff({ surface }, denied);
      }
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: effectiveIds },
        tenantId,
        status: 'canonical',
      },
      select: {
        id: true,
        name: true,
        signalType: true,
        trustedAnswer: true,
        dataClass: true,
      },
    });
    if (blocks.length === 0) return [];

    // Все evidence для этих блоков, привязанные к meeting RawEvent.
    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        blockId: { in: blocks.map((b) => b.id) },
        sourceType: 'meeting',
      },
      select: {
        blockId: true,
        rawEventId: true,
        startMs: true,
        endMs: true,
        quote: true,
      },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
    });

    // Берём первую evidence на каждый блок.
    const firstByBlock = new Map<string, (typeof evidenceRows)[number]>();
    for (const ev of evidenceRows) {
      if (!firstByBlock.has(ev.blockId)) firstByBlock.set(ev.blockId, ev);
    }

    // Через RawEvent → meetingId, через Meeting → title.
    const rawEventIds = [...new Set(evidenceRows.map((e) => e.rawEventId))];
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: { id: { in: rawEventIds } },
      select: { id: true, sourceExternalId: true },
    });
    const rawIdToMeetingId = new Map<string, string>();
    for (const r of rawEvents) {
      if (r.sourceExternalId) rawIdToMeetingId.set(r.id, r.sourceExternalId);
    }

    const meetingIds = [...new Set([...rawIdToMeetingId.values()])];
    const meetings = await this.prisma.meeting.findMany({
      where: { id: { in: meetingIds } },
      select: { id: true, title: true },
    });
    const meetingIdToTitle = new Map<string, string>();
    for (const m of meetings) meetingIdToTitle.set(m.id, m.title);

    // Сохраняем порядок blockIds.
    const byId = new Map(blocks.map((b) => [b.id, b] as const));
    const out: ContextBlock[] = [];
    for (const id of blockIds) {
      const b = byId.get(id);
      if (!b) continue;
      const ev = firstByBlock.get(id);
      let primary: ContextBlock['primaryMeetingEvidence'] = null;
      if (ev) {
        const meetingId = rawIdToMeetingId.get(ev.rawEventId);
        const meetingTitle = meetingId
          ? meetingIdToTitle.get(meetingId) ?? '—'
          : null;
        if (meetingId && meetingTitle) {
          primary = {
            meetingId,
            meetingTitle,
            startMs: ev.startMs ?? 0,
            endMs: ev.endMs ?? 0,
            snippet: ev.quote.slice(0, 240),
          };
        }
      }
      out.push({
        id: b.id,
        name: b.name,
        signalType: b.signalType,
        trustedAnswer: b.trustedAnswer,
        dataClass: b.dataClass,
        primaryMeetingEvidence: primary,
      });
    }
    return out;
  }

  /**
   * Scope-зависимая добавка к system prompt.
   */
  private async buildScopeAddon(
    scope: ChatV2Scope,
    scopeId: string | null,
    tenantId: string,
  ): Promise<string> {
    if (scope === 'org' || !scopeId) {
      return 'Контекст вопроса: вся база знаний организации.';
    }
    if (scope === 'meeting') {
      const m = await this.prisma.meeting.findUnique({
        where: { id: scopeId },
        select: { title: true, type: true, tenantId: true },
      });
      if (m && m.tenantId === tenantId) {
        return `Контекст вопроса: одна встреча "${m.title}" (тип: ${m.type}). Отвечай только на основе её блоков.`;
      }
      return 'Контекст вопроса: одна встреча.';
    }
    if (scope === 'card') {
      const c = await this.prisma.card.findUnique({
        where: { id: scopeId },
        select: { name: true, kind: true, tenantId: true },
      });
      if (c && c.tenantId === tenantId) {
        return `Контекст вопроса: карточка "${c.name}" (тип: ${c.kind}). Отвечай только на основе её блоков и встреч.`;
      }
      return 'Контекст вопроса: одна карточка.';
    }
    if (scope === 'theme') {
      const t = await this.prisma.theme.findUnique({
        where: { id: scopeId },
        select: { name: true, branch: true, tenantId: true },
      });
      if (t && t.tenantId === tenantId) {
        return `Контекст вопроса: AI-тема "${t.name}"${t.branch ? ` (ветка: ${t.branch})` : ''}.`;
      }
      return 'Контекст вопроса: одна AI-тема.';
    }
    if (scope === 'entity') {
      const e = await this.prisma.entity.findUnique({
        where: { id: scopeId },
        select: { canonicalName: true, type: true, tenantId: true },
      });
      if (e && e.tenantId === tenantId) {
        return `Контекст вопроса: сущность "${e.canonicalName}" (${e.type}).`;
      }
      return 'Контекст вопроса: одна сущность.';
    }
    return '';
  }

  /**
   * Собирает system prompt: базовая инструкция (или override) + scope-addon
   * + conversation summary (если есть) + history (если есть).
   *
   * SBA α-5 dialog-layer:
   *  - `systemPromptOverride` — mode-specific (factual / synthetic / clone_style).
   *    Если null — используется BASE_SYSTEM_PROMPT.
   *  - `conversationSummary` — сжатая старая часть диалога (от
   *    ConversationSummarizerCron). Подмешивается ДО последних 6 messages.
   */
  private buildSystemPrompt(
    scopeAddon: string,
    history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
    conversationSummary?: string | null,
    systemPromptOverride?: string | null,
  ): string {
    const base =
      systemPromptOverride && systemPromptOverride.length > 0
        ? systemPromptOverride
        : BASE_SYSTEM_PROMPT;
    const parts: string[] = [base, '', scopeAddon];
    if (conversationSummary && conversationSummary.length > 0) {
      parts.push('', 'Контекст диалога (сжато):', conversationSummary);
    }
    if (history && history.length > 0) {
      const last = history.slice(-6);
      parts.push('', 'Предыдущие сообщения диалога:');
      for (const m of last) {
        const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
        // Обрезаем длинные сообщения, чтобы prompt не разрастался.
        const trimmed =
          m.content.length > 600 ? `${m.content.slice(0, 600)}…` : m.content;
        parts.push(`- ${role}: ${trimmed}`);
      }
    }
    return parts.join('\n');
  }

  /**
   * Собирает user message: вопрос + блок «Контекст:» с блоками + (если
   * есть) reasoning chain'ы + (если есть) contradicting блоки.
   *
   * KC-Temporal W3.2: каждый chain рендерится секцией
   * `[REASONING CHAIN FOR BLOCK <id>] depth=N nodes=K\n  - <name>: <answer>\n  ...`.
   *
   * KC-Temporal W3.3: contradicting блоки рендерятся отдельным разделом
   * `[CONTRADICTING BLOCK] ...` после основного «Контекст:».
   */
  private buildUserMessage(
    query: string,
    blocks: ReadonlyArray<ContextBlock>,
    reasoningChains: ReadonlyArray<RenderedReasoningChain>,
    contradictingBlocks: ReadonlyArray<RenderedContradictingBlock>,
  ): string {
    const parts: string[] = ['Контекст:'];
    for (const b of blocks) {
      const head = `[BLOCK:${b.id}] ${b.name} (${b.signalType}): ${b.trustedAnswer}`;
      parts.push(head);
      const ev = b.primaryMeetingEvidence;
      if (ev) {
        parts.push(
          `  Из встречи "${ev.meetingTitle}" [${formatMmSs(ev.startMs)}]: "${ev.snippet}"`,
        );
      }
    }

    // KC-Temporal W3.2 — reasoning chains.
    for (const chain of reasoningChains) {
      parts.push('');
      parts.push(
        `[REASONING CHAIN FOR BLOCK ${chain.seedBlockId}] depth=${chain.depth} nodes=${chain.nodes.length}`,
      );
      for (const n of chain.nodes) {
        // Пропускаем сам seed (он уже в основном контексте).
        if (n.id === chain.seedBlockId) continue;
        const indent = '  '.repeat(Math.max(1, n.depth));
        parts.push(`${indent}- (${n.signalType}) ${n.name}: ${n.trustedAnswer}`);
      }
    }

    // KC-Temporal W3.3 — counter-evidence.
    if (contradictingBlocks.length > 0) {
      parts.push('');
      parts.push('Противоречия (counter-evidence):');
      for (const c of contradictingBlocks) {
        parts.push(
          `[CONTRADICTING BLOCK] (противоречит [BLOCK:${c.contradictsBlockId}]) [BLOCK:${c.id}] ${c.name} (${c.signalType}): ${c.trustedAnswer}`,
        );
      }
    }

    parts.push('', 'Вопрос:', query);
    return parts.join('\n');
  }

  /**
   * KC-Temporal W3.2 (2026-05-25) — для top-3 source-блоков строит reasoning
   * chain. При превышении CHAR-бюджета (защита от token-overflow) делает
   * fallback на depth=1.
   */
  private async buildReasoningChains(
    blocks: ReadonlyArray<ContextBlock>,
    accessWhere?: Record<string, unknown>,
  ): Promise<RenderedReasoningChain[]> {
    if (!this.reasoningChain) return [];
    if (blocks.length === 0) return [];
    const topBlocks = blocks.slice(0, 3);

    // Шаг 1: пробуем depth=2 для каждого top-блока.
    // Ф4 — при enforce передаём accessWhere в buildChain: BFS не подгружает
    // недоступные соседние блоки (R11 — граф reasoning не протаскивает закрытого).
    // off/shadow → accessWhere undefined → поведение байт-в-байт.
    const depth2Chains: RenderedReasoningChain[] = [];
    let totalChars = 0;
    for (const b of topBlocks) {
      try {
        const chain = await this.reasoningChain.buildChain(b.id, 2, accessWhere);
        if (chain.nodes.length <= 1) continue; // только seed — не интересно.
        const rendered = {
          seedBlockId: b.id,
          depth: 2 as const,
          nodes: chain.nodes,
        };
        depth2Chains.push(rendered);
        totalChars += this.estimateChainChars(rendered);
      } catch (err) {
        this.logger.warn(
          { blockId: b.id, err: err instanceof Error ? err.message : String(err) },
          'chat-v2 reasoning-chain: buildChain depth=2 упал, пропускаем',
        );
      }
    }
    // Если все depth=2 цепочки помещаются — отдаём их.
    if (totalChars <= CHAIN_CHARS_BUDGET) {
      for (const _c of depth2Chains) {
        this.metrics.incChatV2ReasoningChainsAttached({ depth: 2 });
      }
      return depth2Chains;
    }

    // Шаг 2 (fallback): depth=1.
    const depth1Chains: RenderedReasoningChain[] = [];
    for (const b of topBlocks) {
      try {
        const chain = await this.reasoningChain.buildChain(b.id, 1, accessWhere);
        if (chain.nodes.length <= 1) continue;
        depth1Chains.push({
          seedBlockId: b.id,
          depth: 1 as const,
          nodes: chain.nodes,
        });
      } catch {
        // best-effort, уже залогировано выше при depth=2.
      }
    }
    for (const _c of depth1Chains) {
      this.metrics.incChatV2ReasoningChainsAttached({ depth: 1 });
    }
    return depth1Chains;
  }

  /**
   * Грубая оценка размера chain'а в символах — без token-counter'а.
   * 1 узел ≈ name + trustedAnswer + indent + signalType ≈ ~200 символов.
   */
  private estimateChainChars(chain: RenderedReasoningChain): number {
    let total = 0;
    for (const n of chain.nodes) {
      total += n.name.length + n.trustedAnswer.length + n.signalType.length + 20;
    }
    return total;
  }

  /**
   * KC-Temporal W3.3 (2026-05-25) — counter-evidence. Для каждого блока
   * ищет `IdeaBlockLink.relationType='contradicts'` (active), подгружает
   * другой конец (canonical, того же tenant'а). Max 3 contradicting на блок.
   * Дедуп по `contradicting block id` — один блок не показывается дважды
   * (даже если противоречит сразу нескольким основным).
   *
   * Метрика `chat_v2_contradicting_blocks_in_context` (histogram) — общее
   * число (после дедупа) на один ответ.
   */
  private async loadContradictingBlocks(
    tenantId: string,
    blocks: ReadonlyArray<ContextBlock>,
    accessCtx: KnowledgeAccessContext | null,
    enforcement: 'off' | 'shadow' | 'enforce',
  ): Promise<RenderedContradictingBlock[]> {
    if (blocks.length === 0) {
      this.metrics.observeChatV2ContradictingBlocksInContext(0);
      return [];
    }
    const blockIds = blocks.map((b) => b.id);
    // Все contradicts-связи, где один из концов — наш блок.
    const links = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId,
        status: 'active',
        relationType: 'contradicts',
        OR: [
          { fromBlockId: { in: blockIds } },
          { toBlockId: { in: blockIds } },
        ],
      },
      select: {
        fromBlockId: true,
        toBlockId: true,
        confidence: true,
      },
      // Сортировка по confidence — берём более «уверенные» противоречия.
      orderBy: { confidence: 'desc' },
      // 3 contradicting на блок × max blocks ~ 16 — лимит на пул 48.
      take: 64,
    });

    // Считаем «другой конец» для каждой связи + лимитируем по 3 на блок.
    const seenContradicting = new Set<string>();
    const perSeedCount = new Map<string, number>();
    type ContradictingPair = { seedId: string; otherId: string };
    const pairs: ContradictingPair[] = [];
    const seenSeeds = new Set(blockIds);
    for (const l of links) {
      const seedIsFrom = seenSeeds.has(l.fromBlockId);
      const seedId = seedIsFrom ? l.fromBlockId : l.toBlockId;
      const otherId = seedIsFrom ? l.toBlockId : l.fromBlockId;
      // Самопротиворечие (fromBlockId=toBlockId) — пропускаем.
      if (seedId === otherId) continue;
      // Если other тоже из набора blocks — это «внутренний» конфликт, не
      // counter-evidence. UI Chat-v2 уже обращает на это внимание через
      // BASE_SYSTEM_PROMPT. Пропускаем.
      if (seenSeeds.has(otherId)) continue;
      const count = perSeedCount.get(seedId) ?? 0;
      if (count >= 3) continue;
      if (seenContradicting.has(otherId)) continue;
      seenContradicting.add(otherId);
      perSeedCount.set(seedId, count + 1);
      pairs.push({ seedId, otherId });
    }
    if (pairs.length === 0) {
      this.metrics.observeChatV2ContradictingBlocksInContext(0);
      return [];
    }

    // Ф4 knowledge-access — counter-evidence блоки приходят через граф
    // (contradicts-рёбра) → R11: граф НЕ протаскивает недоступного. Гейтим
    // otherId до выборки. off (accessCtx=null) / bypass → effectivePairs=pairs
    // (байт-в-байт). enforce — отбрасываем недоступные; shadow — метрика.
    let effectivePairs = pairs;
    if (accessCtx && !accessCtx.isBypass) {
      const otherIds = [...new Set(pairs.map((p) => p.otherId))];
      const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
        accessCtx,
        otherIds,
      );
      if (enforcement === 'enforce') {
        const allowed = new Set(accessible);
        effectivePairs = pairs.filter((p) => allowed.has(p.otherId));
        this.metrics.incAccessDenied({ surface: 'chat' }, denied);
      } else {
        // shadow — выдачу НЕ меняем, только метрика расхождения.
        this.metrics.incAccessShadowDiff({ surface: 'chat' }, denied);
      }
    }
    if (effectivePairs.length === 0) {
      this.metrics.observeChatV2ContradictingBlocksInContext(0);
      return [];
    }

    // Подгружаем сами contradicting blocks (canonical, того же tenant'а).
    const fetched = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: effectivePairs.map((p) => p.otherId) },
        tenantId,
        status: 'canonical',
      },
      select: {
        id: true,
        name: true,
        signalType: true,
        trustedAnswer: true,
      },
    });
    const byId = new Map(fetched.map((b) => [b.id, b]));

    const out: RenderedContradictingBlock[] = [];
    for (const p of effectivePairs) {
      const b = byId.get(p.otherId);
      if (!b) continue;
      out.push({
        id: b.id,
        name: b.name,
        signalType: b.signalType,
        trustedAnswer: b.trustedAnswer,
        contradictsBlockId: p.seedId,
      });
    }
    this.metrics.observeChatV2ContradictingBlocksInContext(out.length);
    return out;
  }

  /**
   * Парсит [BLOCK:<id>] из ответа AI. Для каждого валидного blockId — берём
   * primaryMeetingEvidence и формируем citation. Дедуп по meetingId+startMs.
   */
  private parseCitationsFromAnswer(
    answer: string,
    blocks: ReadonlyArray<ContextBlock>,
  ): ChatV2Citation[] {
    const byId = new Map(blocks.map((b) => [b.id, b] as const));
    const out: ChatV2Citation[] = [];
    const seen = new Set<string>();
    for (const m of answer.matchAll(BLOCK_REF_REGEX)) {
      const id = m[1];
      if (!id) continue;
      const block = byId.get(id);
      if (!block || !block.primaryMeetingEvidence) continue;
      const ev = block.primaryMeetingEvidence;
      const key = `${ev.meetingId}:${ev.startMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        meetingId: ev.meetingId,
        meetingTitle: ev.meetingTitle,
        startMs: ev.startMs,
        endMs: ev.endMs,
        snippet: ev.snippet,
      });
    }
    return out;
  }

  /**
   * Уникальные blockId, на которые сослался AI (валидные — из контекста).
   */
  private parseUsedBlockIds(
    answer: string,
    blocks: ReadonlyArray<ContextBlock>,
  ): string[] {
    const valid = new Set(blocks.map((b) => b.id));
    const out = new Set<string>();
    for (const m of answer.matchAll(BLOCK_REF_REGEX)) {
      const id = m[1];
      if (id && valid.has(id)) out.add(id);
    }
    return [...out];
  }
}

function formatMmSs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
