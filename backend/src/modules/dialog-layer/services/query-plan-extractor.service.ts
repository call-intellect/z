import { Inject, Injectable, Logger } from '@nestjs/common';
import { $Enums } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  EXTRACT_PLAN_JSON_SCHEMA,
  EXTRACT_PLAN_SYSTEM_PROMPT,
  buildExtractPlanUserPrompt,
} from '../prompts/extract-plan.prompt';

import {
  type PeriodExpr,
  resolvePeriod,
} from './period-resolver';

/**
 * Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0) — QueryPlanExtractorService.
 *
 * Извлекает СТРУКТУРУ вопроса к AI-чату (период / типы сигналов / ветки тем /
 * сущности / «я» / агрегация / нужно-действие) через LLM-агент
 * `dialog-extract-plan`, затем детерминированно резолвит период в пару
 * UTC-инстантов. Результат (`QueryPlanFilters`) позже (Ф2/Ф3) станет
 * recall-safe фильтром retrieval.
 *
 * Фаза 1 (эта): строит ТОЛЬКО извлекатель + резолвер. Прокси в retrieval (Ф2)
 * и SQL-фильтр (Ф3) — отдельные фазы.
 *
 * FAIL-OPEN: любой сбой (LLM упал / невалидный JSON / низкая уверенность) →
 * возвращаем пустой план с `applied=false`. Поиск тогда работает как раньше,
 * без фильтра — лучше «не сузить», чем «потерять релевантное».
 */

export interface QueryPlanFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  signalTypes: string[];
  themeBranches: string[];
  entityHints: string[];
  personScope: boolean;
  aggregation: boolean;
  needsAction: boolean;
}

export interface QueryPlanResult {
  filters: QueryPlanFilters;
  confidence: number;
  applied: boolean;
  durationSeconds: number;
}

export interface QueryPlanExtractInput {
  tenantId: string;
  userId: string;
  question: string;
  /** ISO момента «сейчас» (для детерминированного резолва периода). */
  todayIso: string;
  orgTimezone: string | null;
  conversationId: string | null;
}

/**
 * R3 code-fallback порог: план применяется только при confidence ≥ этого
 * значения. Источник правды для прода — AdminSetting (следующие фазы), здесь —
 * безопасный дефолт.
 */
export const QUERY_PLAN_MIN_CONFIDENCE = 0.6;

/** Максимальная длина одной entity-подсказки (защита от мусора LLM). */
const ENTITY_HINT_MAX_LENGTH = 200;
/** Максимальное число entity-подсказок. */
const ENTITY_HINT_MAX_COUNT = 10;

interface RawPlan {
  periodExpr?: unknown;
  periodDays?: unknown;
  signalTypes?: unknown;
  themeBranches?: unknown;
  entityHints?: unknown;
  personScope?: unknown;
  aggregation?: unknown;
  needsAction?: unknown;
  confidence?: unknown;
}

const VALID_PERIOD_EXPRS: ReadonlySet<PeriodExpr> = new Set<PeriodExpr>([
  'this_week',
  'last_week',
  'yesterday',
  'today',
  'this_month',
  'last_month',
  'last_n_days',
  'none',
]);

@Injectable()
export class QueryPlanExtractorService {
  private readonly logger = new Logger(QueryPlanExtractorService.name);

