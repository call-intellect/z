import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  GOAL_TASK_LINK_JSON_SCHEMA,
  GOAL_TASK_LINK_SCHEMA_NAME,
  GOAL_TASK_LINK_SYSTEM_PROMPT,
  GOAL_TASK_LINK_USER_TEMPLATE,
  GoalTaskLinkResponse,
  GoalTaskLinkResponseSchema,
} from '../prompts/goal-task-link.prompt';

@Injectable()
export class GoalTaskLinkerService {
  private readonly logger = new Logger(GoalTaskLinkerService.name);

  private static readonly MIN_CONFIDENCE = 0.6;
  private static readonly MAX_CANDIDATES = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async linkGoalTasks(tenantId: string, goalId: string): Promise<{ linked: number }> {
    const empty = { linked: 0 } as const;

    if (!this.isEnabled()) return empty;

    try {
      const goal = await this.prisma.goal.findUnique({
        where: { id: goalId },
        select: { tenantId: true, source: true, sourceBlockIds: true, name: true },
      });
      if (!goal) return empty;
      if (goal.tenantId !== tenantId) return empty;
      if (goal.source !== 'ai') return empty;
      const sourceBlockIds = goal.sourceBlockIds;
      if (!sourceBlockIds || sourceBlockIds.length === 0) return empty;

      const meetingIds = await this.resolveMeetingIds(sourceBlockIds);
      if (meetingIds.length === 0) return empty;

      const candidates = await this.prisma.issue.findMany({
        where: {
          tenantId,
          deletedAt: null,
          goalId: null,
          linkedMeetingIds: { hasSome: meetingIds },
        },
        select: { id: true, title: true },
        take: GoalTaskLinkerService.MAX_CANDIDATES,
      });
      if (candidates.length === 0) return empty;

      const verdict = await this.judge({
        tenantId,
        goalName: goal.name,
        tasks: candidates.map((c) => ({ id: c.id, title: c.title })),
      });
      if (!verdict) {
        this.metrics?.incGoalTaskLink?.({ result: 'fallback' });
        return empty;
      }

      const candidateIds = new Set(candidates.map((c) => c.id));
      let linked = 0;
      let rejected = 0;
      for (const link of verdict.links) {
        if (!link.develops) {
          rejected += 1;
          continue;
        }
        if (link.confidence < GoalTaskLinkerService.MIN_CONFIDENCE) {
          rejected += 1;
          continue;
        }
        if (!candidateIds.has(link.taskId)) {
          rejected += 1;
          continue;
        }
        const res = await this.prisma.issue.updateMany({
          where: { id: link.taskId, tenantId, goalId: null, deletedAt: null },
          data: { goalId },
        });
        if (res.count > 0) {
          linked += 1;
          this.metrics?.incGoalTaskLink?.({ result: 'linked' });
        } else {
          rejected += 1;
        }
      }
      for (let i = 0; i < rejected; i++) {
        this.metrics?.incGoalTaskLink?.({ result: 'rejected' });
      }

      this.logger.debug(
        { goalId, tenantId, candidates: candidates.length, linked, rejected },
        'goal-task-linker: привязка завершена',
      );

      return { linked };
    } catch (err) {
      this.metrics?.incGoalTaskLink?.({ result: 'fallback' });
      this.logger.warn(
        {
          goalId,
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'goal-task-linker: непойманная ошибка — пропускаю (best-effort)',
      );
      return empty;
    }
  }

  private isEnabled(): boolean {
    try {
      return this.cfg?.goals.goalTaskLinkEnabled === true;
    } catch {
      return false;
    }
  }

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  private async resolveMeetingIds(sourceBlockIds: string[]): Promise<string[]> {
    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: sourceBlockIds }, sourceType: 'meeting' },
      select: { rawEventId: true },
    });
    const rawEventIds = [...new Set(evidence.map((e) => e.rawEventId))];
    if (rawEventIds.length === 0) return [];

    const rawEvents = await this.prisma.rawEvent.findMany({
      where: { id: { in: rawEventIds }, sourceType: 'meeting' },
      select: { sourceExternalId: true },
    });
    return [
      ...new Set(rawEvents.map((r) => r.sourceExternalId).filter((id): id is string => !!id)),
    ];
  }

  private async judge(args: {
    tenantId: string;
    goalName: string;
    tasks: ReadonlyArray<{ id: string; title: string }>;
  }): Promise<GoalTaskLinkResponse | null> {
    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = GOAL_TASK_LINK_USER_TEMPLATE({
      goalName: args.goalName,
      tasks: args.tasks,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'goal-task-link',
          tenantId: args.tenantId,
          systemPrompt: guardOn
            ? withInjectionGuard(GOAL_TASK_LINK_SYSTEM_PROMPT)
            : GOAL_TASK_LINK_SYSTEM_PROMPT,
          userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
          responseFormat: {
            type: 'json_schema',
            name: GOAL_TASK_LINK_SCHEMA_NAME,
            strict: true,
            schema: GOAL_TASK_LINK_JSON_SCHEMA,
          },
          dataClass: 'internal',
          validate: (text) => this.parseVerdict(text) !== null,
        });
        const parsed = this.parseVerdict(out.text);
        if (parsed) return parsed;
        this.logger.warn({ attempt }, 'goal-task-link: invalid JSON LLM-арбитра — повтор');
      } catch (err) {
        this.logger.warn(
          {
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'goal-task-link: LLM judge упал — повтор',
        );
      }
    }

    this.logger.warn('goal-task-link: fallback (null) после 2 попыток');
    return null;
  }

  private parseVerdict(text: string): GoalTaskLinkResponse | null {
    const raw = tryParseJson(text);
    const parsed = GoalTaskLinkResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
}
