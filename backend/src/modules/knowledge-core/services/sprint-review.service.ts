import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { wrapUserData } from '../../ai/services/prompts/common';
import {
  SPRINT_REVIEW_SUMMARY_JSON_SCHEMA,
  SPRINT_REVIEW_SUMMARY_SCHEMA_NAME,
  SPRINT_REVIEW_SUMMARY_SYSTEM_PROMPT,
  SPRINT_REVIEW_SUMMARY_USER_TEMPLATE,
} from '../../ai/services/prompts/sprint-review-summary.prompt';
import { CurationService } from '../../curation/services/curation.service';

interface SprintReviewPayload {
  narrative: string;
  goal: string | null;
  planned: string[];
  completed: string[];
  notCompleted: string[];
  reasons: string[];
  carriedOver: string[];
  blockers: string[];
  hints: string[];
  nextPlanCandidates: string[];
  confidence: number;
}

@Injectable()
export class SprintReviewService {
  private readonly logger = new Logger(SprintReviewService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  @OnEvent('cycle.review_requested', { async: true })
  async onCycleReviewRequested(payload: {
    cycleId: string;
    tenantId: string;
    reason: 'cycle_completed' | 'manual_regenerate';
  }): Promise<void> {
    if (!payload?.cycleId || !payload?.tenantId) return;
    try {
      await this.generateReview({
        cycleId: payload.cycleId,
        tenantId: payload.tenantId,
        reason: payload.reason,
      });
    } catch (err) {
      this.logger.warn(
        {
          cycleId: payload.cycleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-review.onCycleReviewRequested: failed (best-effort)',
      );
    }
  }

  async generateReview(args: {
    cycleId: string;
    tenantId: string;
    reason: 'cycle_completed' | 'manual_regenerate';
  }): Promise<
    | { status: 'ready'; cardVersionId: string | null; review: SprintReviewPayload }
    | { status: 'failed'; error: string }
  > {
    const startedAt = Date.now();
    const tenantLabel = args.tenantId;
    try {
      const cycle = await this.prisma.cycle.findFirst({
        where: { id: args.cycleId, tenantId: args.tenantId },
        include: {
          project: {
            include: {
              customerCard: { select: { name: true } },
              vendor: { select: { name: true } },
              subjectPerson: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
        },
      });
      if (!cycle) {
        return { status: 'failed', error: 'cycle_not_found' };
      }

      const issues = await this.prisma.issue.findMany({
        where: {
          cycleId: cycle.id,
          tenantId: args.tenantId,
          deletedAt: null,
        },
        select: {
          id: true,
          identifier: true,
          title: true,
          state: { select: { category: true } },
          completedAt: true,
        },
      });
      const completedIssues = issues
        .filter((i) => i.state?.category === 'completed')
        .map((i) => ({ identifier: i.identifier, title: i.title }));
      const cancelledIssues = issues.filter((i) => i.state?.category === 'cancelled');
      const notCompletedIssues = issues
        .filter((i) => i.state?.category !== 'completed' && i.state?.category !== 'cancelled')
        .map((i) => ({
          identifier: i.identifier,
          title: i.title,
          state: i.state?.category ?? null,
        }));

      const carriedOverIssueIds = await this.findCarriedOverIssues(cycle.id);

      const sprintReviewMeeting = await this.prisma.meeting.findFirst({
        where: {
          linkedCycleId: cycle.id,
          type: 'sprint_review',
          tenantId: args.tenantId,
          deletedAt: null,
        },
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true },
      });
      void sprintReviewMeeting;
      const sourceBlockIds = new Set<string>();
      for (const i of await this.prisma.issue.findMany({
        where: { cycleId: cycle.id, tenantId: args.tenantId },
        select: { sourceBlockIds: true },
      })) {
        for (const b of i.sourceBlockIds) sourceBlockIds.add(b);
      }
      const meetingBlocks =
        sourceBlockIds.size > 0
          ? await this.prisma.ideaBlock.findMany({
              where: {
                id: { in: [...sourceBlockIds] },
                tenantId: args.tenantId,
                status: { in: ['canonical', 'draft'] },
              },
              orderBy: [{ updatedAt: 'desc' }],
              take: 30,
              select: {
                name: true,
                signalType: true,
                criticalQuestion: true,
                trustedAnswer: true,
              },
            })
          : [];

      const activeHints = await this.prisma.sprintHint.findMany({
        where: {
          cycleId: cycle.id,
          tenantId: args.tenantId,
          status: 'active',
        },
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        take: 30,
        select: {
          kind: true,
          severity: true,
          title: true,
          body: true,
          affectedIssueIds: true,
        },
      });

      const userMessage = SPRINT_REVIEW_SUMMARY_USER_TEMPLATE({
        cycleName: cycle.name,
        scopeLabel: this.buildScopeLabel(cycle.project),
        startDate: cycle.startDate.toISOString().slice(0, 10),
        endDate: cycle.endDate.toISOString().slice(0, 10),
        description: cycle.description,
        progress: {
          total: issues.length,
          completed: completedIssues.length,
          inProgress: notCompletedIssues.filter((i) => i.state === 'started').length,
          cancelled: cancelledIssues.length,
        },
        completedIssues,
        notCompletedIssues,
        carriedOverIssueIds,
        meetingBlocks,
        activeHints,
      });

      const guardedUser = wrapUserData(userMessage);

      let result: LlmCallResult;
      try {
        result = await this.llm.call({
          taskType: 'sprint-review-summary',
          systemPrompt: SPRINT_REVIEW_SUMMARY_SYSTEM_PROMPT,
          userMessage: guardedUser,
          tenantId: args.tenantId,
          responseFormat: {
            type: 'json_schema',
            name: SPRINT_REVIEW_SUMMARY_SCHEMA_NAME,
            schema: SPRINT_REVIEW_SUMMARY_JSON_SCHEMA,
            strict: true,
          },
          sourceRef: { type: 'cycle', id: cycle.id },
          dataClass: 'internal',
        });
      } catch (err) {
        this.metrics?.incSprintReviewGeneration({
          tenant: tenantLabel,
          status: 'failed',
        });
        const error = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          { cycleId: cycle.id, err: error },
          'sprint-review: все LLM-провайдеры упали',
        );
        await this.markFailed(cycle.id, error);
        return { status: 'failed', error };
      }

      let review: SprintReviewPayload;
      try {
        review = JSON.parse(result.text) as SprintReviewPayload;
      } catch {
        this.metrics?.incSprintReviewGeneration({
          tenant: tenantLabel,
          status: 'failed',
        });
        await this.markFailed(cycle.id, 'invalid_json_from_llm');
        return { status: 'failed', error: 'invalid_json_from_llm' };
      }

      let cardVersionId: string | null = null;
      try {
        const triage = await this.curation.triage({
          tenantId: args.tenantId,
          resourceType: 'cycle',
          resourceId: cycle.id,
          confidence: Math.max(0, Math.min(1, review.confidence)),
          proposedPayload: { review } as unknown as Record<string, unknown>,
          conflictSignal: 'none',
          createdByUserId: null,
          dataClass: 'internal',
        });
        cardVersionId = triage.cardVersionId;
      } catch (err) {
        this.logger.warn(
          {
            cycleId: cycle.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-review: triage failed — review без CardVersion',
        );
      }

      if (cardVersionId === null) {
        await this.markFailed(cycle.id, 'triage_failed');
        this.metrics?.incSprintReviewGeneration({
          tenant: tenantLabel,
          status: 'failed',
        });
        return { status: 'failed', error: 'triage_failed' };
      }

      await this.markReady(cycle.id);
      this.metrics?.incSprintReviewGeneration({
        tenant: tenantLabel,
        status: args.reason === 'manual_regenerate' ? 'retried' : 'ready',
      });
      return { status: 'ready', cardVersionId, review };
    } finally {
      this.metrics?.observeSprintReviewGenerationDuration({
        tenant: tenantLabel,
        seconds: (Date.now() - startedAt) / 1000,
      });
    }
  }

  async getCurrentReview(args: {
    cycleId: string;
    tenantId: string;
  }): Promise<
    | { status: 'ready'; review: SprintReviewPayload }
    | { status: 'pending' }
    | { status: 'failed'; error: string }
  > {
    const cycle = await this.prisma.cycle.findFirst({
      where: { id: args.cycleId, tenantId: args.tenantId },
      select: { progressSnapshot: true },
    });
    const snap = (cycle?.progressSnapshot as Record<string, unknown> | null) ?? null;
    const reviewStatus = (snap?.['reviewStatus'] as string | undefined) ?? null;
    if (reviewStatus === 'failed') {
      return {
        status: 'failed',
        error: (snap?.['reviewError'] as string) ?? 'unknown',
      };
    }
    if (reviewStatus !== 'ready') {
      return { status: 'pending' };
    }
    const latest = await this.prisma.cardVersion.findFirst({
      where: {
        tenantId: args.tenantId,
        resourceType: 'cycle',
        resourceId: args.cycleId,
      },
      orderBy: [{ version: 'desc' }],
      select: { payload: true },
    });
    if (!latest) {
      return { status: 'pending' };
    }
    const payload = latest.payload as { review?: SprintReviewPayload } | null;
    if (!payload?.review) {
      return { status: 'pending' };
    }
    return { status: 'ready', review: payload.review };
  }

  private async findCarriedOverIssues(cycleId: string): Promise<string[]> {
    const rows = await this.prisma.issueActivity.findMany({
      where: {
        verb: 'moved_from_cycle',
        oldValue: { equals: cycleId } as unknown as Prisma.JsonNullableFilter,
      },
      select: { issueId: true },
      distinct: ['issueId'],
      take: 100,
    });
    return rows.map((r) => r.issueId);
  }

  private buildScopeLabel(project: {
    name: string;
    customerCard: { name: string } | null;
    vendor: { name: string } | null;
    subjectPerson: { name: string } | null;
    department: { name: string } | null;
  }): string {
    if (project.customerCard) return `Клиент: ${project.customerCard.name}`;
    if (project.vendor) return `Поставщик: ${project.vendor.name}`;
    if (project.subjectPerson) return `Сотрудник: ${project.subjectPerson.name}`;
    if (project.department) return `Отдел: ${project.department.name}`;
    return `Проект: ${project.name}`;
  }

  private async markReady(cycleId: string): Promise<void> {
    try {
      const cycle = await this.prisma.cycle.findUnique({
        where: { id: cycleId },
        select: { progressSnapshot: true },
      });
      const snap = (cycle?.progressSnapshot as Record<string, unknown> | null) ?? {};
      snap['reviewStatus'] = 'ready';
      snap['reviewError'] = null;
      snap['reviewGeneratedAt'] = new Date().toISOString();
      await this.prisma.cycle.update({
        where: { id: cycleId },
        data: { progressSnapshot: snap as Prisma.InputJsonValue },
      });
    } catch (err) {
      this.logger.debug(
        {
          cycleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-review.markReady: failed',
      );
    }
  }

  private async markFailed(cycleId: string, error: string): Promise<void> {
    try {
      const cycle = await this.prisma.cycle.findUnique({
        where: { id: cycleId },
        select: { progressSnapshot: true },
      });
      const snap = (cycle?.progressSnapshot as Record<string, unknown> | null) ?? {};
      snap['reviewStatus'] = 'failed';
      snap['reviewError'] = error;
      await this.prisma.cycle.update({
        where: { id: cycleId },
        data: { progressSnapshot: snap as Prisma.InputJsonValue },
      });
    } catch (err) {
      this.logger.debug(
        {
          cycleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-review.markFailed: failed',
      );
    }
  }
}
