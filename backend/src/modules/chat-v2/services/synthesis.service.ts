import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatV2Mode, ChatV2Scope, DataClass } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { BrandVoiceService } from '../../brand-voice/services/brand-voice.service';
import { ClonesService } from '../../clones/services/clones.service';
import type { StructuralRetrievalFilters } from '../../dialog-layer/services/query-plan-extractor.service';
import { RetrievalCacheService } from '../../dialog-layer/services/retrieval-cache.service';
import {
  ChatV2Service as KnowledgeCoreChatV2Service,
  type ChatV2Citation,
  type ChatV2Output,
  type ChatV2Scope as KnowledgeChatV2Scope,
  type ChatV2Stage,
} from '../../knowledge-core/services/chat-v2.service';

/**
 * SBA α-5 — SynthesisService.
 *
 * Обёртка над `ChatV2Service` из knowledge-core. Назначение:
 *   1) ТЗ 2026-06-15 — `mode` БОЛЬШЕ НЕ выбирает текст системного промпта:
 *      графовый ответ всегда идёт на единый промпт-ответчик
 *      (BASE_SYSTEM_PROMPT в knowledge-core). Override используется только
 *      для brand-voice (clone_style + scope=org). Отдельные движки
 *      (ClonesService.askPerson, brand-voice) остаются как ранний возврат /
 *      override и не зависят от текста режима. На postprocessing `mode` ещё
 *      влияет (uncertaintyNote для synthetic).
 *   2) Передать history + summary — knowledge-core ChatV2Service кладёт их
 *      в конец USER (cache-friendly).
 *   3) Собрать retrievalMeta / llmMeta для записи в ChatV2Message.
 *   4) Для mode='synthetic' — если в Org есть открытые ConflictItem,
 *      релевантные к найденным блокам, добавить uncertaintyNote.
 *
 * Сам retrieval + LLM call делает knowledge-core ChatV2Service (см.
 * `chat-v2.service.ts:ask`). Этот сервис ничего не дублирует.
 */

export interface SynthesisInput {
  tenantId: string;
  userId: string;
  question: string;
  mode: ChatV2Mode;
  scope: ChatV2Scope;
  scopeRefId: string | null;
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * SBA α-5 dialog-layer — заранее посчитанный standalone-вопрос (после
   * Contextualizer + confidence fallback). Если null — используем question.
   */
  standaloneQuestion?: string | null;
  /**
   * SBA α-5 dialog-layer — массив запросов для retrieval (multi-query
   * expansion).
   */
  queries?: ReadonlyArray<string>;
  /** SBA α-5 dialog-layer — temporal queries. */
  validAt?: Date | null;
  /** Query Understanding Волна 1 — резолвнутые структурные фильтры (Ф3 consume). */
  structuralFilters?: StructuralRetrievalFilters | null;
  /**
   * ЧАСТЬ B (ТЗ 2026-06-15 §7) — обогащённое понимание для параллельной ветки
   * умных таблиц (выбор таблицы + entity-bridge). Все опциональны: нет → ветка
   * таблиц не запускается. entityIds берётся из structuralFilters.entityIds в
   * оркестраторе; entityHints/aggregation — из queryPlan.filters.
   */
  tableEntityHints?: ReadonlyArray<string>;
  tableEntityIds?: ReadonlyArray<string>;
  tableAggregation?: boolean;
  /** SBA α-5 dialog-layer — сжатая старая часть диалога. */
  conversationSummary?: string | null;
  /** SBA α-5 dialog-layer — intent (для metrics / mode-prompt routing). */
  intent?:
    | 'factual'
    | 'exploratory'
    | 'analytical'
    | 'clone_roleplay'
    | null;
  /**
   * §4 Ф1 (2026-06-11) — опциональный колбэк прогресса для SSE-стриминга.
   * Прозрачно пробрасывается в knowledge-core ChatV2Service.ask (стадии
   * 'searching'/'writing'). Дефолт undefined = текущее поведение.
   */
  onStage?: (stage: ChatV2Stage) => void;
}