  // Runtime-наборы валидных enum-значений для санитизации ответа LLM.
  private readonly validSignalTypes = new Set<string>(
    Object.values($Enums.SignalType),
  );
  private readonly validThemeBranches = new Set<string>(
    Object.values($Enums.ThemeBranch),
  );

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async extract(input: QueryPlanExtractInput): Promise<QueryPlanResult> {
    const startedAt = Date.now();
    const orgTimezone = input.orgTimezone ?? 'Europe/Moscow';

    let rawText: string;
    try {
      // Защита от prompt-injection — всегда (см. query-classifier). SYSTEM
      // оборачиваем guard'ом, user-вопрос — маркерами данных. Гард включён
      // безусловно: для извлекателя это безопасно и проще, чем тянуть cfg.
      const rawUser = buildExtractPlanUserPrompt({
        question: input.question,
        todayIso: input.todayIso,
        orgTimezone,
      });
      const systemPrompt = withInjectionGuard(EXTRACT_PLAN_SYSTEM_PROMPT);
      const userMessage = wrapUserData(rawUser);

      const result = await this.llm.call({
        taskType: 'dialog-extract-plan',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt,
        userMessage,
        maxTokens: 800,
        responseFormat: {
          type: 'json_schema',
          name: 'dialog_extract_plan_response',
          strict: true,
          schema: EXTRACT_PLAN_JSON_SCHEMA,
        },
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      rawText = result.text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'QueryPlanExtractor LLM упал — fail-open (план не применяется)',
      );
      return this.failOpen(startedAt);
    }

    const parsed = this.parsePlanJson(rawText);
    if (parsed === null) {
      // JSON не распарсился — fail-open.
      return this.failOpen(startedAt);
    }

    // ── Санитизация и валидация ────────────────────────────────────────
    const periodExpr = this.coercePeriodExpr(parsed.periodExpr);
    const periodDays = this.coercePeriodDays(parsed.periodDays);
    const signalTypes = this.sanitizeEnumArray(
      parsed.signalTypes,
      this.validSignalTypes,
    );
    const themeBranches = this.sanitizeEnumArray(
      parsed.themeBranches,
      this.validThemeBranches,
    );
    const entityHints = this.sanitizeEntityHints(parsed.entityHints);
    const personScope = this.coerceBool(parsed.personScope);
    const aggregation = this.coerceBool(parsed.aggregation);
    const needsAction = this.coerceBool(parsed.needsAction);
    const confidence = this.coerceConfidence(parsed.confidence);

    const period = resolvePeriod(
      periodExpr,
      input.todayIso,
      orgTimezone,
      periodDays,
    );

    const hasAnyFilter =
      !!(period.dateFrom || period.dateTo) ||
      signalTypes.length > 0 ||
      themeBranches.length > 0 ||
      entityHints.length > 0 ||
      personScope;

    const applied = hasAnyFilter && confidence >= QUERY_PLAN_MIN_CONFIDENCE;
    const durationSeconds = (Date.now() - startedAt) / 1000;

    if (!applied) {
      // Не применяем → отдаём пустой план, чтобы downstream случайно ничего
      // не отфильтровал. confidence сохраняем для наблюдаемости.
      return {
        filters: this.emptyFilters(),
        confidence,
        applied: false,
        durationSeconds,
      };
    }

    return {
      filters: {
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        signalTypes,
        themeBranches,
        entityHints,
        personScope,
        aggregation,
        needsAction,
      },
      confidence,
      applied: true,
      durationSeconds,
    };
  }

  /**
   * Резолв «своего» Person по userId — НЕ мутирующий (read-only). Используется
   * Ф2 для personScope-фильтра. НЕ применять ensurePersonForUser — она создаёт
   * строки, что недопустимо в read-пути.
   */
  async resolveSelfPersonId(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  // ─────────────────────────── helpers ─────────────────────────────────

  private emptyFilters(): QueryPlanFilters {
    return {
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      themeBranches: [],
      entityHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
    };
  }

  private failOpen(startedAt: number): QueryPlanResult {
    return {
      filters: this.emptyFilters(),
      confidence: 0,
      applied: false,
      durationSeconds: (Date.now() - startedAt) / 1000,
    };
  }

  private parsePlanJson(text: string): RawPlan | null {
    try {
      const cleaned = this.stripCodeFence(text).trim();
      const parsed = JSON.parse(cleaned) as unknown;
      if (parsed === null || typeof parsed !== 'object') return null;
      return parsed as RawPlan;
    } catch {
      return null;
    }
  }

  private stripCodeFence(s: string): string {
    return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }

  private coercePeriodExpr(raw: unknown): PeriodExpr {
    if (typeof raw === 'string' && VALID_PERIOD_EXPRS.has(raw as PeriodExpr)) {
      return raw as PeriodExpr;
    }
    return 'none';
  }

  private coercePeriodDays(raw: unknown): number | null {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
    return null;
  }

  private sanitizeEnumArray(
    raw: unknown,
    valid: ReadonlySet<string>,
  ): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      if (!valid.has(v)) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  private sanitizeEntityHints(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      const trimmed = v.trim().slice(0, ENTITY_HINT_MAX_LENGTH);
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= ENTITY_HINT_MAX_COUNT) break;
    }
    return out;
  }

  private coerceBool(raw: unknown): boolean {
    return raw === true;
  }

  private coerceConfidence(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(0, Math.min(1, raw));
    }
    return 0;
  }
}
