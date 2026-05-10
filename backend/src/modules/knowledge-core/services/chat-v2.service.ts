import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';

import {
  ChatV2RetrievalService,
  type ChatV2Scope,
  type RankedBlockId,
} from './chat-v2-retrieval.service';

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

const BASE_SYSTEM_PROMPT = `Ты — AI-аналитик компании, работаешь на знании из её встреч и переписок.

Правила:
- Отвечай на русском, кратко и по делу (2-6 предложений; для сложных вопросов — до 12).
- Опирайся ТОЛЬКО на блоки из раздела «Контекст» ниже. Если данных нет — честно скажи "Недостаточно данных" и НЕ выдумывай.
- Когда ссылаешься на конкретный блок — обязательно ставь маркер вида [BLOCK:<id>] прямо в тексте, рядом с фактом. Можно несколько маркеров на одно утверждение.
- Если блоки противоречат друг другу — упомяни это и сошлись на оба ([BLOCK:<id1>] vs [BLOCK:<id2>]).
- Не выдумывай blockId, которых нет в контексте.`;

@Injectable()
export class ChatV2Service {
  private readonly logger = new Logger(ChatV2Service.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ChatV2RetrievalService)
    private readonly retrieval: ChatV2RetrievalService,
  ) {}

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

    // 1) Retrieval blockId'ов под scope.
    const ranked: RankedBlockId[] = await this.retrieval.fetchCandidates({
      tenantId,
      scope,
      scopeId: scopeId ?? null,
      query,
      limit: topK,
      graphHops,
    });

    // 2) Выгружаем сами блоки + первую evidence из встреч + meeting title.
    const contextBlocks = await this.loadContextBlocks(
      tenantId,
      ranked.map((r) => r.blockId),
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

    // 4) Готовим prompt.
    const scopeAddon = await this.buildScopeAddon(scope, scopeId, tenantId);
    const systemPrompt = this.buildSystemPrompt(scopeAddon, input.history);
    const userMessage = this.buildUserMessage(query, contextBlocks);

    this.logger.debug(
      {
        scope,
        scopeId,
        rankedCount: ranked.length,
        contextCount: contextBlocks.length,
        graphHops,
      },
      'chat-v2 ask: starting llm call',
    );

    // 5) LLM call.
    const result = await this.llm.call({
      taskType: 'chat-v2',
      systemPrompt,
      userMessage,
      tenantId,
      userId: input.userId,
      sourceRef: { type: scope, id: scopeId ?? tenantId },
      // Фаза 11: max dataClass по retrieval pool.
      dataClass: maxDataClass(contextBlocks.map((b) => b.dataClass)),
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
  ): Promise<ContextBlock[]> {
    if (blockIds.length === 0) return [];

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
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
   * Собирает system prompt: базовая инструкция + scope-addon + история (если есть).
   * История — последние 6 сообщений (3 user + 3 assistant).
   */
  private buildSystemPrompt(
    scopeAddon: string,
    history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  ): string {
    const parts: string[] = [BASE_SYSTEM_PROMPT, '', scopeAddon];
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
   * Собирает user message: вопрос + блок «Контекст:» с блоками.
   */
  private buildUserMessage(
    query: string,
    blocks: ReadonlyArray<ContextBlock>,
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
    parts.push('', 'Вопрос:', query);
    return parts.join('\n');
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