export interface SynthesisResult {
  text: string;
  citations: ChatV2Citation[];
  retrievalMeta: Record<string, unknown>;
  llmMeta: Record<string, unknown>;
  /** Если есть подсказка про противоречия — короткий текст для UI. */
  uncertaintyNote: string | null;
  /**
   * M-1 (2026-06-12) — derived класс данных ответа (из knowledge-core
   * ChatV2Output.dataClass). Для clone-пути (ClonesService.askPerson)
   * derived класс недоступен — консервативно 'sensitive' (личный корпус
   * сотрудника).
   */
  dataClass: DataClass;
}

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeCoreChatV2Service)
    private readonly chatV2: KnowledgeCoreChatV2Service,
    @Inject(RetrievalCacheService)
    private readonly retrievalCache: RetrievalCacheService,
    @Optional() @Inject(ClonesService)
    private readonly clones?: ClonesService,
    /**
     * SBA β-7 — Brand Voice Curator. При mode='clone_style' AND scope='org'
     * (без scopeRefId) подмешиваем BrandVoiceProfile в systemPrompt. Если
     * модуль не подключён (тесты / частичная сборка), деградируем до
     * обычного clone_style fallback.
     */
    @Optional() @Inject(BrandVoiceService)
    private readonly brandVoice?: BrandVoiceService,
  ) {}

  async synthesize(input: SynthesisInput): Promise<SynthesisResult> {
    // SBA γ-1 — mode='clone_style' с scope='card' и scopeRefId=personId →
    // делегируем ClonesService.askPerson. Цитаты + текст приходят оттуда.
    // Сохранение в ChatV2Message происходит на стороне ChatV2OrchestrationService
    // (как и для других mode), поэтому отсюда возвращаем «результат как
    // если бы был обычный synthesize».
    if (
      input.mode === 'clone_style' &&
      input.scope === 'card' &&
      input.scopeRefId &&
      this.clones
    ) {
      try {
        const cloneResult = await this.clones.askPerson({
          tenantId: input.tenantId,
          requesterUserId: input.userId,
          // scopeRefId для clone_style — это personId, т.к. UI/диспетчер
          // ставит personId в scope='card'. Если в будущем понадобится
          // role-clone через synthesize — переключим через scopeRefKind.
          personId: input.scopeRefId,
          question: input.question,
        });
        const citations: ChatV2Citation[] = cloneResult.citations.map((c) => ({
          meetingId: c.meetingId ?? '',
          meetingTitle: c.meetingTitle ?? '',
          startMs: c.startMs ?? 0,
          endMs: c.endMs ?? 0,
          snippet: c.snippet ?? '',
        }));
        return {
          text: cloneResult.text,
          citations,
          retrievalMeta: { mode: 'clone_style', usedBlockIds: [] },
          llmMeta: { mode: 'clone_style' },
          uncertaintyNote: null,
          // M-1 — askPerson не возвращает derived класс; ответ построен на
          // личном корпусе сотрудника → консервативно 'sensitive'.
          dataClass: 'sensitive',
        };
      } catch (err) {
        this.logger.warn(
          {
            scopeRefId: input.scopeRefId,
            err: err instanceof Error ? err.message : String(err),
          },
          'synthesis.clone_style: ClonesService.askPerson упал — fallback на synthetic',
        );
      }
    }

    const knowledgeScope = this.mapScope(input.scope);

    // SBA α-5 dialog-layer:
    //  - standaloneQuestion (если есть) → используется как основной query
    //    и как ключ RetrievalCache.
    //  - queries[] (если есть) → multi-query expansion в retrieval.
    //  - validAt → temporal-фильтр.
    //  - mode → текст системного промпта НЕ выбирает (ТЗ 2026-06-15): единый
    //    промпт-ответчик; override только для brand-voice (clone_style+org).
    //  - RetrievalCache lookup ДО fetchCandidates: hit → передаём
    //    `precomputedBlockIds` в knowledge-core и пропускаем retrieval.
    const effectiveQuery = input.standaloneQuestion ?? input.question;
    const validAtIso = input.validAt ? input.validAt.toISOString() : null;
    const cacheKeyArgs = {
      tenantId: input.tenantId,
      standaloneQuestion: effectiveQuery,
      scope: input.scope,
      scopeRefId: input.scopeRefId,
      validAt: validAtIso,
    } as const;
    const cachedRetrieval = await this.retrievalCache.get(cacheKeyArgs);
    // ТЗ 2026-06-15 — `mode` БОЛЬШЕ НЕ выбирает текст системного промпта:
    // графовый ответ идёт на единый промпт (override=null → knowledge-core
    // ChatV2Service подставит BASE_SYSTEM_PROMPT). Override остаётся только
    // для brand-voice (clone_style + scope=org) — это отдельный движок «голос
    // компании», а не «режим письма».
    let systemPromptOverride: string | null = null;

    // SBA β-7 — clone_style scope='org' (без scopeRefId) → company-level
    // brand voice. Подмешиваем BrandVoiceProfile в системный промпт, чтобы
    // LLM генерировал ответ в фирменном tone/values/taboos. Если профиль
    // пустой (corpus ниже порога) или сервис не подключён — оставляем
    // единый промпт (override=null).
    if (
      input.mode === 'clone_style' &&
      input.scope === 'org' &&
      !input.scopeRefId &&
      this.brandVoice
    ) {
      try {
        const profile = await this.brandVoice.getOrCreate(input.tenantId);
        const injected = buildClonedCompanyPrompt(profile);
        if (injected) {
          systemPromptOverride = injected;
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: input.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'synthesis.clone_style[scope=org]: BrandVoice load упал — fallback',
        );
      }
    }

    const result: ChatV2Output = await this.chatV2.ask({
      tenantId: input.tenantId,
      userId: input.userId,
      scope: knowledgeScope,
      scopeId: input.scopeRefId,
      query: effectiveQuery,
      history: input.history,
      conversationSummary: input.conversationSummary ?? null,
      queries: input.queries ?? undefined,
      validAt: input.validAt ?? null,
      structuralFilters: input.structuralFilters ?? null,
      // ЧАСТЬ B (ТЗ 2026-06-15 §7) — проброс обогащённого понимания для
      // параллельной ветки умных таблиц.
      tableEntityHints: input.tableEntityHints,
      tableEntityIds: input.tableEntityIds,
      tableAggregation: input.tableAggregation,
      intent: input.intent ?? undefined,
      systemPromptOverride,
      precomputedBlockIds: cachedRetrieval?.blockIds,
      // §4 Ф1 (2026-06-11) — проброс колбэка стадий прогресса (SSE).
      onStage: input.onStage,
    });

    // Сохраняем blockIds в RetrievalCache (если был miss).
    if (!cachedRetrieval && result.usedBlockIds.length > 0) {
      await this.retrievalCache.set(cacheKeyArgs, {
        blockIds: result.usedBlockIds,
        cachedAt: new Date().toISOString(),
      });
    }

    const retrievalMeta: Record<string, unknown> = {
      usedBlockIds: result.usedBlockIds,
    };
    const llmMeta: Record<string, unknown> = {
      model: result.modelUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };

    // Uncertainty note: только для synthetic mode + если есть открытые
    // конфликты в Org. Простая эвристика без проверки overlap'а конкретных
    // блоков (TODO в β: связать ConflictItem с usedBlockIds через cardId
    // → blockIds). На α-5 — общая подсказка.
    let uncertaintyNote: string | null = null;
    if (input.mode === 'synthetic' && result.usedBlockIds.length > 0) {
      const openConflicts = await this.prisma.conflictItem.count({
        where: { tenantId: input.tenantId, status: 'open' },
      });
      if (openConflicts > 0) {
        uncertaintyNote = `В организации есть открытые противоречия (${openConflicts}) — часть фактов может быть устаревшей. Проверьте раздел «Конфликты».`;
      }
    }

    // ТЗ 2026-06-15 — clone_style без подходящего движка (не card+personId для
    // askPerson и не org+brand-voice) сведён к обычному графовому ответу на
    // едином промпте: «режима письма» больше нет, добавочной пометки нет.
    return {
      text: result.message,
      citations: result.citations,
      retrievalMeta,
      llmMeta,
      uncertaintyNote,
      dataClass: result.dataClass,
    };
  }

  /**
   * Маппинг scope нашей α-5 модели → scope knowledge-core ChatV2Service.
   * - 'personal' пока маппится в 'org' (нет персонального индекса блоков
   *   до γ-1).
   * - 'issue' (Wave 2 polish T6-6b) маппится в 'card', чтобы переиспользовать
   *   существующий card-retrieval. Сам Issue подтягивается отдельно через
   *   `IssueCardHandler` (CardSpecialistRegistry), для него scopeRefId
   *   остаётся issueId без изменений.
   */
  private mapScope(scope: ChatV2Scope): KnowledgeChatV2Scope {
    if (scope === 'personal') return 'org';
    if (scope === 'issue') return 'card';
    return scope;
  }
}

