import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

@Injectable()
export class IssueGoalSuggestService {
  private readonly logger = new Logger(IssueGoalSuggestService.name);
  private static readonly KNN_DISTANCE_THRESHOLD = 0.2;
  private static readonly KNN_VOTING_SHARE = 0.6;
  private static readonly KNN_LIMIT = 10;
  private static readonly LLM_TIMEOUT_MS = 8_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async suggestGoal(args: {
    tenantId: string;
    issueId: string;
  }): Promise<IssueGoalSuggestResult | null> {
    const tenantTop = tenantTopOf(args.tenantId);
    try {
      const issue = await this.prisma.issue.findFirst({
        where: { id: args.issueId, tenantId: args.tenantId, deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          descriptionStripped: true,
        },
      });
      if (!issue) return null;

      const knnResult = await this.tryKnn(args.tenantId, args.issueId);
      if (knnResult) {
        this.metrics?.incAiIssueGoalSuggested({
          tenantTop,
          accepted: 'false',
          source: 'knn',
        });
        return { ...knnResult, source: 'knn' };
      }

      const llmResult = await this.tryLlm({
        tenantId: args.tenantId,
        issueId: issue.id,
        title: issue.title,
        description: issue.descriptionStripped ?? issue.description ?? '',
      });
      if (llmResult) {
        this.metrics?.incAiIssueGoalSuggested({
          tenantTop,
          accepted: 'false',
          source: 'llm',
        });
        return { ...llmResult, source: 'llm' };
      }
      this.metrics?.incAiIssueGoalSuggested({
        tenantTop,
        accepted: 'false',
        source: 'none',
      });
      return null;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          issueId: args.issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IssueGoalSuggestService.suggestGoal упал — caller получит null',
      );
      return null;
    }
  }

  recordAccepted(args: { tenantId: string; source: 'knn' | 'llm' }): void {
    this.metrics?.incAiIssueGoalSuggested({
      tenantTop: tenantTopOf(args.tenantId),
      accepted: 'true',
      source: args.source,
    });
  }

  private async tryKnn(
    tenantId: string,
    issueId: string,
  ): Promise<{ goalId: string; confidence: number } | null> {
    type Row = { goalId: string; distance: number };
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRaw<Row[]>`
        WITH src AS (
          SELECT embedding
          FROM "Issue"
          WHERE id = ${issueId} AND "tenantId" = ${tenantId}
            AND embedding IS NOT NULL
        )
        SELECT i."goalId" AS "goalId",
               (i.embedding <=> (SELECT embedding FROM src))::float AS distance
        FROM "Issue" i
        WHERE i."tenantId" = ${tenantId}
          AND i.id <> ${issueId}
          AND i."deletedAt" IS NULL
          AND i."goalId" IS NOT NULL
          AND i.embedding IS NOT NULL
          AND EXISTS (SELECT 1 FROM src)
        ORDER BY i.embedding <=> (SELECT embedding FROM src) ASC
        LIMIT ${IssueGoalSuggestService.KNN_LIMIT}
      `;
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IssueGoalSuggestService.tryKnn: SQL упал — пропускаю KNN, fallback на LLM',
      );
      return null;
    }
    if (rows.length === 0) return null;
    const top = rows[0];
    if (!top || top.distance > IssueGoalSuggestService.KNN_DISTANCE_THRESHOLD) {
      return null;
    }
    const votes = new Map<string, number>();
    for (const r of rows) {
      votes.set(r.goalId, (votes.get(r.goalId) ?? 0) + 1);
    }
    let bestGoal: string | null = null;
    let bestCount = 0;
    for (const [goalId, count] of votes.entries()) {
      if (count > bestCount) {
        bestGoal = goalId;
        bestCount = count;
      }
    }
    if (!bestGoal) return null;
    const share = bestCount / rows.length;
    if (share < IssueGoalSuggestService.KNN_VOTING_SHARE) {
      return null;
    }
    return { goalId: bestGoal, confidence: share };
  }

  private async tryLlm(args: {
    tenantId: string;
    issueId: string;
    title: string;
    description: string;
  }): Promise<{ goalId: string; confidence: number } | null> {
    const goals = await this.prisma.goal.findMany({
      where: { tenantId: args.tenantId, status: 'active' },
      select: { id: true, name: true, description: true },
      take: 25,
      orderBy: { updatedAt: 'desc' },
    });
    if (goals.length === 0) return null;

    const systemPrompt = [
      'Ты — AI-помощник трекера задач. Тебе дан title+description задачи и список активных целей компании.',
      'Выбери одну цель, под которую задача максимально подходит, ИЛИ ответь null если нет подходящей.',
      'Не выдумывай goalId — выбирай только из списка.',
      'Отвечай строго JSON без markdown:',
      '{"goalId":null|"<id>","confidence":0.0-1.0,"reasoning":"короткое объяснение"}',
    ].join('\n');

    const userMessage = [
      `# Задача`,
      `Title: ${args.title}`,
      args.description ? `Description: ${args.description.slice(0, 2000)}` : '',
      '',
      `# Активные цели (id → name)`,
      ...goals.map((g) => {
        const d = (g.description ?? '').slice(0, 200);
        return `- ${g.id} → ${g.name}${d ? ` (${d})` : ''}`;
      }),
      '',
      'Верни JSON.',
    ].join('\n');

    const promise = this.router.call({
      taskType: 'issue-goal-suggest',
      systemPrompt,
      userMessage,
      tenantId: args.tenantId,
      sourceRef: { type: 'issue', id: args.issueId },
      maxTokens: 200,
      responseFormat: { type: 'json_object' },
    });
    let result;
    try {
      result = await this.withTimeout(promise, IssueGoalSuggestService.LLM_TIMEOUT_MS);
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
        },
        'IssueGoalSuggestService.tryLlm: LlmRouter упал/таймаут',
      );
      return null;
    }
    let parsed: { goalId: unknown; confidence: unknown };
    try {
      const cleaned = result.text
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/```$/, '');
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn('IssueGoalSuggestService.tryLlm: ответ LLM не JSON');
      return null;
    }
    if (typeof parsed.goalId !== 'string') return null;
    const validIds = new Set(goals.map((g) => g.id));
    if (!validIds.has(parsed.goalId)) {
      this.logger.warn(
        { suggested: parsed.goalId },
        'IssueGoalSuggestService.tryLlm: LLM вернул goalId вне списка',
      );
      return null;
    }
    const conf =
      typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    return { goalId: parsed.goalId, confidence: conf };
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`IssueGoalSuggest timeout ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export interface IssueGoalSuggestResult {
  goalId: string;
  confidence: number;
  source: 'knn' | 'llm';
}
