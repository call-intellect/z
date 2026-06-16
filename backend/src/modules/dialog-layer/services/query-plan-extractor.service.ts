import { Inject, Injectable, Logger } from '@nestjs/common';
import { $Enums } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  EXTRACT_PLAN_JSON_SCHEMA,
  EXTRACT_PLAN_SYSTEM_PROMPT,
  buildExtractPlanUserPrompt,
} from '../prompts/extract-plan.prompt';

import { type PeriodExpr, resolvePeriod } from './period-resolver';

export interface QueryPlanFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  signalTypes: string[];
  themeBranches: string[];
  entityHints: string[];
  personScope: boolean;
  aggregation: boolean;
  needsAction: boolean;
  activeNow: boolean;
}

export interface StructuralRetrievalFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  signalTypes: string[];
  entityIds: string[];
  themeBranches: string[];
  bitemporalActiveOnly: boolean;
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
  questions: string[];
  todayIso: string;
  orgTimezone: string | null;
  conversationId: string | null;
}

export const QUERY_PLAN_MIN_CONFIDENCE = 0.6;

const ENTITY_HINT_MAX_LENGTH = 200;
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
  activeNow?: unknown;
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

  private readonly validSignalTypes = new Set<string>(Object.values($Enums.SignalType));
  private readonly validThemeBranches = new Set<string>(Object.values($Enums.ThemeBranch));

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async extract(input: QueryPlanExtractInput): Promise<QueryPlanResult> {
    const startedAt = Date.now();
    const orgTimezone = input.orgTimezone ?? 'Europe/Moscow';

    let rawText: string;
    try {
      const rawUser = buildExtractPlanUserPrompt({
        questions: input.questions,
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
          name: 'dialog_extract_plan_v2',
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
      return this.failOpen(startedAt);
    }

    const periodExpr = this.coercePeriodExpr(parsed.periodExpr);
    const periodDays = this.coercePeriodDays(parsed.periodDays);
    const signalTypes = this.sanitizeEnumArray(parsed.signalTypes, this.validSignalTypes);
    const themeBranches = this.sanitizeEnumArray(parsed.themeBranches, this.validThemeBranches);
    const entityHints = this.sanitizeEntityHints(parsed.entityHints);
    const personScope = this.coerceBool(parsed.personScope);
    const aggregation = this.coerceBool(parsed.aggregation);
    const needsAction = this.coerceBool(parsed.needsAction);
    const activeNow = this.coerceBool(parsed.activeNow);
    const confidence = this.coerceConfidence(parsed.confidence);

    const period = resolvePeriod(periodExpr, input.todayIso, orgTimezone, periodDays);

    const hasAnyFilter =
      !!(period.dateFrom || period.dateTo) ||
      signalTypes.length > 0 ||
      themeBranches.length > 0 ||
      entityHints.length > 0 ||
      personScope ||
      activeNow;

    const applied = hasAnyFilter && confidence >= QUERY_PLAN_MIN_CONFIDENCE;
    const durationSeconds = (Date.now() - startedAt) / 1000;

    if (!applied) {
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
        activeNow,
      },
      confidence,
      applied: true,
      durationSeconds,
    };
  }

  async resolveSelfPersonId(tenantId: string, userId: string): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  async resolveStructuralFilters(args: {
    tenantId: string;
    userId: string;
    plan: QueryPlanResult;
  }): Promise<StructuralRetrievalFilters | null> {
    const { tenantId, userId, plan } = args;
    if (!plan.applied) return null;

    try {
      const entityIds = await this.resolveEntityHints(tenantId, plan.filters.entityHints);

      if (plan.filters.personScope) {
        const selfEntityId = await this.resolveSelfEntityId(tenantId, userId);
        if (selfEntityId && !entityIds.includes(selfEntityId)) {
          entityIds.push(selfEntityId);
        }
      }

      const filters: StructuralRetrievalFilters = {
        dateFrom: plan.filters.dateFrom,
        dateTo: plan.filters.dateTo,
        signalTypes: plan.filters.signalTypes,
        entityIds,
        themeBranches: plan.filters.themeBranches,
        bitemporalActiveOnly: plan.filters.activeNow,
      };

      const nothingToFilter =
        !filters.dateFrom &&
        !filters.dateTo &&
        filters.signalTypes.length === 0 &&
        filters.entityIds.length === 0 &&
        filters.themeBranches.length === 0 &&
        !filters.bitemporalActiveOnly;
      if (nothingToFilter) return null;

      return filters;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { tenantId, err: message },
        'resolveStructuralFilters упал — fail-open (без структурного фильтра)',
      );
      return null;
    }
  }

  private async resolveEntityHints(tenantId: string, hints: string[]): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rawHint of hints) {
      const hint = rawHint.trim();
      if (!hint) continue;
      const entity = await this.prisma.entity.findFirst({
        where: {
          tenantId,
          mergedIntoId: null,
          OR: [
            { canonicalName: { equals: hint, mode: 'insensitive' } },
            { aliases: { has: hint } },
          ],
        },
        select: { id: true },
      });
      if (!entity) continue;
      if (seen.has(entity.id)) continue;
      seen.add(entity.id);
      out.push(entity.id);
      if (out.length >= ENTITY_HINT_MAX_COUNT) break;
    }
    return out;
  }

  private async resolveSelfEntityId(tenantId: string, userId: string): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { entityId: true },
    });
    return person?.entityId ?? null;
  }

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
      activeNow: false,
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

  private sanitizeEnumArray(raw: unknown, valid: ReadonlySet<string>): string[] {
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