// ─────────────────────────── SBA β-7 helpers ──────────────────────────

/**
 * Структура BrandVoiceProfile из BrandVoiceService.getOrCreate(). Сокращённая
 * — берём только нужные секции для инжекции в systemPrompt.
 */
interface BrandVoiceProfileForPrompt {
  tone: Record<string, number> | null;
  values:
    | Array<{ value: string; weight: number }>
    | null;
  taboos:
    | Array<{ phrase: string; alternative?: string; reason: string }>
    | null;
  belowCorpusThreshold: boolean;
}

/**
 * SBA β-7 — собирает системный промпт для chat-v2 в режиме «голос компании»
 * (mode='clone_style', scope='org'). При пустом профиле / корпус ниже
 * порога — возвращает null (caller оставляет override=null → единый
 * промпт-ответчик, ТЗ 2026-06-15).
 */
function buildClonedCompanyPrompt(
  profile: BrandVoiceProfileForPrompt,
): string | null {
  // Если профиль пустой (корпус ниже порога ИЛИ extract ещё не отработал) —
  // дегрейдим до единого промпта-ответчика (override=null у caller).
  if (
    profile.belowCorpusThreshold ||
    (profile.tone === null && profile.values === null && profile.taboos === null)
  ) {
    return null;
  }
  const lines: string[] = [
    'Ты — AI-помощник, который пишет от лица компании в её фирменном голосе бренда.',
    '',
    'Контекст: ниже извлечённый «голос бренда» (BrandVoiceProfile). Используй его как стилевую рамку — НЕ пересказывай его, а соблюдай.',
    '',
  ];

  if (profile.tone) {
    const toneEntries = Object.entries(profile.tone)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${TONE_LABEL_RU[k] ?? k}: ${v.toFixed(2)}`);
    if (toneEntries.length > 0) {
      lines.push('Тон (0..1):');
      for (const t of toneEntries) {
        lines.push(`- ${t}`);
      }
      lines.push('');
    }
  }
  if (profile.values && profile.values.length > 0) {
    lines.push('Ценности бренда (weight 0..1):');
    for (const v of profile.values.slice(0, 8)) {
      lines.push(`- ${v.value} (${v.weight.toFixed(2)})`);
    }
    lines.push('');
  }
  if (profile.taboos && profile.taboos.length > 0) {
    lines.push('Табу (НЕ использовать):');
    for (const t of profile.taboos.slice(0, 15)) {
      const alt = t.alternative ? ` → лучше: «${t.alternative}»` : '';
      lines.push(`- «${t.phrase}»${alt}. Причина: ${t.reason}`);
    }
    lines.push('');
  }
  lines.push(
    'Правила:',
    '- Отвечай на русском.',
    '- Соблюдай tone/values/taboos. Не пересказывай их в ответе.',
    '- Все ключевые утверждения помечай [BLOCK:<id>] из найденного контекста.',
    '- В конце ответа курсивом «(в фирменном голосе бренда)».',
  );
  return lines.join('\n');
}

/** Русские лейблы для 10 канонических осей тона. */
const TONE_LABEL_RU: Record<string, string> = {
  formal: 'формальность',
  technical: 'техничность',
  casual: 'непринуждённость',
  energetic: 'энергичность',
  authoritative: 'авторитетность',
  friendly: 'дружелюбность',
  playful: 'игривость',
  minimalist: 'минимализм',
  expressive: 'выразительность',
  inclusive: 'инклюзивность',
};
