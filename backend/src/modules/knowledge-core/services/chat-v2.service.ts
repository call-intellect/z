import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DataClass, SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService, maxDataClass } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import type { StructuralRetrievalFilters } from '../../dialog-layer/services/query-plan-extractor.service';
import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from '../../rbac/knowledge-access-resolver.service';

import {
  ChatV2RetrievalService,
  type ChatV2Scope,
  type RankedBlockId,
} from './chat-v2-retrieval.service';
import { ChatV2TableContextService } from './chat-v2-table-context.service';
import { DataClassPolicyService } from './dataclass-policy.service';
import { ReasoningChainService } from './reasoning-chain.service';

export type { ChatV2Scope } from './chat-v2-retrieval.service';

export type ChatV2Stage = 'understanding' | 'searching' | 'writing';

export interface ChatV2Input {
  tenantId: string;
  userId: string;
  scope: ChatV2Scope;
  scopeId: string | null;
  query: string;
  history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  conversationSummary?: string | null;
  queries?: ReadonlyArray<string>;
  validAt?: Date | null;
  structuralFilters?: StructuralRetrievalFilters | null;
  tableEntityHints?: ReadonlyArray<string>;
  tableEntityIds?: ReadonlyArray<string>;
  tableAggregation?: boolean;
  precomputedBlockIds?: ReadonlyArray<string>;
  intent?: 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay';
  systemPromptOverride?: string | null;
  onStage?: (stage: ChatV2Stage) => void;
}

export interface ChatV2Citation {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
  documentId?: string;
  documentName?: string;
}

export interface ChatV2Output {
  message: string;
  citations: ChatV2Citation[];
  modelUsed: string;
  usedBlockIds: string[];
  inputTokens: number;
  outputTokens: number;
  dataClass: DataClass;
}

interface ContextBlock {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  dataClass: DataClass;
  primaryMeetingEvidence: {
    meetingId: string;
    meetingTitle: string;
    startMs: number;
    endMs: number;
    snippet: string;
  } | null;
  primaryDocumentSource: {
    documentId: string;
    documentName: string;
    snippet: string;
  } | null;
}

const SIGNAL_TYPE_RU: Record<string, string> = {
  decision: 'решения',
  task_created: 'задачи/дела',
  task_completed: 'задачи/дела',
  commitment: 'задачи/дела',
  plan_item: 'задачи/дела',
  done_item: 'задачи/дела',
  risk: 'риски',
  churn_risk: 'риски',
  blocker: 'блокеры',
  idea: 'идеи',
  client_request: 'запросы клиента',
};

const SIGNAL_TYPE_CONTEXT_RU: Record<SignalType, string> = {
  fact: 'факт',
  pain: 'боль (проблема)',
  feature_request: 'пожелание (запрос доработки)',
  objection: 'возражение',
  churn_risk: 'риск оттока',
  idea: 'идея',
  risk: 'риск',
  commitment: 'обязательство',
  decision: 'решение',
  mood: 'настроение',
  drift: 'отклонение',
  competitor_move: 'действие конкурента',
  metric_change: 'изменение метрики',
  knowledge_gap: 'пробел в знаниях',
  reasoning: 'рассуждение',
  rationale: 'обоснование',
  decision_basis: 'основание решения',
  regulation: 'регламент',
  process_step: 'шаг процесса',
  expertise: 'экспертиза',
  experience: 'опыт',
  competence: 'компетенция',
  methodology_step: 'шаг методологии',
  hypothesis: 'гипотеза',
  result: 'результат',
  lesson: 'извлечённый урок',
  brand_principle: 'принцип бренда',
  content_artifact: 'материал',
  commitment_status: 'статус обязательства',
  plan_item: 'пункт плана',
  done_item: 'сделанное',
  blocker: 'блокер',
  team_friction: 'трение в команде',
  process_friction: 'трение в процессе',
  resource_gap: 'нехватка ресурса',
  suggestion: 'предложение',
  client_request: 'запрос клиента',
  question: 'вопрос',
  task_created: 'задача',
  task_status_changed: 'изменение статуса задачи',
  task_blocked: 'задача заблокирована',
  task_completed: 'выполненная задача',
  task_overdue: 'просроченная задача',
  task_reassigned: 'переназначенная задача',
  task_comment: 'комментарий к задаче',
  task_mention: 'упоминание в задаче',
  help_provided: 'оказана помощь',
  proactive_hint: 'проактивная подсказка',
  mentoring: 'наставничество',
  emotional_support: 'эмоциональная поддержка',
  constructive_feedback: 'конструктивная обратная связь',
  question_unanswered: 'вопрос без ответа',
  question_acknowledged_no_action: 'вопрос принят без действий',
  helped_by: 'получил помощь',
  helped_to: 'помог коллеге',
  thanks_explicit: 'благодарность',
};

function signalTypeContextRu(signalType: string): string {
  return SIGNAL_TYPE_CONTEXT_RU[signalType as SignalType] ?? signalType;
}

export const REASONING_CHAIN_TAG_PREFIX = '[ЦЕПОЧКА РАССУЖДЕНИЯ К ФАКТУ';
export const CONTRADICTING_FACT_TAG = '[ПРОТИВОРЕЧАЩИЙ ФАКТ]';
export const CONTRADICTIONS_HEADER = 'Противоречащие факты:';
export const TABLE_TAG_PREFIX = '[ТАБЛИЦА:';

const THEME_BRANCH_RU: Record<string, string> = {
  marketing: 'маркетинг',
  sales: 'продажи',
  product: 'продукт',
  finance: 'финансы',
  team: 'команда',
  operations: 'операции',
  strategy: 'стратегия',
  clients: 'клиенты',
  technology: 'технологии',
  production: 'производство',
  partnerships: 'партнёрства',
  legal: 'юридическое',
};

export function describeStructuralFilters(f: {
  dateFrom: Date | null;
  dateTo: Date | null;
  signalTypes: string[];
  entityIds: string[];
  themeBranches: string[];
  bitemporalActiveOnly: boolean;
}): string {
  const parts: string[] = [];

  if (f.dateFrom || f.dateTo) {
    parts.push('период');
  }

  if (f.signalTypes.length) {
    const terms = dedupe(f.signalTypes.map((t) => SIGNAL_TYPE_RU[t] ?? t));
    parts.push(`тип: ${terms.join('/')}`);
  }

  if (f.themeBranches.length) {
    const terms = dedupe(f.themeBranches.map((t) => THEME_BRANCH_RU[t] ?? t));
    parts.push(`тема: ${terms.join('/')}`);
  }

  if (f.entityIds.length) {
    parts.push('указанные сущности');
  }

  if (f.bitemporalActiveOnly) {
    parts.push('действующие сейчас');
  }

  return parts.join(', ');
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

const BLOCK_REF_REGEX = /\[BLOCK:([a-z0-9]+)\]/gi;

export function stripBlockMarkers(text: string): string {
  return text
    .replace(/\[CONTRADICTING BLOCK[^\]]*\]/gi, '')
    .replace(/\[REASONING CHAIN FOR BLOCK[^\]]*\]/gi, '')
    .replace(/\[ПРОТИВОРЕЧАЩИЙ ФАКТ[^\]]*\]/g, '')
    .replace(/\[ЦЕПОЧКА РАССУЖДЕНИЯ К ФАКТУ[^\]]*\]/g, '')
    .replace(/\[ТАБЛИЦА:[^\]]*\]/g, '')
    .replace(/\[BLOCK:[a-z0-9]+\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const CHAIN_CHARS_BUDGET = 4000;

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

interface RenderedContradictingBlock {
  id: string;
  name: string;
  signalType: string;
  trustedAnswer: string;
  contradictsBlockId: string;
}

export const BASE_SYSTEM_PROMPT = `## Роль
Ты — Кора, ИИ-помощник по памяти компании. Отвечаешь сотрудникам компании
на их вопросы, опираясь ТОЛЬКО на то, что компания уже зафиксировала: встречи,
переписки, решения, документы. Ты не универсальный чат-бот — ты память
и аналитик одной конкретной компании (она описана в разделе «О компании» ниже).

## Кому ты отвечаешь и что будет с ответом
- Спрашивает сотрудник компании — из кабинета или из мессенджера. Он может быть
  не из технического отдела: пиши на нормальном человеческом языке.
- Твой ответ — финальный. Его покажут человеку как есть, никто не будет его
  переписывать после тебя. Значит, он должен быть сразу понятным, аккуратным
  и честным.
- Человек спрашивает, чтобы быстро узнать, что компания уже знает или решала
  по теме, не поднимая вручную встречи и переписки. Сэкономь ему это время.

## Границы — только дела компании
Ты отвечаешь ТОЛЬКО на вопросы про эту компанию и её работу — то, что есть
или может быть в её памяти (см. «О компании» ниже).
- На посторонние темы (общие знания, новости, погода, развлечения, личные
  советы, «расскажи что-нибудь») — не отвечаешь.
- Код не пишешь и задачи, не связанные с компанией, не решаешь.
- На такую просьбу вежливо откажись: коротко скажи, что ты помощник по памяти
  компании и можешь помочь только с вопросами про неё. Не придумывай ответ
  ради «полезности».

## Как ты отвечаешь
1. Только из контекста. Опирайся строго на раздел «Контекст» в сообщении ниже.
   Не добавляй знаний «из общего опыта», которых в контексте нет.
2. Глубину выбираешь по вопросу — без жёсткого лимита. На простой фактический
   вопрос отвечай коротко и по сути. Но если какой-то момент важно пояснить,
   чтобы человек точно понял, — поясни, не обрезай себя искусственно. На вопрос
   «почему / как / в целом» — давай развёрнутый разбор. Ориентир — понятность,
   а не число предложений; и без воды.
3. Ссылайся на источник. Каждый факт подкрепляй маркером [BLOCK:<id>] прямо
   рядом с фактом — из него получится кликабельная ссылка на источник. Можно
   несколько маркеров на одно утверждение. Не придумывай номера, которых нет
   в контексте.
4. Честно про пустоту. Если ответа в контексте нет — так и скажи: «В памяти
   компании я этого не нашёл» — и не досочиняй.
5. Честно про надёжность. Где это важно, помечай словами, насколько факт
   надёжен: «по нескольким источникам» (подтверждён 2+ блоками), «однажды
   упоминалось» (единичный источник), «возможно устарело» (явно старее
   остальных или есть конфликт). Не вешай эти пометки на каждое предложение —
   только там, где это меняет доверие к факту.
6. Конфликт не заглаживай. Если факты спорят — назови оба
   ([BLOCK:<id1>] vs [BLOCK:<id2>]) и предложи человеку уточнить, какой
   актуальный. Никогда не выбирай «правильный» сам.

## Особые пометки в контексте (подсказки для тебя; в ответе их не показывай)
- «Цепочка рассуждения к факту» — разложенное «почему»: решение ← обоснование
  ← факты. Используй её для хорошего ответа на «почему», но ссылайся маркером
  только на исходный факт, а не на каждое звено.
- «Противоречащий факт» — кусок, который спорит с основным. Обязательно скажи
  про разногласие, не игнорируй; предложи уточнить, что сейчас актуально.
- «Данные из таблиц» — строки из умных таблиц компании. Используй наравне с
  фактами; при ссылке указывай таблицу «<название>» (цитата подставится сама).
  На счётный вопрос («сколько…») посчитай по строкам и дай число.

## Примеры (плохо → хорошо)
1. Два факта спорят.
   ✗ «Запуск назначен на март.»  (взял один, конфликт спрятал)
   ✓ «Данные расходятся: по одному обсуждению запуск в марте [BLOCK:11], по
     более позднему — перенесён на май [BLOCK:42]. Уточните, какая дата в силе.»
2. Ответа в памяти нет.
   ✗ «Обычно онбординг занимает пару недель.»  (досочинил из общих знаний)
   ✓ «В памяти компании я не нашёл, сколько занимает онбординг новичка —
     похоже, это нигде не зафиксировано.»
3. Технический мусор в ответе.
   ✗ «По данным CompanyProfile и блока decisions решение принято.»
   ✓ «Решение принято на встрече по партнёрству [BLOCK:7].»
4. Вопрос «почему».
   ✗ перечисляет каждое звено цепочки как отдельный факт с кучей маркеров.
   ✓ «Скидку убрали: она съедала маржу и не давала роста повторных
     продаж [BLOCK:5].»

## Самопроверка перед ответом
- Вопрос вообще про дела компании? Если нет — вежливый отказ, без выдумок.
- Каждый факт подкреплён [BLOCK:<id>] из контекста? Нет выдуманных номеров?
- Если данных не было — сказал честно, не досочинил?
- Конфликт назван, а не заглажен?
- В тексте нет ни одного английского/служебного слова, кроме маркеров
  [BLOCK:<id>]?
Если что-то не так — перепиши, и только потом отвечай.

## Запреты
- Никаких английских слов, кодов, технических названий в тексте ответа
  (кроме маркеров [BLOCK:<id>], которые станут ссылками). Даже если они есть
  во входе — переводи на человеческий русский.
- Не выдумывай факты, даты, имена, решения, которых нет в контексте.
- Не выбирай «победителя» при споре двух фактов.`;

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
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    @Optional()
    @Inject(ReasoningChainService)
    private readonly reasoningChain?: ReasoningChainService,
    @Optional()
    @Inject(ChatV2TableContextService)
    private readonly tableContext?: ChatV2TableContextService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async ask(input: ChatV2Input): Promise<ChatV2Output> {
    const { tenantId, scope, scopeId, query } = input;
    const topK = this.cfg.knowledgeCore.chatV2TopBlocks;
    const graphHops = this.cfg.knowledgeCore.chatV2GraphHops;

    const kaEnforcement = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      kaEnforcement !== 'off'
        ? await this.accessResolver.resolveAccessibleGroups({ tenantId, userId: input.userId })
        : null;
    const accessWhere =
      kaEnforcement === 'enforce' && accessCtx
        ? (this.accessResolver.buildAccessWhere(accessCtx) as Record<string, unknown>)
        : undefined;

    this.metrics.incQueryPlanRetrievalFiltered({
      filtered: input.structuralFilters ? 'yes' : 'no',
    });

    try {
      input.onStage?.('searching');
    } catch {}

    const [retrievalSettled, tableSettled] = await Promise.allSettled([
      this.runRetrieval(input, {
        tenantId,
        scope,
        scopeId: scopeId ?? null,
        query,
        topK,
        graphHops,
        accessWhere,
      }),
      this.runTableBranch(input, tenantId),
    ]);

    const rankedBlockIds: string[] =
      retrievalSettled.status === 'fulfilled' ? retrievalSettled.value : [];
    if (retrievalSettled.status === 'rejected') {
      this.logger.warn(
        {
          err:
            retrievalSettled.reason instanceof Error
              ? retrievalSettled.reason.message
              : String(retrievalSettled.reason),
        },
        'chat-v2 ask: графовый retrieval упал',
      );
    }
    const tableRows: Array<{ tableName: string; cells: string }> =
      tableSettled.status === 'fulfilled' ? tableSettled.value : [];

    const contextBlocks = await this.loadContextBlocks(
      tenantId,
      rankedBlockIds,
      accessCtx,
      kaEnforcement,
      'chat',
    );

    if (contextBlocks.length === 0 && tableRows.length === 0) {
      const desc = input.structuralFilters
        ? describeStructuralFilters(input.structuralFilters)
        : '';
      const message = input.structuralFilters
        ? desc
          ? `По заданным условиям (${desc}) в памяти ничего не нашлось.`
          : 'По заданным условиям в памяти ничего не нашлось.'
        : 'Недостаточно данных: я не нашёл подходящих блоков знаний по этому запросу.';
      if (input.structuralFilters) {
        this.metrics.incQueryPlanEmptyPool({ result: 'empty' });
      }
      return {
        message,
        citations: [],
        modelUsed: 'none',
        usedBlockIds: [],
        inputTokens: 0,
        outputTokens: 0,
        dataClass: 'internal',
      };
    }

    const reasoningChains = await this.buildReasoningChains(contextBlocks, accessWhere);

    const contradictingBlocks = await this.loadContradictingBlocks(
      tenantId,
      contextBlocks,
      accessCtx,
      kaEnforcement,
    );

    const companyAbout = await this.buildCompanyAbout(tenantId);
    const scopeAddon = await this.buildScopeAddon(scope, scopeId, tenantId);
    const systemPrompt = this.buildSystemPrompt(
      scopeAddon,
      input.systemPromptOverride ?? null,
      companyAbout,
    );
    const userMessage = this.buildUserMessage(
      query,
      contextBlocks,
      reasoningChains,
      contradictingBlocks,
      {
        conversationSummary: input.conversationSummary ?? null,
        history: input.history,
        tableRows,
      },
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

    const guardOn = this.isPromptInjectionGuardEnabled();
    if (guardOn) {
      const sanitized = sanitizeCustomPrompt(query);
      for (const pattern of sanitized.reasons) {
        this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
      }
    }
    const finalSystem = guardOn ? withInjectionGuard(systemPrompt) : systemPrompt;
    const finalUser = guardOn ? wrapUserData(userMessage) : userMessage;
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
      enforcementChat === 'enforce' && derivedChat ? derivedChat.dataClass : legacyDataClass;
    try {
      input.onStage?.('writing');
    } catch {}
    const result = await this.llm.call({
      taskType: 'chat-v2',
      systemPrompt: finalSystem,
      userMessage: finalUser,
      tenantId,
      userId: input.userId,
      sourceRef: { type: scope, id: scopeId ?? tenantId },
      dataClass: effectiveDataClass,
      timeoutMs: this.cfg.knowledgeCore.chatV2SynthesisTimeoutMs,
    });

    const citations = this.parseCitationsFromAnswer(result.text, contextBlocks);
    const usedBlockIds = this.parseUsedBlockIds(result.text, contextBlocks);

    return {
      message: stripBlockMarkers(result.text),
      citations,
      modelUsed: result.modelUsed,
      usedBlockIds,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      dataClass: effectiveDataClass,
    };
  }

  private async runRetrieval(
    input: ChatV2Input,
    ctx: {
      tenantId: string;
      scope: ChatV2Scope;
      scopeId: string | null;
      query: string;
      topK: number;
      graphHops: number;
      accessWhere: Record<string, unknown> | undefined;
    },
  ): Promise<string[]> {
    const { tenantId, scope, scopeId, query, topK, graphHops, accessWhere } = ctx;

    if (input.precomputedBlockIds && input.precomputedBlockIds.length > 0) {
      return [...input.precomputedBlockIds].slice(0, topK);
    }

    const queries: string[] =
      input.queries && input.queries.length > 0 ? [...input.queries] : [query];
    const perQueryLimit =
      queries.length > 1 ? Math.max(4, Math.ceil(topK / queries.length) + 2) : topK;
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
        dateFrom: input.structuralFilters?.dateFrom ?? null,
        dateTo: input.structuralFilters?.dateTo ?? null,
        signalTypes: input.structuralFilters?.signalTypes,
        entityIds: input.structuralFilters?.entityIds,
        themeBranches: input.structuralFilters?.themeBranches,
        bitemporalActiveOnly: input.structuralFilters?.bitemporalActiveOnly ?? false,
      });
      const boost = i === 0 ? 0.05 : 0;
      for (const r of ranked) {
        const prev = merged.get(r.blockId) ?? -Infinity;
        const adj = r.score + boost;
        if (adj > prev) merged.set(r.blockId, adj);
      }
    }
    return [...merged.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id);
  }

  private async runTableBranch(
    input: ChatV2Input,
    tenantId: string,
  ): Promise<Array<{ tableName: string; cells: string }>> {
    if (!this.tableContext) return [];
    const entityIds = input.tableEntityIds ?? [];
    const entityHints = input.tableEntityHints ?? [];
    const queries = input.queries && input.queries.length > 0 ? input.queries : [];
    if (entityIds.length === 0 && entityHints.length === 0 && queries.length === 0) {
      return [];
    }
    try {
      return await this.tableContext.fetchTableContext({
        tenantId,
        queries: [...queries],
        entityIds: [...entityIds],
        entityHints: [...entityHints],
        aggregation: input.tableAggregation ?? false,
      });
    } catch (err) {
      this.logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'chat-v2 runTableBranch: сбой — возвращаем [] (граф отвечает)',
      );
      return [];
    }
  }

  private async loadContextBlocks(
    tenantId: string,
    blockIds: string[],
    accessCtx: KnowledgeAccessContext | null,
    enforcement: 'off' | 'shadow' | 'enforce',
    surface: string,
  ): Promise<ContextBlock[]> {
    if (blockIds.length === 0) return [];

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

    const firstByBlock = new Map<string, (typeof evidenceRows)[number]>();
    for (const ev of evidenceRows) {
      if (!firstByBlock.has(ev.blockId)) firstByBlock.set(ev.blockId, ev);
    }

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

    const blocksWithoutMeeting = blocks.map((b) => b.id).filter((id) => !firstByBlock.has(id));
    const docSourceByBlock = await this.loadDocumentSources(tenantId, blocksWithoutMeeting);

    const byId = new Map(blocks.map((b) => [b.id, b] as const));
    const out: ContextBlock[] = [];
    for (const id of blockIds) {
      const b = byId.get(id);
      if (!b) continue;
      const ev = firstByBlock.get(id);
      let primary: ContextBlock['primaryMeetingEvidence'] = null;
      if (ev) {
        const meetingId = rawIdToMeetingId.get(ev.rawEventId);
        const meetingTitle = meetingId ? (meetingIdToTitle.get(meetingId) ?? '—') : null;
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
      const docSource = primary ? null : (docSourceByBlock.get(id) ?? null);
      out.push({
        id: b.id,
        name: b.name,
        signalType: b.signalType,
        trustedAnswer: b.trustedAnswer,
        dataClass: b.dataClass,
        primaryMeetingEvidence: primary,
        primaryDocumentSource: docSource,
      });
    }
    return out;
  }

  private async loadDocumentSources(
    tenantId: string,
    blockIds: string[],
  ): Promise<Map<string, { documentId: string; documentName: string; snippet: string }>> {
    const result = new Map<string, { documentId: string; documentName: string; snippet: string }>();
    if (blockIds.length === 0) return result;

    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        blockId: { in: blockIds },
        rawEvent: {
          tenantId,
          sourceExternalId: { startsWith: 'doc:' },
        },
      },
      select: {
        blockId: true,
        quote: true,
        rawEvent: { select: { sourceExternalId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (evidenceRows.length === 0) return result;

    type DocEvidence = { documentId: string; snippet: string };
    const firstDocByBlock = new Map<string, DocEvidence>();
    const documentIds = new Set<string>();
    for (const ev of evidenceRows) {
      if (firstDocByBlock.has(ev.blockId)) continue;
      const ext = ev.rawEvent?.sourceExternalId;
      if (!ext || !ext.startsWith('doc:')) continue;
      const documentId = ext.slice('doc:'.length);
      if (!documentId) continue;
      firstDocByBlock.set(ev.blockId, {
        documentId,
        snippet: ev.quote.slice(0, 240),
      });
      documentIds.add(documentId);
    }
    if (documentIds.size === 0) return result;

    const documents = await this.prisma.document.findMany({
      where: {
        id: { in: [...documentIds] },
        tenantId,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    const docNameById = new Map<string, string>();
    for (const d of documents) docNameById.set(d.id, d.name);

    for (const [blockId, ev] of firstDocByBlock) {
      const documentName = docNameById.get(ev.documentId);
      if (!documentName) continue;
      result.set(blockId, {
        documentId: ev.documentId,
        documentName,
        snippet: ev.snippet,
      });
    }
    return result;
  }

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

  private async buildCompanyAbout(tenantId: string): Promise<string> {
    try {
      const profile = await this.prisma.companyProfile.findUnique({
        where: { tenantId },
        select: { displayName: true, stage: true, missionJson: true },
      });
      if (!profile) return '';
      const lines: string[] = [];
      const name = profile.displayName?.trim();
      if (name) lines.push(`Название: ${name}`);
      const stage = profile.stage?.trim();
      if (stage) lines.push(`Стадия: ${stage}`);
      const mission = extractContentMdSafe(profile.missionJson);
      if (mission) lines.push(`Миссия: ${mission}`);
      if (lines.length === 0) return '';
      return ['## О компании', ...lines].join('\n');
    } catch (err) {
      this.logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'chat-v2 buildCompanyAbout: чтение CompanyProfile упало — секция опущена',
      );
      return '';
    }
  }

  private buildSystemPrompt(
    scopeAddon: string,
    systemPromptOverride?: string | null,
    companyAbout?: string,
  ): string {
    const base =
      systemPromptOverride && systemPromptOverride.length > 0
        ? systemPromptOverride
        : BASE_SYSTEM_PROMPT;
    const parts: string[] = [base, '', scopeAddon];
    if (companyAbout && companyAbout.length > 0) {
      parts.push('', companyAbout);
    }
    return parts.join('\n');
  }

  private buildUserMessage(
    query: string,
    blocks: ReadonlyArray<ContextBlock>,
    reasoningChains: ReadonlyArray<RenderedReasoningChain>,
    contradictingBlocks: ReadonlyArray<RenderedContradictingBlock>,
    extra?: {
      conversationSummary?: string | null;
      history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
      tableRows?: ReadonlyArray<{ tableName: string; cells: string }>;
    },
  ): string {
    const parts: string[] = [];

    const summary = extra?.conversationSummary;
    if (summary && summary.length > 0) {
      parts.push('Краткое содержание диалога:', summary, '');
    }
    const history = extra?.history;
    if (history && history.length > 0) {
      const last = history.slice(-6);
      parts.push('Последние сообщения диалога:');
      for (const m of last) {
        const role = m.role === 'user' ? 'Пользователь' : 'Ассистент';
        const trimmed = m.content.length > 600 ? `${m.content.slice(0, 600)}…` : m.content;
        parts.push(`- ${role}: ${trimmed}`);
      }
      parts.push('');
    }

    parts.push('Контекст:');
    for (const b of blocks) {
      const head = `[BLOCK:${b.id}] ${b.name} (${signalTypeContextRu(b.signalType)}): ${b.trustedAnswer}`;
      parts.push(head);
      const ev = b.primaryMeetingEvidence;
      if (ev) {
        parts.push(
          `  Из встречи "${ev.meetingTitle}" [${formatMmSs(ev.startMs)}]: "${ev.snippet}"`,
        );
      }
    }

    for (const chain of reasoningChains) {
      parts.push('');
      parts.push(`${REASONING_CHAIN_TAG_PREFIX} ${chain.seedBlockId}]`);
      for (const n of chain.nodes) {
        if (n.id === chain.seedBlockId) continue;
        const indent = '  '.repeat(Math.max(1, n.depth));
        parts.push(
          `${indent}- (${signalTypeContextRu(n.signalType)}) ${n.name}: ${n.trustedAnswer}`,
        );
      }
    }

    if (contradictingBlocks.length > 0) {
      parts.push('');
      parts.push(CONTRADICTIONS_HEADER);
      for (const c of contradictingBlocks) {
        parts.push(
          `${CONTRADICTING_FACT_TAG} (противоречит [BLOCK:${c.contradictsBlockId}]) [BLOCK:${c.id}] ${c.name} (${signalTypeContextRu(c.signalType)}): ${c.trustedAnswer}`,
        );
      }
    }

    const tableRows = extra?.tableRows;
    if (tableRows && tableRows.length > 0) {
      parts.push('');
      parts.push('Данные из таблиц:');
      for (const r of tableRows) {
        parts.push(`${TABLE_TAG_PREFIX} ${r.tableName}] ${r.cells}`);
      }
    }

    parts.push('', 'Вопрос:', query);
    return parts.join('\n');
  }

  private async buildReasoningChains(
    blocks: ReadonlyArray<ContextBlock>,
    accessWhere?: Record<string, unknown>,
  ): Promise<RenderedReasoningChain[]> {
    if (!this.reasoningChain) return [];
    if (blocks.length === 0) return [];
    const topBlocks = blocks.slice(0, 3);

    const depth2Chains: RenderedReasoningChain[] = [];
    let totalChars = 0;
    for (const b of topBlocks) {
      try {
        const chain = await this.reasoningChain.buildChain(b.id, 2, accessWhere);
        if (chain.nodes.length <= 1) continue;
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
    if (totalChars <= CHAIN_CHARS_BUDGET) {
      for (const _c of depth2Chains) {
        this.metrics.incChatV2ReasoningChainsAttached({ depth: 2 });
      }
      return depth2Chains;
    }

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
      } catch {}
    }
    for (const _c of depth1Chains) {
      this.metrics.incChatV2ReasoningChainsAttached({ depth: 1 });
    }
    return depth1Chains;
  }

  private estimateChainChars(chain: RenderedReasoningChain): number {
    let total = 0;
    for (const n of chain.nodes) {
      total += n.name.length + n.trustedAnswer.length + n.signalType.length + 20;
    }
    return total;
  }

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
    const links = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId,
        status: 'active',
        relationType: 'contradicts',
        OR: [{ fromBlockId: { in: blockIds } }, { toBlockId: { in: blockIds } }],
      },
      select: {
        fromBlockId: true,
        toBlockId: true,
        confidence: true,
      },
      orderBy: { confidence: 'desc' },
      take: 64,
    });

    const seenContradicting = new Set<string>();
    const perSeedCount = new Map<string, number>();
    type ContradictingPair = { seedId: string; otherId: string };
    const pairs: ContradictingPair[] = [];
    const seenSeeds = new Set(blockIds);
    for (const l of links) {
      const seedIsFrom = seenSeeds.has(l.fromBlockId);
      const seedId = seedIsFrom ? l.fromBlockId : l.toBlockId;
      const otherId = seedIsFrom ? l.toBlockId : l.fromBlockId;
      if (seedId === otherId) continue;
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
        this.metrics.incAccessShadowDiff({ surface: 'chat' }, denied);
      }
    }
    if (effectivePairs.length === 0) {
      this.metrics.observeChatV2ContradictingBlocksInContext(0);
      return [];
    }

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
      if (!block) continue;
      if (block.primaryMeetingEvidence) {
        const ev = block.primaryMeetingEvidence;
        const key = `meeting:${ev.meetingId}:${ev.startMs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          meetingId: ev.meetingId,
          meetingTitle: ev.meetingTitle,
          startMs: ev.startMs,
          endMs: ev.endMs,
          snippet: ev.snippet,
        });
      } else if (block.primaryDocumentSource) {
        const doc = block.primaryDocumentSource;
        const key = `doc:${doc.documentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          meetingId: '',
          meetingTitle: '',
          startMs: 0,
          endMs: 0,
          snippet: doc.snippet,
          documentId: doc.documentId,
          documentName: doc.documentName,
        });
      }
    }
    return out;
  }

  private parseUsedBlockIds(answer: string, blocks: ReadonlyArray<ContextBlock>): string[] {
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

function extractContentMdSafe(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).contentMd;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}
